#include <jni.h>
#include <android/log.h>

#include "llama.h"
#include "ggml-backend.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

struct ThistleModel {
  llama_model *model;
};

struct LoadLog {
  std::string text;
};

std::mutex models_mutex;
uint64_t next_model_id = 1;
std::unordered_map<uint64_t, std::unique_ptr<ThistleModel>> models;

ThistleModel *find_model(uint64_t model_id) {
  std::lock_guard<std::mutex> lock(models_mutex);
  const auto iterator = models.find(model_id);
  return iterator == models.end() ? nullptr : iterator->second.get();
}

void capture_load_log(enum ggml_log_level, const char *text, void *user_data) {
  auto *log = static_cast<LoadLog *>(user_data);
  if (log != nullptr && text != nullptr) {
    log->text.append(text);
  }
}

std::string format_prompt(const llama_model *model, const std::string &text) {
  const char *chat_template = llama_model_chat_template(model, nullptr);
  if (chat_template == nullptr || chat_template[0] == '\0') {
    return "Question: " + text + "\nAnswer:";
  }

  std::string system_text;
  std::string user_text = text;
  constexpr const char *scaffolding_prefix = "Scaffolding:\n";
  constexpr const char *user_request_marker = "\n\nUser request:\n";
  if (text.rfind(scaffolding_prefix, 0) == 0) {
    const size_t marker = text.find(user_request_marker);
    if (marker != std::string::npos) {
      system_text = text.substr(
          std::strlen(scaffolding_prefix), marker - std::strlen(scaffolding_prefix));
      user_text = text.substr(marker + std::strlen(user_request_marker));
    }
  }

  std::vector<llama_chat_message> messages;
  if (!system_text.empty()) {
    messages.push_back({"system", system_text.c_str()});
  }
  messages.push_back({"user", user_text.c_str()});
  std::vector<char> buffer(std::max<size_t>(512, text.size() * 2 + 256));
  int32_t size = llama_chat_apply_template(
      chat_template, messages.data(), messages.size(), true, buffer.data(), buffer.size());
  if (size < 0) {
    buffer.resize(static_cast<size_t>(-size));
    size = llama_chat_apply_template(
        chat_template, messages.data(), messages.size(), true, buffer.data(), buffer.size());
  }
  if (size <= 0 || static_cast<size_t>(size) >= buffer.size()) {
    return "Question: " + text + "\nAnswer:";
  }
  return std::string(buffer.data(), static_cast<size_t>(size));
}

void throw_error(JNIEnv *env, const std::string &message) {
  env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message.c_str());
}

uint64_t load_model(const std::string &path, std::string &error) {
  LoadLog load_log;
  ggml_log_callback previous_callback = nullptr;
  void *previous_user_data = nullptr;
  llama_log_get(&previous_callback, &previous_user_data);
  llama_log_set(capture_load_log, &load_log);
  ggml_backend_load_all();
  llama_backend_init();
  auto params = llama_model_default_params();
  params.n_gpu_layers = -1;
  auto *model = llama_model_load_from_file(path.c_str(), params);
  llama_log_set(previous_callback, previous_user_data);
  if (model == nullptr) {
    error = "Unable to load GGUF model at " + path + ".";
    if (!load_log.text.empty()) {
      error += " " + load_log.text;
    }
    return 0;
  }
  auto handle = std::make_unique<ThistleModel>(ThistleModel{model});
  std::lock_guard<std::mutex> lock(models_mutex);
  const uint64_t model_id = next_model_id++;
  models.emplace(model_id, std::move(handle));
  return model_id;
}

bool warmup(uint64_t model_id, int32_t max_context_size, std::string &error) {
  auto *handle = find_model(model_id);
  if (handle == nullptr || handle->model == nullptr) {
    error = "Model is not loaded.";
    return false;
  }
  const auto *vocab = llama_model_get_vocab(handle->model);
  auto context_params = llama_context_default_params();
  const int32_t model_context_size = llama_model_n_ctx_train(handle->model);
  context_params.n_ctx = std::min<int32_t>(max_context_size > 0 ? max_context_size : 256, 256);
  if (model_context_size > 0) {
    context_params.n_ctx = std::min<int32_t>(context_params.n_ctx, model_context_size);
  }
  context_params.n_batch = 1;
  context_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
  context_params.offload_kqv = true;
  context_params.op_offload = true;
  auto *context = llama_init_from_model(handle->model, context_params);
  if (context == nullptr) {
    error = "Unable to warm up llama context.";
    return false;
  }
  llama_token bos = llama_vocab_bos(vocab);
  auto batch = llama_batch_get_one(&bos, 1);
  const bool success = llama_decode(context, batch) == 0;
  llama_free(context);
  if (!success) {
    error = "Unable to warm up llama backend.";
  }
  return success;
}

