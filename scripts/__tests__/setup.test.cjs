const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const setup = path.join(__dirname, '..', 'setup.cjs');
const nitro = 'react-native-nitro-modules';
const version = require('../../package.json').peerDependencies[nitro];

function fixture(
  t,
  {
    declared = false,
    installed = false,
    fail = false,
    noInstall = false,
    manager,
    lockfile,
  } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thistle-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageFile = path.join(root, 'package.json');
  fs.writeFileSync(
    packageFile,
    JSON.stringify({
      name: 'test-app',
      dependencies: declared ? { [nitro]: version } : {},
      packageManager: manager && `${manager}@1.0.0`,
    })
  );
  const nitroDirectory = path.join(root, 'node_modules', nitro);
  if (installed) {
    fs.mkdirSync(nitroDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(nitroDirectory, 'package.json'),
      JSON.stringify({ name: nitro, version: '0.36.5' })
    );
  }
  const npm = path.join(root, 'npm-cli.js');
  fs.writeFileSync(
    npm,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.writeFileSync('install-args.json', JSON.stringify(process.argv.slice(2)));
if (${fail}) process.exit(1);
if (${noInstall}) process.exit(0);
const app = JSON.parse(fs.readFileSync('package.json', 'utf8'));
app.dependencies['${nitro}'] = '${version}';
fs.writeFileSync('package.json', JSON.stringify(app));
const directory = path.join('node_modules', '${nitro}');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'package.json'),
  JSON.stringify({ name: '${nitro}', version: '0.36.5' }));
`,
    { mode: 0o755 }
  );
  if (manager) fs.copyFileSync(npm, path.join(root, manager));
  if (lockfile) {
    fs.writeFileSync(path.join(root, lockfile), '');
    fs.copyFileSync(
      npm,
      path.join(root, lockfile === 'yarn.lock' ? 'yarn' : 'pnpm')
    );
  }
  const run = () =>
    spawnSync(process.execPath, [setup, 'setup'], {
      cwd: root,
      env: {
        ...process.env,
        INIT_CWD: root,
        npm_execpath: npm,
        PATH: `${root}${path.delimiter}${process.env.PATH}`,
      },
      encoding: 'utf8',
    });
  return { root, run, packageFile };
}

for (const installed of [false, true]) {
  test(`declares Nitro for autolinking when the peer is ${installed ? 'present' : 'absent'}`, (t) => {
    const app = fixture(t, { installed });
    const result = app.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(app.root, 'install-args.json'))),
      ['install', `${nitro}@${version}`]
    );
    assert.equal(
      JSON.parse(fs.readFileSync(app.packageFile)).dependencies[nitro],
      version
    );
    assert.ok(fs.existsSync(path.join(app.root, '.thistle', 'models.json')));
    fs.unlinkSync(path.join(app.root, 'install-args.json'));
    const rerun = app.run();
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(
      fs.existsSync(path.join(app.root, 'install-args.json')),
      false
    );
  });
}

test('skips installation when Nitro is already a direct installed dependency', (t) => {
  const app = fixture(t, { declared: true, installed: true });
  const result = app.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(app.root, 'install-args.json')), false);
});

test('restores a declared but missing Nitro installation', (t) => {
  const app = fixture(t, { declared: true });
  const result = app.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(app.root, 'install-args.json')));
});

test('reports install failure and does not configure native assets', (t) => {
  const app = fixture(t, { fail: true });
  const result = app.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nitro installation failed/);
  assert.equal(fs.existsSync(path.join(app.root, '.thistle')), false);
  assert.equal(fs.existsSync(path.join(app.root, 'assets')), false);
  assert.doesNotMatch(result.stdout, /Setup complete/);
});

test('rejects a successful installer that did not install Nitro', (t) => {
  const app = fixture(t, { noInstall: true });
  const result = app.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nitro is not installed as an app dependency/);
  assert.equal(fs.existsSync(path.join(app.root, '.thistle')), false);
});

for (const options of [
  { manager: 'yarn' },
  { manager: 'pnpm' },
  { lockfile: 'yarn.lock' },
  { lockfile: 'pnpm-lock.yaml' },
]) {
  test(
    `uses the app's package manager: ${JSON.stringify(options)}`,
    { skip: process.platform === 'win32' },
    (t) => {
      const app = fixture(t, options);
      const result = app.run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(app.root, 'install-args.json'))),
        ['add', `${nitro}@${version}`]
      );
    }
  );
}
