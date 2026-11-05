#include "ThistleEngine.h"

#include "ggml-backend.h"
#include "llama.h"

#include "jinja/caps.h"
#include "jinja/lexer.h"
#include "jinja/parser.h"
#include "jinja/runtime.h"
#include "jinja/value.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <new>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

using json = nlohmann::ordered_json;

constexpr int64_t kDefaultContextSize = 2048;
constexpr int64_t kDefaultMaxOutputTokens = 512;
constexpr int64_t kMaxContextSize = 1 << 20;
constexpr int32_t kMaxPromptBatch = 512;
constexpr int32_t kWarmupContextSize = 256;
constexpr const char *kThinkOpen = "<think>";
constexpr const char *kThinkClose = "</think>";

class ThistleError : public std::runtime_error {
public:
  ThistleError(const std::string &code, const std::string &message)
      : std::runtime_error("[thistle:" + code + "] " + message) {}
};

// ---------------------------------------------------------------------------
// Logging: llama.cpp logs through one global callback. Each thread can opt in
// to capturing warnings/errors so load failures carry a useful explanation.

struct LogCapture;
thread_local LogCapture *tl_log_capture = nullptr;

struct LogCapture {
  std::string text;
  ggml_log_level last_level = GGML_LOG_LEVEL_NONE;
  LogCapture *previous;

  LogCapture() : previous(tl_log_capture) { tl_log_capture = this; }
  ~LogCapture() { tl_log_capture = previous; }
  LogCapture(const LogCapture &) = delete;
  LogCapture &operator=(const LogCapture &) = delete;

  std::string summary() const {
    constexpr size_t kMaxLength = 2000;
    std::string trimmed = text;
    while (!trimmed.empty() &&
           (trimmed.back() == '\n' || trimmed.back() == ' ')) {
      trimmed.pop_back();
    }
    if (trimmed.size() > kMaxLength) {
      trimmed = "..." + trimmed.substr(trimmed.size() - kMaxLength);
    }
    return trimmed.empty() ? "" : " Details: " + trimmed;
  }
};

void log_callback(ggml_log_level level, const char *text, void *) {
  LogCapture *capture = tl_log_capture;
  if (capture == nullptr || text == nullptr) {
    return;
  }
  if (level != GGML_LOG_LEVEL_CONT) {
    capture->last_level = level;
  }
  if (capture->last_level == GGML_LOG_LEVEL_WARN ||
      capture->last_level == GGML_LOG_LEVEL_ERROR) {
    capture->text.append(text);
  }
}

void ensure_backend() {
  static std::once_flag once;
  std::call_once(once, [] {
    llama_log_set(log_callback, nullptr);
    ggml_backend_load_all();
    llama_backend_init();
  });
}

// ---------------------------------------------------------------------------
// UTF-8 helpers

// Replaces invalid sequences with U+FFFD and drops a truncated final sequence
// (which happens when generation stops in the middle of a multi-byte token).
std::string sanitize_utf8(const std::string &input) {
  std::string output;
  output.reserve(input.size());
  const auto *bytes = reinterpret_cast<const unsigned char *>(input.data());
  const size_t size = input.size();
  size_t i = 0;
  while (i < size) {
    const unsigned char lead = bytes[i];
    size_t length = 0;
    uint32_t min_codepoint = 0;
    if (lead < 0x80) {
      output.push_back(static_cast<char>(lead));
      ++i;
      continue;
    } else if ((lead & 0xE0) == 0xC0) {
      length = 2;
      min_codepoint = 0x80;
    } else if ((lead & 0xF0) == 0xE0) {
      length = 3;
      min_codepoint = 0x800;
    } else if ((lead & 0xF8) == 0xF0) {
      length = 4;
      min_codepoint = 0x10000;
    }
    if (length == 0) {
      output.append("\xEF\xBF\xBD");
      ++i;
      continue;
    }
    if (i + length > size) {
      bool valid_prefix = true;
      for (size_t j = i + 1; j < size; ++j) {
        valid_prefix = valid_prefix && (bytes[j] & 0xC0) == 0x80;
      }
      if (valid_prefix) {
        break;
      }
      output.append("\xEF\xBF\xBD");
      ++i;
      continue;
    }
    uint32_t codepoint = lead & (0xFF >> (length + 1));
    bool valid = true;
    for (size_t j = 1; j < length; ++j) {
      if ((bytes[i + j] & 0xC0) != 0x80) {
        valid = false;
        break;
      }
      codepoint = (codepoint << 6) | (bytes[i + j] & 0x3F);
    }
    valid = valid && codepoint >= min_codepoint && codepoint <= 0x10FFFF &&
            !(codepoint >= 0xD800 && codepoint <= 0xDFFF);
    if (!valid) {
      output.append("\xEF\xBF\xBD");
      ++i;
      continue;
    }
    output.append(input, i, length);
    i += length;
  }
  return output;
}

bool is_valid_utf8(const std::string &input) {
  return sanitize_utf8(input) == input;
}

std::string trim(const std::string &value) {
  const auto is_space = [](unsigned char c) { return std::isspace(c) != 0; };
  size_t start = 0;
  size_t end = value.size();
  while (start < end && is_space(value[start])) {
    ++start;
  }
  while (end > start && is_space(value[end - 1])) {
    --end;
  }
  return value.substr(start, end - start);
}