std::string prompt(uint64_t model_id, const std::string &text, int32_t max_input_tokens,
                   int32_t max_context_size, int32_t max_output_tokens,
                   std::string &error) {
  auto *handle = find_model(model_id);
  if (handle == nullptr || handle->model == nullptr) {
    error = "Model is not loaded.";
    return {};
  }
  if (text.empty()) {
    error = "Prompt is empty.";
    return {};
  }
  const auto *vocab = llama_model_get_vocab(handle->model);
  const std::string formatted = format_prompt(handle->model, text);
  const int prompt_size = -llama_tokenize(vocab, formatted.c_str(), formatted.size(), nullptr, 0, true, true);
  if (prompt_size <= 0) {
    error = "Unable to tokenize prompt.";
    return {};
  }
  std::vector<llama_token> tokens(prompt_size);
  if (llama_tokenize(vocab, formatted.c_str(), formatted.size(), tokens.data(), tokens.size(), true, true) < 0) {
    error = "Unable to tokenize prompt.";
    return {};
  }
  if (max_input_tokens > 0 && tokens.size() > static_cast<size_t>(max_input_tokens)) {
    error = "Prompt exceeds maxInputTokens.";
    return {};
  }
  auto context_params = llama_context_default_params();
  const int32_t model_context_size = llama_model_n_ctx_train(handle->model);
  context_params.n_ctx = max_context_size > 0
      ? (model_context_size > 0 ? std::min(max_context_size, model_context_size) : max_context_size)
      : (model_context_size > 0 ? model_context_size : static_cast<int32_t>(tokens.size()));
  if (tokens.size() > static_cast<size_t>(context_params.n_ctx)) {
    error = "Prompt exceeds the model context window.";
    return {};
  }
  context_params.n_batch = tokens.size();
  context_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
  context_params.offload_kqv = true;
  context_params.op_offload = true;
  auto *context = llama_init_from_model(handle->model, context_params);
  if (context == nullptr) {
    error = "Unable to create llama context.";
    return {};
  }
  auto sampler_params = llama_sampler_chain_default_params();
  auto *sampler = llama_sampler_chain_init(sampler_params);
  llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
  llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.9f, 1));
  llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.7f));
  llama_sampler_chain_add(sampler, llama_sampler_init_penalties(llama_vocab_n_tokens(vocab), 64, 1.1f, 0.0f, 0.0f));
  llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
  llama_batch batch = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
  std::string response;
  for (int generated = 0; max_output_tokens <= 0 || generated < max_output_tokens; ++generated) {
    if (tokens.size() + static_cast<size_t>(generated) >= static_cast<size_t>(context_params.n_ctx)) break;
    if (llama_decode(context, batch) != 0) { error = "Unable to evaluate prompt."; break; }
    auto token = llama_sampler_sample(sampler, context, -1);
    if (llama_vocab_is_eog(vocab, token)) break;
    char piece[256];
    const int piece_size = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
    if (piece_size < 0) { error = "Unable to decode generated token."; break; }
    response.append(piece, piece_size);
    batch = llama_batch_get_one(&token, 1);
  }
  llama_sampler_free(sampler);
  llama_free(context);
  return response;
}

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeLoadModel(JNIEnv *env, jobject, jstring path) {
  const char *raw_path = env->GetStringUTFChars(path, nullptr);
  std::string error;
  const uint64_t model_id = load_model(raw_path, error);
  env->ReleaseStringUTFChars(path, raw_path);
  if (model_id == 0) throw_error(env, error);
  return static_cast<jlong>(model_id);
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeWarmup(JNIEnv *env, jobject, jlong model_id, jint max_context_size) {
  std::string error;
  if (!warmup(static_cast<uint64_t>(model_id), max_context_size, error)) throw_error(env, error);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativePrompt(JNIEnv *env, jobject, jlong model_id, jstring text,
                                                     jint max_input_tokens, jint max_context_size,
                                                     jint max_output_tokens, jint) {
  const char *raw_text = env->GetStringUTFChars(text, nullptr);
  std::string error;
  const std::string response = prompt(static_cast<uint64_t>(model_id), raw_text, max_input_tokens,
                                      max_context_size, max_output_tokens, error);
  env->ReleaseStringUTFChars(text, raw_text);
  if (!error.empty()) {
    throw_error(env, error);
    return nullptr;
  }
  return env->NewStringUTF(response.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_margelo_nitro_thistle_Thistle_nativeUnloadModel(JNIEnv *, jobject, jlong model_id) {
  std::unique_ptr<ThistleModel> handle;
  {
    std::lock_guard<std::mutex> lock(models_mutex);
    const auto iterator = models.find(static_cast<uint64_t>(model_id));
    if (iterator == models.end()) return;
    handle = std::move(iterator->second);
    models.erase(iterator);
  }
  llama_model_free(handle->model);
}