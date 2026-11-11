# ThistleEngine native tests

`engine_test` exercises the shared C++ engine used by both the iOS and Android
bindings against a real instruct GGUF. It covers structured multi-turn
prompts, UTF-8 round trips and rejection of invalid UTF-8, special-token
injection, output and context limits, reasoning budgets, built-in and custom
chat templates, and unload while a prompt is running. By default it builds with
AddressSanitizer.

Streaming checks compare real-model deltas and final metadata with greedy
non-streaming completions, including emoji and reasoning opened by the chat
template. Chunks must be valid UTF-8 and concatenate to the final answer without
reasoning tags.

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

The wildcard command runs whichever GGUFs are currently present. These are host
CPU checks, not on-device performance or answer-quality certification. The
contract suite also includes answer-content assertions and explicit ChatML
overrides; failures must be interpreted separately from memory-safety failures.

## Reproducible multi-model evaluation

Build correctness checks with AddressSanitizer and the timing harness without
it. Both configurations disable Metal and retain the available CPU/Accelerate
backend. Run the models sequentially to avoid overlapping model allocations:

```sh
cmake -S cpp/thistle/tests -B build/evaluation-asan \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTHISTLE_TEST_ASAN=ON
cmake --build build/evaluation-asan --target engine_test model_smoke -j 2
cmake -S cpp/thistle/tests -B build/evaluation-benchmark \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTHISTLE_TEST_ASAN=OFF
cmake --build build/evaluation-benchmark --target engine_bench -j 2
node cpp/thistle/tests/evaluate.mjs example/assets \
  build/evaluation-asan build/evaluation-benchmark build/evaluation-results
```

The runner requires Node.js and macOS, fingerprints model files, relevant source
files and executables, and records the repository revision and vendored llama.cpp
tree hash. A vendored tree hash is not an upstream llama.cpp commit. Existing
worktree changes are recorded rather than discarded.

All `.gguf` files in the chosen assets directory are included except
`Qwen3VL-2B-Instruct-Q4_K_M.gguf`, with Qwen3.5-2B used as the selected Qwen
representative. Files are tested in filename order, each executable runs in a
fresh process, and each invocation has a five-minute timeout. A failure is saved
and does not prevent subsequent models from being tested. The runner exits
nonzero if any invocation fails. `results.json` and the per-invocation logs
retain load failures, assertion failures, process errors, and benchmark output.

`engine_bench` measures one model load, a one-token native warmup, and three
streaming requests using the same forest/river prompt, greedy decoding, seed 42,
a 2,048-token context, and a 64-token output budget. Thinking is disabled in the
request, with no separate reasoning cap. Prompts, completions, chunk counts,
first-answer-delta times, end-to-end times, and unload observations are saved.
An optional positive integer argument selects a different trial count, for
example `engine_bench path/to/model.gguf 2` adds a two-trial measurement run.
The default remains three trials. Combining those observations gives five
generation trials across two loads, not five independent machines or loads.
The throughput is generated completion tokens divided by the entire streaming
request duration, including prefill and callback work, not isolated decode
throughput. No first-generated-token time is exposed by this harness.

Peak RSS is the process high-water mark from `getrusage`; on macOS, current RSS
is also sampled with `task_info` before and after unloading. Neither value is an
iPhone memory measurement or a leak proof. Hashing and correctness tests precede
timing, with no controlled cache eviction, so load times are not controlled
cold-start measurements.
Three trials of one prompt are descriptive observations, not a model-quality
benchmark, statistically robust performance ranking, or an overhead comparison
with llama.rn. These checks do not exercise Swift, Kotlin/JNI, Nitro dispatch,
native asset packaging, UI frame timing, or physical-device thermal behavior.