bool starts_with(const std::string &value, const std::string &prefix) {
  return value.size() >= prefix.size() &&
         value.compare(0, prefix.size(), prefix) == 0;
}

// ---------------------------------------------------------------------------
// Tokenization

std::vector<llama_token> tokenize(const llama_vocab *vocab,
                                  const std::string &text,
                                  bool parse_special) {
  if (text.empty()) {
    return {};
  }
  if (text.size() > static_cast<size_t>(std::numeric_limits<int32_t>::max())) {
    throw ThistleError("context_length_exceeded", "The prompt is too large.");
  }
  const auto length = static_cast<int32_t>(text.size());
  const int32_t needed =
      llama_tokenize(vocab, text.data(), length, nullptr, 0, false,
                     parse_special);
  if (needed == std::numeric_limits<int32_t>::min()) {
    throw ThistleError("context_length_exceeded", "The prompt is too large.");
  }
  if (needed >= 0) {
    return {};
  }
  std::vector<llama_token> tokens(static_cast<size_t>(-needed));
  const int32_t count =
      llama_tokenize(vocab, text.data(), length, tokens.data(),
                     static_cast<int32_t>(tokens.size()), false, parse_special);
  if (count < 0) {
    throw ThistleError("tokenization_failed", "Unable to tokenize prompt.");
  }
  tokens.resize(static_cast<size_t>(count));
  return tokens;
}

std::string token_to_piece(const llama_vocab *vocab, llama_token token,
                           bool special) {
  if (token == LLAMA_TOKEN_NULL) {
    return "";
  }
  std::string piece(32, '\0');
  int32_t size = llama_token_to_piece(vocab, token, piece.data(),
                                      static_cast<int32_t>(piece.size()), 0,
                                      special);
  if (size < 0) {
    piece.resize(static_cast<size_t>(-size));
    size = llama_token_to_piece(vocab, token, piece.data(),
                                static_cast<int32_t>(piece.size()), 0, special);
  }
  if (size < 0) {
    throw ThistleError("detokenization_failed",
                       "Unable to decode generated token.");
  }
  piece.resize(static_cast<size_t>(size));
  return piece;
}

// ---------------------------------------------------------------------------
// Chat templates

struct Message {
  std::string role;
  std::string content;
};

struct Segment {
  std::string text;
  bool is_input;
};

struct ChatFormatter {
  bool use_jinja = false;
  // A Jinja template, or the template/name handed to llama_chat_apply_template.
  std::string source;
  jinja::program program;
  jinja::caps caps;
  std::string bos_text;
  std::string eos_text;
  // Turn markers that the tokenizer does not know as control tokens (e.g. a
  // ChatML override on a base model). Generation stops when they appear.
  std::vector<std::string> stop_strings;
};

bool is_builtin_template_name(const std::string &name) {
  const int32_t count = llama_chat_builtin_templates(nullptr, 0);
  if (count <= 0) {
    return false;
  }
  std::vector<const char *> names(static_cast<size_t>(count));
  llama_chat_builtin_templates(names.data(), names.size());
  return std::any_of(names.begin(), names.end(), [&](const char *candidate) {
    return candidate != nullptr && name == candidate;
  });
}

// Normalizes conversations for strict templates: merges adjacent messages with
// the same role (many templates require strict alternation) and folds system
// text into the first user message when the template has no system role.
std::vector<Message> normalize_messages(const std::vector<Message> &input,
                                        bool supports_system_role) {
  std::vector<Message> output;
  std::string pending_system;
  for (const auto &message : input) {
    if (message.role == "system" && !supports_system_role) {
      pending_system += pending_system.empty() ? "" : "\n\n";
      pending_system += message.content;
      continue;
    }
    if (!output.empty() && output.back().role == message.role) {
      output.back().content += "\n\n" + message.content;
    } else {
      output.push_back(message);
    }
  }
  if (!pending_system.empty()) {
    auto first_user = std::find_if(output.begin(), output.end(),
                                   [](const Message &m) {
                                     return m.role == "user";
                                   });
    if (first_user != output.end()) {
      first_user->content = pending_system + "\n\n" + first_user->content;
    }
  }
  return output;
}

std::string apply_builtin_template(const std::string &tmpl,
                                   const std::vector<Message> &messages,
                                   bool add_generation_prompt = true) {
  std::vector<llama_chat_message> chat;
  size_t total = 0;
  chat.reserve(messages.size());
  for (const auto &message : messages) {
    chat.push_back({message.role.c_str(), message.content.c_str()});
    total += message.role.size() + message.content.size();
  }
  if (total > static_cast<size_t>(std::numeric_limits<int32_t>::max() / 4)) {
    throw ThistleError("context_length_exceeded", "The prompt is too large.");
  }
  std::vector<char> buffer(total * 2 + 1024);
  int32_t size = llama_chat_apply_template(
      tmpl.c_str(), chat.data(), chat.size(), add_generation_prompt,
      buffer.data(),
      static_cast<int32_t>(buffer.size()));
  // A positive result larger than the buffer is the required size.
  if (size > static_cast<int32_t>(buffer.size())) {
    buffer.resize(static_cast<size_t>(size));
    size = llama_chat_apply_template(tmpl.c_str(), chat.data(), chat.size(),
                                     add_generation_prompt, buffer.data(),
                                     static_cast<int32_t>(buffer.size()));
  }
  if (size < 0) {
    throw ThistleError("unsupported_chat_template",
                       "llama.cpp does not recognize this chat template.");
  }
  return std::string(buffer.data(), static_cast<size_t>(size));
}

