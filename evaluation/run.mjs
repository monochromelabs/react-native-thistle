import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const binary = process.argv[2] && resolve(process.argv[2]);
if (!binary) throw new Error('Usage: node run.mjs BENCHMARK_BINARY [ASSETS]');
const assets = resolve(process.argv[3] ?? join(root, 'example/assets'));
const read = (file) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const original = read('results.json');
assert.equal(original.schema_version, 2, 'Expected consolidated results schema');
const initial = original.batches.find((batch) => batch.id === 'initial');
assert.ok(initial, 'Missing initial source provenance');
const diagnostic = read('granite-diagnostic.json');
const files = [
  'Qwen3.5-2B-Q4_K_M.gguf',
  'gemma-4-E2B-it-Q4_K_M.gguf',
  'SmolVLM2-2.2B-Instruct-Q4_K_M.gguf',
  'Cosmos-Reason2-2B-Q4_K_M.gguf',
  'MiniCPM5-2B-Q4_K_M.gguf',
  'granite-3.3-2b-instruct-Q4_K_M.gguf',
];

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

function command(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const report = {
  started_at: new Date().toISOString(),
  scope: 'Two additional generation trials per model on the same host',
  host: {
    platform: platform(), architecture: arch(), kernel: release(),
    memory_bytes: totalmem(),
    cpu: command('sysctl', ['-n', 'machdep.cpu.brand_string']),
    os: command('sw_vers', ['-productVersion']),
  },
  source: {
    commit: command('git', ['rev-parse', 'HEAD']),
    worktree_status: command('git', ['status', '--short']),
    files: {},
  },
  binary: { path: binary, sha256: await hash(binary) },
  runner_sha256: await hash(fileURLToPath(import.meta.url)),
  models: [],
};
for (const file of Object.keys(initial.source.files)) {
  report.source.files[file] = await hash(join(root, file));
}
for (const file of ['cpp/thistle/ThistleEngine.cpp', 'cpp/thistle/ThistleEngine.h']) {
  assert.equal(report.source.files[file], initial.source.files[file]);
}
function saveReport() {
  const { models, ...metadata } = report;
  const batch = { id: 'additional-trials', ...metadata };
  const archive = {
    ...original,
    batches: [
      ...original.batches.filter((item) => item.id !== batch.id),
      batch,
    ],
    models: original.models.map((model) => {
      const current = models.find((item) => item.file === model.file);
      if (!current) return model;
      const { file, sha256, ...run } = current;
      return {
        ...model,
        runs: [
          ...model.runs.filter((item) => item.batch !== batch.id),
          { batch: batch.id, target: 'engine_bench', ...run },
        ],
      };
    }),
  };
  writeFileSync(join(directory, 'results.json'), JSON.stringify(archive, null, 2));
}
writeFileSync(join(directory, 'engine_bench.cpp'), readFileSync(join(root, 'cpp/thistle/tests/engine_bench.cpp')));
let failed = false;
for (const file of [...files].sort()) {
  const previous = original.models.find((m) => m.file === file);
  const path = join(assets, file);
  const sha256 = await hash(path);
  assert.equal(sha256, previous.sha256, `Changed model: ${file}`);
  const started = Date.now();
  const result = spawnSync(binary, [path, '2'], {
    encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
  });
  const log = `${file}.engine_bench.log`;
  writeFileSync(join(directory, log), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const run = {
    file, sha256, exit_code: result.status, signal: result.signal,
    process_error: result.error?.message ?? null, wall_ms: Date.now() - started, log,
  };
  if (result.stdout?.trim()) run.measurements = JSON.parse(result.stdout);
  report.models.push(run);
  if (result.status !== 0 || result.error) failed = true;
  saveReport();
  console.log(`${file}: exit=${result.status}, trials=${run.measurements?.trials.length ?? 0}`);
}
report.completed_at = new Date().toISOString();
saveReport();
if (failed) throw new Error('Additional benchmark invocation failed; inspect retained logs');

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = files.map((file) => {
  const previous = original.models.find((m) => m.file === file);
  const first = file.startsWith('granite')
    ? diagnostic.runs.find((r) => r.target === 'engine_bench').measurements
    : previous.runs.find((r) => r.target === 'engine_bench' && r.batch !== 'additional-trials').measurements;
  const second = report.models.find((m) => m.file === file).measurements;
  assert.deepEqual(second.request, first.request);
  assert.equal(first.trials.length, 3);
  assert.equal(second.trials.length, 2);
  const trials = [...first.trials, ...second.trials];
  for (const trial of trials) {
    assert.equal(trial.stream_matches_completion, true);
    assert.equal(trial.completion.completionTokens, 64);
    assert.equal(trial.completion.reasoningTokens, 0);
    assert.equal(trial.completion.finishReason, 'length');
    assert.ok(trial.completion.text.length > 0);
    assert.ok(trial.first_answer_delta_ms >= 0);
  }
  const throughputs = trials.map((t) => t.end_to_end_tokens_per_second);
  const deltas = trials.map((t) => t.first_answer_delta_ms);
  return {
    file, trials: 5, successful_loads: 2,
    load_s: median([first.load_ms, second.load_ms]) / 1000,
    first_delta_ms: median(deltas),
    tokens_per_second: median(throughputs),
    throughput_range: [Math.min(...throughputs), Math.max(...throughputs)],
    delta_range: [Math.min(...deltas), Math.max(...deltas)],
    peak_rss_mib: Math.max(first.memory_after_unload.peak_rss_bytes, second.memory_after_unload.peak_rss_bytes) / 2 ** 20,
    post_unload_mib: median([first.memory_after_unload.resident_bytes, second.memory_after_unload.resident_bytes]) / 2 ** 20,
  };
});
writeFileSync(join(directory, 'five-trial-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
