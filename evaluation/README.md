# Thistle evaluation evidence

This archive supports the six-checkpoint study of Qwen3.5-2B, Gemma 4 E2B,
SmolVLM2-2.2B, Cosmos-Reason2-2B, MiniCPM5-2B, and Granite-3.3-2B.

- Root logs, `results.json`, and `model-inventory.json` cover all six checkpoints.
- [Model results](./results.json) include MiniCPM5 and Granite results, including
  the initial Granite timeouts and [successful diagnostic retry](./granite-diagnostic.json).
- [Five-trial summary](./five-trial-summary.json) combines five measured
  generation trials per checkpoint on one M2 Mac.
- [Integration study](./integration-study/) contains the matched application
  implementations and simulator outcomes, including Thistle's failed follow-up.
- `download-listing.json` preserves the ecosystem-adoption snapshot.

All host evidence is directly in this directory. The consolidated `results.json`
uses schema version 2: `models` contains six model records with invocation-level
`runs`, and each run's `batch` identifies provenance in the top-level `batches`
array. The `initial`, `additional-models`, and `additional-trials` batches retain
their original host, source, executable, and timing metadata.
`five-trial-summary.json` combines the five generation observations per model.
Logs whose names include `.gguf.engine_bench.log` contain the extra trials,
distinct from the initial `.engine_bench.log` files.

Excluded-model logs and model entries have been removed from the initial
screening archive. Its original source and executable fingerprints are retained.
The initial screening's aggregate failure count and exclusion list are omitted
because they described a broader cohort; its metadata identifies the retained scope.
Failures for included models remain evidence, not successful runs.

Reproduction paths were updated when the archive moved into this repository.
Recorded hashes still describe the executed files; relocation edits to the runner,
dependency manifests, and Metro configuration do not imply a new measured run.
See the [native harness](../cpp/thistle/tests/README.md) for build instructions.