std::vector<Segment> render_jinja(const ChatFormatter &formatter,
                                  const std::vector<Message> &messages,
                                  bool enable_thinking,
                                  bool add_generation_prompt = true) {
  const bool typed_only = !formatter.caps.supports_string_content &&
                          formatter.caps.supports_typed_content;
  json message_json = json::array();
  for (const auto &message : messages) {
    json content = typed_only
                       ? json::array({json{{"type", "text"},
                                           {"text", message.content}}})
                       : json(message.content);
    message_json.push_back(
        json{{"role", message.role}, {"content", std::move(content)}});
  }

  jinja::context context(formatter.source);
  jinja::global_from_json(context,
                          json{{"bos_token", formatter.bos_text},
                               {"eos_token", formatter.eos_text},
                               {"add_generation_prompt", add_generation_prompt},
                               {"enable_thinking", enable_thinking}},
                          false);
  // Mark message text as user input so injected special-token text can be
  // tokenized literally instead of as control tokens.
  jinja::global_from_json(context, json{{"messages", message_json}}, true);
  jinja::runtime runtime(context);
  const jinja::value results = runtime.execute(formatter.program);
  const auto parts = jinja::runtime::gather_string_parts(results);

  std::vector<Segment> segments;
  for (const auto &part : parts->val_str.parts) {
    if (!segments.empty() && segments.back().is_input == part.is_input) {
      segments.back().text += part.val;
    } else {
      segments.push_back({part.val, part.is_input});
    }
  }
  return segments;
}

std::vector<Segment> render_prompt(const ChatFormatter &formatter,
                                   const std::vector<Message> &messages,
                                   bool enable_thinking,
                                   bool add_generation_prompt = true) {
  const bool supports_system =
      !formatter.use_jinja || formatter.caps.supports_system_role;
  const auto normalized = normalize_messages(messages, supports_system);
  if (formatter.use_jinja) {
    return render_jinja(formatter, normalized, enable_thinking,
                        add_generation_prompt);
  }
  return {{apply_builtin_template(formatter.source, normalized,
                                  add_generation_prompt),
           false}};
}

std::string render_text(const ChatFormatter &formatter,
                        const std::vector<Message> &messages,
                        bool add_generation_prompt) {
  std::string text;
  for (const auto &segment :
       render_prompt(formatter, messages, false, add_generation_prompt)) {
    text += segment.text;
  }
  return text;
}

bool is_all_control_tokens(const llama_vocab *vocab, const std::string &text) {
  const auto tokens = tokenize(vocab, text, true);
  return !tokens.empty() &&
         std::all_of(tokens.begin(), tokens.end(), [&](llama_token token) {
           return (llama_vocab_get_attr(vocab, token) &
                   LLAMA_TOKEN_ATTR_CONTROL) != 0;
         });
}

// Finds the text a template writes after an assistant turn and before the
// next user turn. Markers that are real control tokens already end generation
// through llama_vocab_is_eog and are never detokenized, so only plain-text
// markers become stop strings.
std::vector<std::string> derive_stop_strings(const ChatFormatter &formatter,
                                             const llama_vocab *vocab) {
  static const std::string reply = "THISTLEPROBEREPLY";
  static const std::string next = "THISTLEPROBENEXT";
  std::vector<std::string> stops;
  const auto add = [&](const std::string &candidate) {
    const std::string marker = trim(candidate);
    if (marker.size() >= 2 && !is_all_control_tokens(vocab, marker) &&
        std::find(stops.begin(), stops.end(), marker) == stops.end()) {
      stops.push_back(marker);
    }
  };
  try {
    const std::string closed =
        render_text(formatter, {{"user", "Hello"}, {"assistant", reply}}, false);
    const std::string continued = render_text(
        formatter,
        {{"user", "Hello"}, {"assistant", reply}, {"user", next}}, false);
    const size_t closed_at = closed.rfind(reply);
    const size_t reply_at = continued.find(reply);
    const size_t next_at = continued.find(next);
    if (closed_at == std::string::npos || reply_at == std::string::npos ||
        next_at == std::string::npos || next_at < reply_at) {
      return stops;
    }
    const std::string end_of_turn = closed.substr(closed_at + reply.size());
    const std::string between = continued.substr(
        reply_at + reply.size(), next_at - reply_at - reply.size());
    add(end_of_turn);
    // What remains after the end-of-turn marker opens the next user turn.
    if (!trim(end_of_turn).empty() && starts_with(between, end_of_turn)) {
      add(between.substr(end_of_turn.size()));
    } else if (!trim(end_of_turn).empty() &&
               starts_with(trim(between), trim(end_of_turn))) {
      add(trim(between).substr(trim(end_of_turn).size()));
    } else {
      add(between);
    }
  } catch (const std::exception &) {
    // Some templates refuse to end on an assistant turn; EOG tokens still apply.
  }
  return stops;
}

