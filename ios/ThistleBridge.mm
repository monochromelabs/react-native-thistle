#include "ThistleBridge.h"

#include "llama.h"

#import <Foundation/Foundation.h>

#include "ggml-backend.h"

#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

namespace {

struct ThistleModel {
  llama_model *model;
};

struct LoadLog {
  std::string text;
};

char *copy_string(const std::string &value) {
  auto *result = static_cast<char *>(std::malloc(value.size() + 1));
  if (result == nullptr) {
    return nullptr;
  }
  std::memcpy(result, value.c_str(), value.size() + 1);
  return result;
}

void set_error(char **error_message, const std::string &message) {
  if (error_message != nullptr) {
    *error_message = copy_string(message);
  }
}

void capture_load_log(enum ggml_log_level, const char *text, void *user_data) {
  auto *log = static_cast<LoadLog *>(user_data);
  if (log != nullptr && text != nullptr) {
    log->text.append(text);
  }
}

std::string resolve_model_path(const char *path) {
  std::string candidate(path);
  std::ifstream file(candidate);
  if (file.good()) {
    return candidate;
  }

  NSString *originalPath = [NSString stringWithUTF8String:path];
  NSURL *url = [NSURL URLWithString:originalPath];
  NSString *filename = url.path.lastPathComponent;
  if (filename.length == 0) {
    filename = originalPath.lastPathComponent;
  }
  NSString *extension = [filename pathExtension];
  NSString *name = [filename stringByDeletingPathExtension];
  for (NSString *directory in @[ @"assets/assets", @"assets" ]) {
    NSString *bundlePath = [[NSBundle mainBundle]
        pathForResource:name
                 ofType:extension
            inDirectory:directory];
    if (bundlePath != nil) {
      return [bundlePath UTF8String];
    }
  }
  NSString *rootBundlePath = [[NSBundle mainBundle]
      pathForResource:name
               ofType:extension];
  if (rootBundlePath != nil) {
    return [rootBundlePath UTF8String];
  }
  return candidate;
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
      chat_template, messages.data(), messages.size(), true, buffer.data(),
      buffer.size());
  if (size < 0) {
    buffer.resize(static_cast<size_t>(-size));
    size = llama_chat_apply_template(
        chat_template, messages.data(), messages.size(), true, buffer.data(),
        buffer.size());
  }
  if (size <= 0 || static_cast<size_t>(size) >= buffer.size()) {
    return "Question: " + text + "\nAnswer:";
  }
  return std::string(buffer.data(), static_cast<size_t>(size));
}

} // namespace

uint64_t thistle_load_model(const char *path, char **error_message) {
  if (path == nullptr || path[0] == '\0') {
    set_error(error_message, "Model path is empty.");
    return 0;
  }

  const std::string model_path = resolve_model_path(path);
  LoadLog load_log;
  ggml_log_callback previous_callback = nullptr;
  void *previous_user_data = nullptr;
  llama_log_get(&previous_callback, &previous_user_data);
  llama_log_set(capture_load_log, &load_log);
  ggml_backend_load_all();
  llama_backend_init();
  auto params = llama_model_default_params();
  params.n_gpu_layers = -1;
  auto *model = llama_model_load_from_file(model_path.c_str(), params);
  llama_log_set(previous_callback, previous_user_data);
  if (model == nullptr) {
    std::string message = "Unable to load GGUF model at " + model_path + ".";
    if (!load_log.text.empty()) {
      message += " " + load_log.text;
    }
    set_error(error_message, message);
    return 0;
  }

  auto *handle = new ThistleModel{model};
  return reinterpret_cast<uint64_t>(handle);
}

void thistle_warmup(uint64_t model_id, int32_t max_context_size,
                 char **error_message) {
  auto *handle = reinterpret_cast<ThistleModel *>(model_id);
  if (handle == nullptr || handle->model == nullptr) {
    set_error(error_message, "Model is not loaded.");
    return;
  }

  const auto *vocab = llama_model_get_vocab(handle->model);
  auto context_params = llama_context_default_params();
  const int32_t model_context_size = llama_model_n_ctx_train(handle->model);
  const int32_t requested_context = max_context_size > 0 ? max_context_size : 256;
  context_params.n_ctx = std::min<int32_t>(requested_context, 256);
  if (model_context_size > 0) {
    context_params.n_ctx = std::min<int32_t>(
        context_params.n_ctx, model_context_size);
  }
  context_params.n_batch = 1;
  context_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
  context_params.offload_kqv = true;
  context_params.op_offload = true;

  auto *context = llama_init_from_model(handle->model, context_params);
  if (context == nullptr) {
    set_error(error_message, "Unable to warm up llama context.");
    return;
  }

  llama_token bos = llama_vocab_bos(vocab);
  auto batch = llama_batch_get_one(&bos, 1);
  if (llama_decode(context, batch) != 0) {
    llama_free(context);
    set_error(error_message, "Unable to warm up llama backend.");
    return;
  }
  llama_free(context);
}

