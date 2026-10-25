# ThistleEngine native tests

`engine_test` exercises the shared C++ engine used by both the iOS and Android
bindings against a real instruct GGUF. It covers structured multi-turn
prompts, UTF-8 round trips and rejection of invalid UTF-8, special-token
injection, output and context limits, reasoning budgets, built-in and custom
chat templates, and unload while a prompt is running. By default it builds with
AddressSanitizer.

```sh
cmake -S cpp/thistle/tests -B build/engine-test -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build/engine-test --target engine_test -j
./build/engine-test/engine_test path/to/instruct-model.gguf
```

The process exits non-zero if any check fails. Pass `-DTHISTLE_TEST_ASAN=OFF`
to build without the sanitizer. The ChatML and `<think>` checks use explicit
template overrides, so they are most meaningful with a ChatML-family model such
as Qwen; the suite was validated with `Qwen3VL-2B-Instruct-Q4_K_M.gguf`. This
directory is excluded from the npm package.

## Cross-model smoke test

`model_smoke` runs the same chat scenarios against any number of GGUF files:
a single question, a follow-up that depends on history, recalling an earlier
turn, emoji input, control-token text in user input, and the output cap.
Instruct models must stop on their own end-of-turn token without leaking
template markers. Models without a chat template must fail with
`missing_chat_template`, then generate cleanly with a `chatml` override.

```sh
cmake --build build/engine-test --target model_smoke -j
./build/engine-test/model_smoke example/assets/*.gguf
```

Verified under AddressSanitizer with Llama 3.2 1B Instruct, Vikhr Gemma 2B
Instruct, Qwen3-VL 2B Instruct, Ministral 3 3B Instruct (2512), and Phi-3.5 Mini
Instruct (all Q4_K_M). These used their embedded templates without overrides.
The base models Mistral 2B and Phi-2 were also tested for missing-template
errors and plain-text turn-marker stopping with an explicit ChatML override.

Only the Qwen GGUF remains in `example/assets/`; the other models were temporary
test assets. The wildcard command above runs whichever GGUFs are currently
present. These are host CPU checks, not on-device performance or answer-quality
certification.
