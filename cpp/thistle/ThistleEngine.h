#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Shared llama.cpp engine used by the iOS and Android bridges.
//
// All strings are standard UTF-8. Strings returned through the return value
// or `error_message` must be released with thistle_engine_free_string().
// Error messages start with a machine readable tag: "[thistle:<code>] ...".

// options_json: {"chatTemplate"?: string}. Returns 0 on failure.
uint64_t thistle_engine_load_model(const char *path, const char *options_json,
                                   char **error_message);

// Returns 1 on success, 0 on failure.
int32_t thistle_engine_warmup(uint64_t model_id, int32_t max_context_size,
                              char **error_message);

// request_json: {"messages": [{"role", "content"}], limits, sampling}.
// Returns a JSON completion object, or NULL on failure.
char *thistle_engine_prompt(uint64_t model_id, const char *request_json,
                            char **error_message);

// Called synchronously on the generation thread with borrowed UTF-8 answer
// deltas (never reasoning). Do not reenter generation for the same model.
typedef void (*thistle_stream_callback)(const char *text, uint64_t length,
                                        void *context);
// Same request and completion as prompt. callback must not be NULL.
char *thistle_engine_stream(uint64_t model_id, const char *request_json,
                            thistle_stream_callback callback, void *context,
                            char **error_message);

// Idempotent. Returns 1 if a loaded model was released, 0 if the id was
// unknown or already unloaded. In-flight prompts are cancelled and the model
// memory is released once they finish.
int32_t thistle_engine_unload_model(uint64_t model_id);

void thistle_engine_free_string(char *value);

#ifdef __cplusplus
}
#endif
