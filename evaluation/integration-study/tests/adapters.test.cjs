const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies) {
  const filename = path.resolve(__dirname, "../src", file + ".ts");
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      exports: module.exports,
      module,
      require(name) {
        if (name in dependencies) return dependencies[name];
        if (name === "./protocol") return load("protocol", {});
        throw new Error("Unexpected dependency: " + name);
      },
    },
    { filename },
  );
  return module.exports;
}

for (const provider of ["thistle", "llama"]) {
  function fixture({ fail = false, chunks = ["Se", "ine"], tokens = 2 } = {}) {
    const calls = [];
    let releases = 0;
    const native = {
      async chat(messages) {
        calls.push({ kind: "chat", messages });
        if (fail) throw new Error("native failure");
        return { text: "Seine", completionTokens: tokens };
      },
      async stream(messages, onDelta) {
        calls.push({ kind: "stream", messages });
        for (const chunk of chunks) onDelta(chunk);
        if (fail) throw new Error("native failure");
        return { text: "Seine", completionTokens: tokens };
      },
      unload() {
        releases++;
      },
      async completion(options, callback) {
        calls.push({ kind: callback ? "stream" : "chat", ...options });
        if (callback) for (const token of chunks) callback({ token });
        if (fail) throw new Error("native failure");
        return { text: "Seine", tokens_predicted: tokens };
      },
      async release() {
        releases++;
      },
    };
    const dependencies = {
      "react-native-thistle": {
        Thistle: {
          async init(model, options) {
            calls.push({ kind: "init", model, ...options });
            return native;
          },
        },
      },
      "llama.rn": {
        async initLlama(options) {
          calls.push({ kind: "init", ...options });
          return native;
        },
      },
    };
    return {
      ...load(provider, dependencies),
      exercise: load("protocol", {}).exercise,
      calls,
      releases: () => releases,
    };
  }

  test(`${provider}: maps model path, context and generation limits`, async () => {
    const f = fixture();
    const session = await f.createSession("/model.gguf");
    await session.complete([{ role: "user", content: "Hello" }]);
    const init = f.calls[0];
    assert.equal(init.model, "/model.gguf");
    if (provider === "thistle") {
      assert.equal(init.maxContextSize, 2048);
      assert.equal(init.maxOutputTokens, 64);
      assert.equal(init.enableThinking, false);
      assert.equal(init.temperature, 0);
      assert.equal(init.seed, 42);
    } else {
      assert.equal(init.n_ctx, 2048);
      assert.equal(init.n_gpu_layers, 0);
      assert.equal(f.calls[1].n_predict, 64);
      assert.equal(f.calls[1].temperature, 0);
      assert.equal(f.calls[1].seed, 42);
      assert.equal(f.calls[1].enable_thinking, false);
    }
  });

  test(`${provider}: preserves transcript and reconstructs deltas`, async () => {
    const f = fixture();
    const result = await f.exercise(f.createSession, "/model.gguf");
    assert.equal(result.chunks.join(""), result.second.text);
    const followup = f.calls[2].messages;
    assert.equal(followup.length, 4);
    assert.equal(followup[2].role, "assistant");
    assert.equal(followup[2].content, result.first.text);
    assert.equal(f.releases(), 1);
  });

  test(`${provider}: propagates native failures and releases`, async () => {
    const f = fixture({ fail: true });
    await assert.rejects(
      f.exercise(f.createSession, "/model.gguf"),
      /native failure/,
    );
    assert.equal(f.releases(), 1);
  });

  test(`${provider}: detects mismatched streaming output and releases`, async () => {
    const f = fixture({ chunks: ["wrong"] });
    await assert.rejects(
      f.exercise(f.createSession, "/model.gguf"),
      /reconstruct/,
    );
    assert.equal(f.releases(), 1);
  });

  test(`${provider}: detects a missing stream and releases`, async () => {
    const f = fixture({ chunks: [] });
    await assert.rejects(
      f.exercise(f.createSession, "/model.gguf"),
      /No streaming/,
    );
    assert.equal(f.releases(), 1);
  });

  test(`${provider}: detects excessive output and releases`, async () => {
    const f = fixture({ tokens: 65 });
    await assert.rejects(
      f.exercise(f.createSession, "/model.gguf"),
      /budget exceeded/,
    );
    assert.equal(f.releases(), 1);
  });
}