const std::vector<Message> &template_probe_messages() {
  static const std::vector<Message> messages = {
      {"system", "You are a helpful assistant."},
      {"user", "Hello"},
      {"assistant", "Hi there."},
      {"user", "How are you?"},
  };
  return messages;
}

ChatFormatter make_formatter(const llama_model *model,
                             const std::string &template_override) {
  const llama_vocab *vocab = llama_model_get_vocab(model);
  ChatFormatter formatter;
  formatter.bos_text = token_to_piece(vocab, llama_vocab_bos(vocab), true);
  formatter.eos_text = token_to_piece(vocab, llama_vocab_eos(vocab), true);

  std::string source = template_override;
  if (source.empty()) {
    const char *embedded = llama_model_chat_template(model, nullptr);
    if (embedded == nullptr || embedded[0] == '\0') {
      throw ThistleError(
          "missing_chat_template",
          "This GGUF file has no tokenizer.chat_template metadata. Pass the "
          "model's Jinja chat template, or a llama.cpp built-in template name "
          "such as \"chatml\", \"llama3\", \"gemma\", or \"mistral-v7\", as "
          "the chatTemplate option.");
    }
    source = embedded;
  }

  formatter.source = source;
  if (is_builtin_template_name(source)) {
    formatter.use_jinja = false;
    render_prompt(formatter, template_probe_messages(), false);
    formatter.stop_strings = derive_stop_strings(formatter, vocab);
    return formatter;
  }

  std::string jinja_error;
  try {
    jinja::lexer lexer;
    const auto lexed = lexer.tokenize(source);
    formatter.program = jinja::parse_from_tokens(lexed);
    formatter.source = lexed.source;
    formatter.caps = jinja::caps_get(formatter.program);
    formatter.use_jinja = true;
    render_prompt(formatter, template_probe_messages(), false);
    formatter.stop_strings = derive_stop_strings(formatter, vocab);
    return formatter;
  } catch (const std::exception &error) {
    jinja_error = error.what();
  }

  // Fall back to llama.cpp's built-in template detection.
  formatter.use_jinja = false;
  formatter.source = source;
  try {
    render_prompt(formatter, template_probe_messages(), false);
    formatter.stop_strings = derive_stop_strings(formatter, vocab);
    return formatter;
  } catch (const std::exception &) {
    throw ThistleError("unsupported_chat_template",
                       "Unable to render the chat template: " + jinja_error);
  }
}