char *thistle_prompt(uint64_t model_id, const char *text, int32_t max_input_tokens,
                  int32_t max_context_size, int32_t max_output_tokens,
                  int32_t max_reasoning_tokens, char **error_message) {
  auto *handle = reinterpret_cast<ThistleModel *>(model_id);
  if (handle == nullptr || handle->model == nullptr) {
    set_error(error_message, "Model is not loaded.");
    return nullptr;
  }
  if (text == nullptr) {
    set_error(error_message, "Prompt is empty.");
    return nullptr;
  }
  (void) max_reasoning_tokens;

  NSLog(@"[Thistle] prompt: %s", text);

  const auto *vocab = llama_model_get_vocab(handle->model);
  const std::string prompt = format_prompt(handle->model, text);
  const int prompt_size = -llama_tokenize(
      vocab, prompt.c_str(), prompt.size(), nullptr, 0, true, true);
  if (prompt_size <= 0) {
    set_error(error_message, "Unable to tokenize prompt.");
    return nullptr;
  }

  std::vector<llama_token> prompt_tokens(prompt_size);
  if (llama_tokenize(
          vocab, prompt.c_str(), prompt.size(), prompt_tokens.data(),
          prompt_tokens.size(), true, true) < 0) {
    set_error(error_message, "Unable to tokenize prompt.");
    return nullptr;
  }

  if (max_input_tokens > 0 &&
      prompt_tokens.size() > static_cast<size_t>(max_input_tokens)) {
    set_error(error_message, "Prompt exceeds maxInputTokens.");
    return nullptr;
  }

  auto context_params = llama_context_default_params();
  const int32_t model_context_size = llama_model_n_ctx_train(handle->model);
  context_params.n_ctx = max_context_size > 0
      ? (model_context_size > 0
             ? std::min(max_context_size, model_context_size)
             : max_context_size)
      : (model_context_size > 0 ? model_context_size : prompt_tokens.size());
  if (prompt_tokens.size() > static_cast<size_t>(context_params.n_ctx)) {
    set_error(error_message, "Prompt exceeds the model context window.");
    return nullptr;
  }
  context_params.n_batch = prompt_tokens.size();
  context_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
  context_params.offload_kqv = true;
  context_params.op_offload = true;

  LoadLog context_log;
  ggml_log_callback previous_callback = nullptr;
  void *previous_user_data = nullptr;
  llama_log_get(&previous_callback, &previous_user_data);
  llama_log_set(capture_load_log, &context_log);
  auto *context = llama_init_from_model(handle->model, context_params);
  llama_log_set(previous_callback, previous_user_data);
  if (context == nullptr) {
    std::string message = "Unable to create llama context.";
    if (!context_log.text.empty()) {
      message += " " + context_log.text;
    }
    set_error(error_message, message);
    return nullptr;
  }

  auto sampler_params = llama_sampler_chain_default_params();
  auto *sampler = llama_sampler_chain_init(sampler_params);
  llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
  llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.9f, 1));
  llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.7f));
  llama_sampler_chain_add(
      sampler, llama_sampler_init_penalties(
                   llama_vocab_n_tokens(vocab), 64, 1.1f, 0.0f, 0.0f));
  llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

  llama_batch batch = llama_batch_get_one(
      prompt_tokens.data(), static_cast<int32_t>(prompt_tokens.size()));
  std::string response;
  for (int generated = 0;
       max_output_tokens <= 0 || generated < max_output_tokens;
       ++generated) {
    if (prompt_tokens.size() + static_cast<size_t>(generated) >=
        static_cast<size_t>(context_params.n_ctx)) {
      break;
    }
    if (llama_decode(context, batch) != 0) {
      set_error(error_message, "Unable to evaluate prompt.");
      llama_sampler_free(sampler);
      llama_free(context);
      return nullptr;
    }

    auto token = llama_sampler_sample(sampler, context, -1);
    if (llama_vocab_is_eog(vocab, token)) {
      break;
    }

    char piece[256];
    const int piece_size = llama_token_to_piece(
        vocab, token, piece, sizeof(piece), 0, true);
    if (piece_size < 0) {
      set_error(error_message, "Unable to decode generated token.");
      llama_sampler_free(sampler);
      llama_free(context);
      return nullptr;
    }
    response.append(piece, piece_size);
    batch = llama_batch_get_one(&token, 1);
  }

  llama_sampler_free(sampler);
  llama_free(context);
  NSLog(@"[Thistle] output: %s", response.c_str());
  return copy_string(response);
}

void thistle_unload_model(uint64_t model_id) {
  auto *handle = reinterpret_cast<ThistleModel *>(model_id);
  if (handle == nullptr) {
    return;
  }
  llama_model_free(handle->model);
  delete handle;
}

void thistle_free_string(char *value) {
  std::free(value);
}