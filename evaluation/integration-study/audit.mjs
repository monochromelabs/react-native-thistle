import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const hash = (file) =>
  createHash("sha256")
    .update(readFileSync(path.join(root, file)))
    .digest("hex");
const files = [
  "src/App.tsx",
  "src/protocol.ts",
  "src/thistle.ts",
  "src/llama.ts",
  "src/usage.ts",
  "tests/adapters.test.cjs",
  "package.json",
  "package-lock.json",
  "ios/Podfile",
  "ios/Podfile.lock",
  "pod-lock-thistle.lock",
  "pod-lock-llama.lock",
  "react-native.config.js",
  "metro.config.js",
  "ios/ThistleLite/AppDelegate.swift",
  "node_modules/llama.rn/src/index.ts",
  "node_modules/llama.rn/src/types.ts",
  "node_modules/llama.rn/README.md",
  "node_modules/react-native-thistle/src/index.tsx",
  "node_modules/react-native-thistle/scripts/setup.cjs",
];
const result = {
  recorded_at: new Date().toISOString(),
  scope:
    "Matched text-chat artifact, source responsibilities, and adapter validation",
  versions: Object.fromEntries(
    [
      "react",
      "react-native",
      "react-native-nitro-modules",
      "react-native-thistle",
      "llama.rn",
    ].map((name) => [
      name,
      JSON.parse(read(`node_modules/${name}/package.json`)).version,
    ]),
  ),
  source_provenance: {
    thistle_revision: "359b43c6cb04a78cb8722710cf89c8c10508b0f5",
    llama_rn_npm_git_head: "2a20c13e6665cc7278f68c6b2b5819899d0e84fd",
    note: "The Thistle checkout includes the previously documented native evaluation tooling; installed source hashes below identify the inspected API.",
  },
  files: Object.fromEntries(
    files.map((file) => [file, { sha256: hash(file) }]),
  ),
  adapters: Object.fromEntries(
    ["thistle", "llama"].map((name) => {
      const source = read(`src/${name}.ts`).trimEnd();
      return [
        name,
        {
          physical_lines: source.split("\n").length,
          nonblank_lines: source.split("\n").filter((line) => line.trim())
            .length,
        },
      ];
    }),
  ),
  interpretation:
    "Line counts depend on this shared shell and adapter contract. They do not measure usability, integration time, runtime speed, or general feature coverage.",
};
writeFileSync(
  path.join(root, "artifact-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result.adapters, null, 2));