// Returns the prompt tokens. Template text is tokenized with special-token
// parsing; message text is tokenized literally if it contains special tokens.
std::vector<llama_token> tokenize_prompt(const llama_vocab *vocab,
                                         const std::vector<Segment> &segments) {
  bool literal_input_required = false;
  std::string full_prompt;
  for (const auto &segment : segments) {
    full_prompt += segment.text;
    if (segment.is_input && !literal_input_required &&
        tokenize(vocab, segment.text, true) !=
            tokenize(vocab, segment.text, false)) {
      literal_input_required = true;
    }
  }

  std::vector<llama_token> tokens;
  const llama_token bos = llama_vocab_bos(vocab);
  if (llama_vocab_get_add_bos(vocab) && bos != LLAMA_TOKEN_NULL) {
    tokens.push_back(bos);
  }
  if (literal_input_required) {
    for (const auto &segment : segments) {
      const auto part = tokenize(vocab, segment.text, !segment.is_input);
      tokens.insert(tokens.end(), part.begin(), part.end());
    }
  } else {
    const auto part = tokenize(vocab, full_prompt, true);
    tokens.insert(tokens.end(), part.begin(), part.end());
  }
  // Templates that emit bos_token themselves would otherwise double it.
  if (tokens.size() > 1 && tokens[0] == bos && tokens[1] == bos) {
    tokens.erase(tokens.begin());
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Model registry. Prompts hold a shared_ptr, so unloading never frees a model
// that is still in use; the last owner releases llama.cpp memory.

struct Model {
  llama_model *model = nullptr;
  ChatFormatter formatter;
  std::mutex run_mutex;
  std::atomic<bool> unloaded{false};

  ~Model() {
    if (model != nullptr) {
      llama_model_free(model);
    }
  }
};

std::mutex registry_mutex;
std::unordered_map<uint64_t, std::shared_ptr<Model>> models;
uint64_t next_model_id = 1;

std::shared_ptr<Model> acquire_model(uint64_t model_id) {
  std::lock_guard<std::mutex> lock(registry_mutex);
  const auto iterator = models.find(model_id);
  if (iterator == models.end()) {
    throw ThistleError("model_not_loaded",
                       "The model is not loaded or has been unloaded.");
  }
  return iterator->second;
}

void throw_if_unloaded(const Model &model) {
  if (model.unloaded.load()) {
    throw ThistleError("model_unloaded",
                       "The model was unloaded before the prompt finished.");
  }
}

bool abort_when_unloaded(void *data) {
  return static_cast<const Model *>(data)->unloaded.load();
}

struct ContextDeleter {
  void operator()(llama_context *context) const { llama_free(context); }
};
struct SamplerDeleter {
  void operator()(llama_sampler *sampler) const { llama_sampler_free(sampler); }
};
using ContextPtr = std::unique_ptr<llama_context, ContextDeleter>;
using SamplerPtr = std::unique_ptr<llama_sampler, SamplerDeleter>;

ContextPtr create_context(Model &model, uint32_t n_ctx, uint32_t n_batch) {
  auto params = llama_context_default_params();
  params.n_ctx = n_ctx;
  params.n_batch = n_batch;
  params.n_ubatch = n_batch;
  params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO;
  params.no_perf = true;
  params.abort_callback = abort_when_unloaded;
  params.abort_callback_data = &model;
  LogCapture capture;
  ContextPtr context(llama_init_from_model(model.model, params));
  if (!context) {
    throw ThistleError("context_creation_failed",
                       "Unable to create a llama.cpp context with " +
                           std::to_string(n_ctx) +
                           " tokens. Try a smaller maxContextSize." +
                           capture.summary());
  }
  return context;
}

void decode(Model &model, llama_context *context, llama_token *tokens,
            size_t count) {
  for (size_t offset = 0; offset < count; offset += kMaxPromptBatch) {
    throw_if_unloaded(model);
    const auto chunk = static_cast<int32_t>(
        std::min<size_t>(kMaxPromptBatch, count - offset));
    // The batch points into `tokens`, which outlives this synchronous decode.
    const int32_t result =
        llama_decode(context, llama_batch_get_one(tokens + offset, chunk));
    throw_if_unloaded(model);
    if (result != 0) {
      throw ThistleError("decode_failed", "llama_decode failed with code " +
                                              std::to_string(result) + ".");
    }
  }
}

// ---------------------------------------------------------------------------
// Request parsing

int64_t read_integer(const json &object, const char *key, int64_t fallback,
                     int64_t minimum, int64_t maximum) {
  const auto iterator = object.find(key);
  if (iterator == object.end() || iterator->is_null()) {
    return fallback;
  }
  if (!iterator->is_number()) {
    throw ThistleError("invalid_argument",
                       std::string(key) + " must be a number.");
  }
  const double value = iterator->get<double>();
  if (!std::isfinite(value) || std::floor(value) != value || value < minimum ||
      value > maximum) {
    throw ThistleError("invalid_argument",
                       std::string(key) + " must be an integer from " +
                           std::to_string(minimum) + " to " +
                           std::to_string(maximum) + ".");
  }
  return static_cast<int64_t>(value);
}

double read_number(const json &object, const char *key, double fallback,
                   double minimum, double maximum) {
  const auto iterator = object.find(key);
  if (iterator == object.end() || iterator->is_null()) {
    return fallback;
  }
  if (!iterator->is_number()) {
    throw ThistleError("invalid_argument",
                       std::string(key) + " must be a number.");
  }
  const double value = iterator->get<double>();
  if (!std::isfinite(value) || value < minimum || value > maximum) {
    throw ThistleError("invalid_argument", std::string(key) +
                                               " is outside the allowed range.");
  }
  return value;
}

bool read_bool(const json &object, const char *key, bool fallback) {
  const auto iterator = object.find(key);
  if (iterator == object.end() || iterator->is_null()) {
    return fallback;
  }
  if (!iterator->is_boolean()) {
    throw ThistleError("invalid_argument",
                       std::string(key) + " must be a boolean.");
  }
  return iterator->get<bool>();
}

json parse_json_object(const char *text, const char *what) {
  if (text == nullptr || text[0] == '\0') {
    return json::object();
  }
  json value = json::parse(text, nullptr, false);
  if (value.is_discarded() || !value.is_object()) {
    throw ThistleError("invalid_argument",
                       std::string(what) + " must be a JSON object.");
  }
  return value;
}

std::vector<Message> read_messages(const json &request) {
  const auto iterator = request.find("messages");
  if (iterator == request.end() || !iterator->is_array() ||
      iterator->empty()) {
    throw ThistleError("invalid_argument",
                       "messages must be a non-empty array.");
  }
  std::vector<Message> messages;
  for (const auto &item : *iterator) {
    if (!item.is_object() || !item.contains("role") ||
        !item.contains("content") || !item["role"].is_string() ||
        !item["content"].is_string()) {
      throw ThistleError("invalid_argument",
                         "Each message needs string role and content fields.");
    }
    Message message{item["role"].get<std::string>(),
                    item["content"].get<std::string>()};
    if (message.role != "system" && message.role != "user" &&
        message.role != "assistant") {
      throw ThistleError("invalid_argument",
                         "Message roles must be system, user, or assistant.");
    }
    if (!is_valid_utf8(message.content)) {
      throw ThistleError("invalid_argument",
                         "Message content must be valid UTF-8.");
    }
    messages.push_back(std::move(message));
  }
  if (messages.back().role != "user") {
    throw ThistleError("invalid_argument",
                       "The last message must have the user role.");
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Engine operations

uint64_t load_model(const char *path, const char *options_json) {
  if (path == nullptr || path[0] == '\0') {
    throw ThistleError("invalid_argument", "Model path is empty.");
  }
  const json options = parse_json_object(options_json, "Model options");
  std::string chat_template;
  if (const auto it = options.find("chatTemplate");
      it != options.end() && !it->is_null()) {
    if (!it->is_string()) {
      throw ThistleError("invalid_argument", "chatTemplate must be a string.");
    }
    chat_template = it->get<std::string>();
  }

  ensure_backend();
  auto model = std::make_shared<Model>();
  {
    LogCapture capture;
    auto params = llama_model_default_params();
    params.n_gpu_layers = -1;
    model->model = llama_model_load_from_file(path, params);
    if (model->model == nullptr) {
      throw ThistleError("model_load_failed",
                         std::string("Unable to load GGUF model at ") + path +
                             "." + capture.summary());
    }
  }
  if (llama_model_has_encoder(model->model) ||
      !llama_model_has_decoder(model->model)) {
    throw ThistleError("unsupported_model",
                       "Only decoder-only text generation models are "
                       "supported.");
  }
  const llama_vocab *vocab = llama_model_get_vocab(model->model);
  if (vocab == nullptr || llama_vocab_n_tokens(vocab) <= 0) {
    throw ThistleError("unsupported_model",
                       "The GGUF file does not contain a tokenizer.");
  }
  model->formatter = make_formatter(model->model, chat_template);

  std::lock_guard<std::mutex> lock(registry_mutex);
  const uint64_t model_id = next_model_id++;
  models.emplace(model_id, std::move(model));
  return model_id;
}

void warmup(uint64_t model_id, int32_t max_context_size) {
  if (max_context_size < 0) {
    throw ThistleError("invalid_argument",
                       "maxContextSize must not be negative.");
  }
  auto model = acquire_model(model_id);
  std::lock_guard<std::mutex> lock(model->run_mutex);
  throw_if_unloaded(*model);
  const llama_vocab *vocab = llama_model_get_vocab(model->model);
  uint32_t n_ctx = static_cast<uint32_t>(
      max_context_size > 0 ? std::min(max_context_size, kWarmupContextSize)
                           : kWarmupContextSize);
  const int32_t trained = llama_model_n_ctx_train(model->model);
  if (trained > 0) {
    n_ctx = std::min<uint32_t>(n_ctx, static_cast<uint32_t>(trained));
  }
  auto context = create_context(*model, n_ctx, 1);
  llama_token token = llama_vocab_bos(vocab);
  if (token == LLAMA_TOKEN_NULL) {
    token = llama_vocab_eos(vocab);
  }
  if (token == LLAMA_TOKEN_NULL) {
    token = 0;
  }
  decode(*model, context.get(), &token, 1);
}

std::string prompt(uint64_t model_id, const char *request_json,
                   thistle_stream_callback callback = nullptr,
                   void *callback_context = nullptr) {
  const json request = parse_json_object(request_json, "Prompt request");
  const auto messages = read_messages(request);
  auto model = acquire_model(model_id);
  // One generation per model at a time keeps memory use predictable.
  std::lock_guard<std::mutex> lock(model->run_mutex);
  throw_if_unloaded(*model);

  const llama_vocab *vocab = llama_model_get_vocab(model->model);
  const int64_t trained = llama_model_n_ctx_train(model->model);
  const int64_t context_limit = trained > 0 ? trained : kMaxContextSize;

  int64_t n_ctx = read_integer(request, "maxContextSize", kDefaultContextSize,
                               16, kMaxContextSize);
  n_ctx = std::min(n_ctx, context_limit);
  const int64_t max_output = read_integer(
      request, "maxOutputTokens", std::min(kDefaultMaxOutputTokens, n_ctx / 2),
      1, kMaxContextSize);
  if (max_output >= n_ctx) {
    throw ThistleError("invalid_argument",
                       "maxOutputTokens (" + std::to_string(max_output) +
                           ") must be smaller than the context size (" +
                           std::to_string(n_ctx) + ").");
  }
  const int64_t max_input =
      std::min(read_integer(request, "maxInputTokens", n_ctx, 1,
                            kMaxContextSize),
               n_ctx - max_output);
  const int64_t max_reasoning =
      read_integer(request, "maxReasoningTokens", 0, 0, kMaxContextSize);
  const bool enable_thinking = read_bool(request, "enableThinking", false);
  const double temperature = read_number(request, "temperature", 0.7, 0, 100);
  const int64_t top_k = read_integer(request, "topK", 40, 0, 1000000);
  const double top_p = read_number(request, "topP", 0.9, 0, 1);
  const double min_p = read_number(request, "minP", 0.05, 0, 1);
  const double repeat_penalty =
      read_number(request, "repeatPenalty", 1.1, 0.01, 10);
  const int64_t repeat_last_n =
      read_integer(request, "repeatLastN", 64, 0, kMaxContextSize);
  const int64_t seed = read_integer(request, "seed", LLAMA_DEFAULT_SEED, 0,
                                    std::numeric_limits<uint32_t>::max());

  const auto segments =
      render_prompt(model->formatter, messages, enable_thinking);
  auto prompt_tokens = tokenize_prompt(vocab, segments);
  if (prompt_tokens.empty()) {
    throw ThistleError("invalid_argument", "The prompt is empty.");
  }
  const auto prompt_size = static_cast<int64_t>(prompt_tokens.size());
  if (prompt_size > max_input) {
    throw ThistleError(
        "context_length_exceeded",
        "The prompt uses " + std::to_string(prompt_size) +
            " tokens, but only " + std::to_string(max_input) +
            " input tokens are available (context " + std::to_string(n_ctx) +
            ", reserved output " + std::to_string(max_output) + ").");
  }

  // Detect a reasoning block opened by the generation prompt itself.
  std::string prompt_tail;
  for (auto it = segments.rbegin(); it != segments.rend() && !it->is_input;
       ++it) {
    prompt_tail = it->text + prompt_tail;
  }
  const size_t open_in_prompt = prompt_tail.rfind(kThinkOpen);
  const size_t close_in_prompt = prompt_tail.rfind(kThinkClose);
  bool in_reasoning =
      open_in_prompt != std::string::npos &&
      (close_in_prompt == std::string::npos || close_in_prompt < open_in_prompt);
  bool reasoning_decided = in_reasoning;
  bool reasoning_started = in_reasoning;

  // Leave room for a sampled token plus forced reasoning-close tokens.
  const int64_t n_batch = std::min<int64_t>(
      n_ctx, std::clamp<int64_t>(prompt_size, 32, kMaxPromptBatch));
  auto context = create_context(*model, static_cast<uint32_t>(n_ctx),
                                static_cast<uint32_t>(n_batch));

  auto chain_params = llama_sampler_chain_default_params();
  chain_params.no_perf = true;
  SamplerPtr sampler(llama_sampler_chain_init(chain_params));
  llama_sampler_chain_add(
      sampler.get(),
      llama_sampler_init_penalties(llama_vocab_n_tokens(vocab),
                                   static_cast<int32_t>(repeat_last_n),
                                   static_cast<float>(repeat_penalty), 0.0f,
                                   0.0f));
  if (temperature <= 0) {
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
  } else {
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_top_k(static_cast<int32_t>(top_k)));
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_top_p(static_cast<float>(top_p), 1));
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_min_p(static_cast<float>(min_p), 1));
    llama_sampler_chain_add(sampler.get(),
                            llama_sampler_init_temp(static_cast<float>(temperature)));
    llama_sampler_chain_add(
        sampler.get(), llama_sampler_init_dist(static_cast<uint32_t>(seed)));
  }

  decode(*model, context.get(), prompt_tokens.data(), prompt_tokens.size());

  std::string generated;
  size_t emitted = 0;
  const auto emit = [&](bool final) {
    if (!callback) return;
    std::string answer = generated;
    const size_t close = generated.find(kThinkClose);
    if (close != std::string::npos &&
        (reasoning_started || generated.find(kThinkOpen) < close)) {
      answer = generated.substr(close + std::strlen(kThinkClose));
    } else if (reasoning_started || (!final && !reasoning_decided)) {
      return;
    }
    if (!final) {
      // Never publish a prefix that could become a template stop marker.
      size_t safe = answer.size();
      for (const auto &stop : model->formatter.stop_strings) {
        for (size_t n = 1; n < stop.size() && n <= answer.size(); ++n) {
          if (answer.compare(answer.size() - n, n, stop, 0, n) == 0) {
            safe = std::min(safe, answer.size() - n);
          }
        }
      }
      answer.resize(safe);
    }
    answer = sanitize_utf8(trim(answer));
    if (answer.size() > emitted) {
      const auto delta = answer.substr(emitted);
      callback(delta.data(), delta.size(), callback_context);
      emitted = answer.size();
    }
  };
  int64_t completion_tokens = 0;
  int64_t reasoning_tokens = 0;
  std::string finish_reason = "length";
  // Tokens to feed back into the model; lives across iterations so batches
  // never point at out-of-scope storage.
  std::vector<llama_token> pending;
  const auto close_tokens = tokenize(vocab, "\n</think>\n\n", true);

  while (completion_tokens < max_output) {
    throw_if_unloaded(*model);
    const llama_token token = llama_sampler_sample(sampler.get(), context.get(), -1);
    if (llama_vocab_is_eog(vocab, token)) {
      finish_reason = "stop";
      break;
    }
    const size_t previous_size = generated.size();
    generated += token_to_piece(vocab, token, false);
    ++completion_tokens;
    pending.assign(1, token);

    size_t stop_at = std::string::npos;
    for (const auto &stop : model->formatter.stop_strings) {
      const size_t from =
          previous_size >= stop.size() ? previous_size - stop.size() + 1 : 0;
      stop_at = std::min(stop_at, generated.find(stop, from));
    }
    if (stop_at != std::string::npos) {
      generated.resize(stop_at);
      finish_reason = "stop";
      break;
    }

    if (!reasoning_decided) {
      const std::string lead = trim(generated);
      const std::string open_tag = kThinkOpen;
      if (starts_with(lead, open_tag)) {
        in_reasoning = reasoning_started = reasoning_decided = true;
      } else if (!lead.empty() &&
                 !starts_with(open_tag, lead.substr(0, open_tag.size()))) {
        reasoning_decided = true;
      }
    }
    if (in_reasoning) {
      ++reasoning_tokens;
      if (generated.find(kThinkClose) != std::string::npos) {
        in_reasoning = false;
      } else if (max_reasoning > 0 && reasoning_tokens >= max_reasoning &&
                 completion_tokens + static_cast<int64_t>(close_tokens.size()) <
                     max_output) {
        // Budget exhausted: close the reasoning block so the model answers.
        for (const auto close_token : close_tokens) {
          llama_sampler_accept(sampler.get(), close_token);
        }
        pending.insert(pending.end(), close_tokens.begin(), close_tokens.end());
        generated += "\n</think>\n\n";
        completion_tokens += static_cast<int64_t>(close_tokens.size());
        in_reasoning = false;
      }
    }
    emit(false);
    if (completion_tokens >= max_output) {
      break;
    }
    decode(*model, context.get(), pending.data(), pending.size());
  }

  throw_if_unloaded(*model);
  emit(true);
  throw_if_unloaded(*model);
  std::string text = generated;
  std::string reasoning;
  const size_t close = generated.find(kThinkClose);
  if (close != std::string::npos && (reasoning_started ||
                                     generated.find(kThinkOpen) < close)) {
    reasoning = generated.substr(0, close);
    text = generated.substr(close + std::strlen(kThinkClose));
  } else if (reasoning_started) {
    reasoning = generated;
    text.clear();
  }
  reasoning = trim(reasoning);
  if (starts_with(reasoning, kThinkOpen)) {
    reasoning = trim(reasoning.substr(std::strlen(kThinkOpen)));
  }

  json result = {
      {"text", sanitize_utf8(trim(text))},
      {"reasoning", sanitize_utf8(reasoning)},
      {"finishReason", finish_reason},
      {"promptTokens", prompt_size},
      {"completionTokens", completion_tokens},
      {"reasoningTokens", reasoning_tokens},
      {"contextSize", n_ctx},
  };
  return result.dump(-1, ' ', false, json::error_handler_t::replace);
}

bool unload_model(uint64_t model_id) {
  std::shared_ptr<Model> model;
  {
    std::lock_guard<std::mutex> lock(registry_mutex);
    const auto iterator = models.find(model_id);
    if (iterator == models.end()) {
      return false;
    }
    model = std::move(iterator->second);
    models.erase(iterator);
  }
  model->unloaded.store(true);
  return true;
}

char *copy_string(const std::string &value) {
  auto *result = static_cast<char *>(std::malloc(value.size() + 1));
  if (result != nullptr) {
    std::memcpy(result, value.c_str(), value.size() + 1);
  }
  return result;
}

void set_error(char **error_message, const std::string &message) {
  if (error_message != nullptr) {
    *error_message = copy_string(message);
  }
}

template <typename Function>
auto guarded(char **error_message, decltype(std::declval<Function>()()) fallback,
             Function &&function) -> decltype(function()) {
  if (error_message != nullptr) {
    *error_message = nullptr;
  }
  try {
    return function();
  } catch (const ThistleError &error) {
    set_error(error_message, error.what());
  } catch (const std::bad_alloc &) {
    set_error(error_message, "[thistle:out_of_memory] Not enough memory.");
  } catch (const std::exception &error) {
    set_error(error_message,
              std::string("[thistle:internal_error] ") + error.what());
  } catch (...) {
    set_error(error_message, "[thistle:internal_error] Unknown error.");
  }
  return fallback;
}

} // namespace

