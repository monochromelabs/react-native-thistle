# Matched chat integration artifact

This study compares the same minimal text-chat workflow using Thistle 0.6.0
from the local checkout and the published **llama.rn 0.12.9** release. React
Native 0.85.0, React 19.2.3, the UI, transcript state, scripted prompts, and result
checks are shared. The two provider adapters are
[thistle.ts](./src/thistle.ts) and [llama.ts](./src/llama.ts).
No inference-engine source was modified.

## What is compared

The shared [app](./src/App.tsx) supports loading, a message transcript,
incremental answer display, explicit release, and visible error reporting.
[The scripted protocol](./src/protocol.ts) makes one non-streaming request,
includes its actual answer in the follow-up history, streams that follow-up,
checks nonempty output, exact delta reconstruction, and the 64-token cap, then
releases resources in `finally`. It does not assert answer quality.

Both adapters use a 2,048-token context, greedy decoding, seed 42, and disabled
thinking. The simulator experiment uses the existing non-reasoning
SmolVLM2-2.2B-Instruct Q4_K_M text checkpoint. The llama.rn adapter forwards raw
token deltas and final `text`; this is not a general implementation of
answer-only streaming for reasoning models. Thistle selects its native backend
automatically, whereas this llama.rn adapter explicitly requests zero GPU layers.
Engine revisions, context reuse, sampling defaults, and backend selection are
not matched. Consequently, this is a functional integration comparison, **not
a latency, throughput, memory, or output-quality comparison**.

The iOS scaffold is derived from the existing example application. Each
provider is built separately, with the same UI and protocol selected through
`STUDY_PROVIDER` in autolinking and Metro configuration. A preliminary combined
build encountered conflicting vendored headers and was abandoned; its failure
is not treated as either provider's standalone result.
The original model-copy phase is removed: a provisioned filesystem path is
used for both libraries. Model acquisition, model bundling/downloads,
and production distribution are outside the executed protocol. llama.rn is
built from its packaged source using `RNLLAMA_BUILD_FROM_SOURCE=1`, rather than
its default downloaded native artifacts. Do not interpret this combined
scaffold's command count or build time as either library's normal setup cost.

## Reproduction

Run commands in this directory. The local Thistle dependency resolves to the
repository root, two directories above this study.
The lockfile pins registry dependencies. Thistle's generated public TypeScript
declarations must be available; run its normal `yarn prepare` build first if
the local checkout does not yet contain them.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
mkdir -p build
export STUDY_PROVIDER=thistle
npm run bundle
cd ios
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
cd ..
cp ios/Podfile.lock "pod-lock-${STUDY_PROVIDER}.lock"
xcodebuild -workspace ios/ThistleLite.xcworkspace -scheme ThistleLite \
  -configuration Release -sdk iphonesimulator \
  -destination 'id=SIMULATOR_UUID' -derivedDataPath build/derived \
  -jobs 2 ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
node native-run.mjs "$STUDY_PROVIDER" SIMULATOR_UUID /absolute/path/to/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf
```

Repeat the bundle, pod-install, build, and native-run steps with
`STUDY_PROVIDER=llama`. Use an available, booted ARM64 simulator.
After both runs, `node audit.mjs` refreshes the source inventory.
`native-run.mjs` installs and launches
the app with a model path supplied as initial properties. A temporary
loopback-only HTTP listener receives the selected provider's outcome; it closes when
the run completes or times out. The script saves `native-results-PROVIDER.json` and
terminates the study app. This loopback capture transports experimental results,
not inference requests, and is not part of either inference library.

`npm test` runs **12 adapter tests with mocked library interfaces**. These verify
mapping, transcript forwarding, reconstruction checks, error propagation,
budget checks, and cleanup, not actual inference or native memory safety.
Typechecking uses the real installed library declarations. Bundling resolves
the real JavaScript packages, but neither proves successful native execution.
Only recorded simulator results can establish the exercised native integration.

The repository-root `npm run typecheck` (also used by the pre-commit hook)
checks the root project and this study separately. The study has its own
dependency tree and `study-provider` alias, so it must use its own TypeScript
configuration rather than being included in the root project.

## Recorded outcomes

Both standalone Release builds succeeded on the ARM64 iPhone 17 Pro simulator
(iOS 26.5), using Xcode 26.6 on the Mac M2 host. The task was not changed after
observing an inference failure.

| Observation | Thistle | llama.rn |
|---|---|---|
| Standalone native build | Passed | Passed |
| Nonempty first answer | Yes: `ipzig`, 1 reported token | Yes: 63 reported tokens |
| Nonempty streamed follow-up | No: empty text, 0 tokens, no callbacks | Yes: 63 reported tokens |
| Exact follow-up reconstruction | Not reached: failed nonempty check | Passed, 64 chunks |
| Whole protocol | Failed | Passed |

The first Thistle run is preserved in `native-results-thistle-initial.json`.
A second run with additional intermediate-output capture reproduced the same
empty-stream failure; see `native-results-thistle.json`. The shared protocol,
prompts, and adapters otherwise remained unchanged. llama.rn's result is in
`native-results-llama.json`. The captured outputs are **not** answer-quality
scores (the llama.rn output also contains unchecked factual claims).
The cause of Thistle's behavior remains unestablished; engine revisions,
backend policy, defaults, and context handling differ. This is not evidence
that a particular API operation caused the failure, or that either library is
universally reliable or faster.
The successful native build transcripts are retained as
`native-build-thistle.log` and `native-build-llama.log`; runtime capture logs
and provider-specific CocoaPods locks accompany the JSON outcomes.

## Responsibility comparison

The inspected source and documentation are fingerprinted by
[audit.mjs](./audit.mjs). Both libraries support structured conversations,
templates, streaming, and resource release. Thistle is not the first React
Native binding to provide those operations.

| Responsibility | Thistle 0.6.0 | llama.rn 0.12.9 |
|---|---|---|
| Native integration | Nitro peer and generated interfaces | New-Architecture JSI bindings; no Nitro peer |
| Provision a model | App supplies weights; optional model-selection/packaging CLI | App supplies a model path or asset; native-artifact downloader is not a model downloader |
| Configure context | Request-scoped context limit | Context allocation at initialization |
| Configure output/sampling | Defaults on model instance; per-request overrides | Options supplied to `completion` |
| Conversation and template | Role messages; embedded template or override | Role messages; embedded template or override |
| Streaming | Separate answer-delta `stream` operation | Optional token callback on `completion`, with parsed content/reasoning fields also exposed |
| Overflow policy | Rendered-input cap reserves output budget and rejects excess | Context and output controls, with configurable context shifting; not the same input-reservation contract |
| Stop/release | `unload` removes model and aborts in-flight requests | `stopCompletion` and asynchronous context `release` |
| Transcript, UI, persistence | Application responsibility | Application responsibility |

These are API and responsibility differences, not evidence that equivalent
behavior cannot be implemented with llama.rn. Its interface also exposes
parallel decoding, tool calling, constrained output, and multimodal operations
outside the matched text-only task.

`artifact-audit.json` reports source hashes and adapter line counts. Counts
exclude the shared UI/protocol and vary with the chosen adapter contract and
formatting. They are descriptive, not developer-effort or usability scores.
Participant studies and independently implemented tasks are still needed.

The dependency manifests and Metro repository path were updated when this
study moved into `evaluation/`. Recorded source fingerprints describe the
executed versions before relocation; native results have not been regenerated
by these path-only changes.
Subsequent lint cleanup and a once-only startup-effect guard have not been
rerun on the simulator; recorded native outcomes still describe the earlier
executed source.
