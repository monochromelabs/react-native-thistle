import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, release, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [assets, asanBuild, benchmarkBuild, output] = process.argv.slice(2);
if (!assets || !asanBuild || !benchmarkBuild || !output) {
  throw new Error(
    'Usage: node evaluate.mjs ASSETS ASAN_BUILD BENCHMARK_BUILD OUTPUT'
  );
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputDirectory = resolve(output);
mkdirSync(outputDirectory, { recursive: true });

function command(program, args, cwd = root) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

const targets = [
  ['model_smoke', resolve(asanBuild, 'model_smoke')],
  ['engine_test', resolve(asanBuild, 'engine_test')],
  ['engine_bench', resolve(benchmarkBuild, 'engine_bench')],
];
for (const [, executable] of targets) {
  if (!existsSync(executable)) throw new Error(`Missing binary: ${executable}`);
}
const report = {
  started_at: new Date().toISOString(),
  host: {
    platform: platform(),
    architecture: arch(),
    kernel: release(),
    memory_bytes: totalmem(),
    cpu: command('sysctl', ['-n', 'machdep.cpu.brand_string']),
    os: command('sw_vers', ['-productVersion']),
  },
  source: {
    commit: command('git', ['rev-parse', 'HEAD']),
    llama_tree: command('git', ['rev-parse', 'HEAD:cpp/llama.cpp']),
    worktree_status: command('git', ['status', '--short']),
    files: {},
  },
  binaries: {},
  excluded: ['Qwen3VL-2B-Instruct-Q4_K_M.gguf'],
  models: [],
};
for (const file of [
  'cpp/thistle/ThistleEngine.cpp',
  'cpp/thistle/ThistleEngine.h',
  'cpp/thistle/tests/CMakeLists.txt',
  'cpp/thistle/tests/model_smoke.cpp',
  'cpp/thistle/tests/engine_test.cpp',
  'cpp/thistle/tests/engine_bench.cpp',
  'cpp/thistle/tests/evaluate.mjs',
]) {
  report.source.files[file] = await hash(join(root, file));
}
for (const [name, executable] of targets) {
  report.binaries[name] = { path: executable, sha256: await hash(executable) };
}
const files = readdirSync(assets)
  .filter((name) => name.endsWith('.gguf') && !report.excluded.includes(name))
  .sort();
if (files.length === 0) throw new Error('No selected GGUF models found');
let failures = 0;
for (const file of files) {
  const path = resolve(assets, file);
  console.log(`Evaluating ${file}`);
  const model = { file, sha256: await hash(path), runs: [] };
  report.models.push(model);
  for (const [target, executable] of targets) {
    const started = Date.now();
    const result = spawnSync(executable, [path], {
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const logFile = `${basename(file, '.gguf')}.${target}.log`;
    writeFileSync(join(outputDirectory, logFile), log);
    const run = {
      target,
      exit_code: result.status,
      signal: result.signal,
      process_error: result.error?.message ?? null,
      wall_ms: Date.now() - started,
      passed_checks: (log.match(/^ok:/gm) ?? []).length,
      failed_checks: (log.match(/^FAIL:/gm) ?? []).length,
      failed_assertions: log.match(/^FAIL:.*$/gm) ?? [],
      log: logFile,
    };
    if (target === 'engine_bench' && result.stdout?.trim()) {
      run.measurements = JSON.parse(result.stdout.trim());
    }
    if (result.status !== 0 || result.error) ++failures;
    model.runs.push(run);
    console.log(
      `  ${target}: exit=${result.status} checks=${run.passed_checks}/${run.passed_checks + run.failed_checks} signal=${result.signal}`
    );
    writeFileSync(
      join(outputDirectory, 'results.json'),
      JSON.stringify(report, null, 2)
    );
  }
}
report.completed_at = new Date().toISOString();
report.failed_runs = failures;
writeFileSync(
  join(outputDirectory, 'results.json'),
  JSON.stringify(report, null, 2)
);
console.log(`Completed ${files.length} models; ${failures} failed runs.`);
process.exitCode = failures ? 1 : 0;