extern "C" {

uint64_t thistle_engine_load_model(const char *path, const char *options_json,
                                   char **error_message) {
  return guarded(error_message, uint64_t{0},
                 [&] { return load_model(path, options_json); });
}

int32_t thistle_engine_warmup(uint64_t model_id, int32_t max_context_size,
                              char **error_message) {
  return guarded(error_message, int32_t{0}, [&] {
    warmup(model_id, max_context_size);
    return int32_t{1};
  });
}

char *thistle_engine_prompt(uint64_t model_id, const char *request_json,
                            char **error_message) {
  return guarded(error_message, static_cast<char *>(nullptr), [&] {
    char *result = copy_string(prompt(model_id, request_json));
    if (result == nullptr) {
      throw std::bad_alloc();
    }
    return result;
  });
}

char *thistle_engine_stream(uint64_t model_id, const char *request_json,
                            thistle_stream_callback callback, void *context,
                            char **error_message) {
  return guarded(error_message, static_cast<char *>(nullptr), [&] {
    if (!callback) {
      throw ThistleError("invalid_argument", "A stream callback is required.");
    }
    char *result = copy_string(prompt(model_id, request_json, callback, context));
    if (!result) throw std::bad_alloc();
    return result;
  });
}

int32_t thistle_engine_unload_model(uint64_t model_id) {
  try {
    return unload_model(model_id) ? 1 : 0;
  } catch (...) {
    return 0;
  }
}

void thistle_engine_free_string(char *value) { std::free(value); }

} // extern "C"
