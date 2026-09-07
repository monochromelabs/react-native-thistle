#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

uint64_t thistle_load_model(const char *path, char **error_message);
void thistle_warmup(uint64_t model_id, int32_t max_context_size,
				 char **error_message);
char *thistle_prompt(uint64_t model_id, const char *text, int32_t max_input_tokens,
				  int32_t max_context_size, int32_t max_output_tokens,
				  int32_t max_reasoning_tokens, char **error_message);
void thistle_unload_model(uint64_t model_id);
void thistle_free_string(char *value);

#ifdef __cplusplus
}
#endif