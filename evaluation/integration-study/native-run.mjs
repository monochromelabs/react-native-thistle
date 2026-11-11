import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const [provider, device, model] = process.argv.slice(2);
if (!["thistle", "llama"].includes(provider) || !device || !model) {
  throw new Error(
    "Usage: node native-run.mjs PROVIDER SIMULATOR_UUID MODEL_PATH",
  );
}
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const app = path.join(
  root,
  "build/derived/Build/Products/Release-iphonesimulator/ThistleLite.app",
);
const bundleID = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleIdentifier", path.join(app, "Info.plist")],
  { encoding: "utf8" },
).trim();
execFileSync("xcrun", ["simctl", "install", device, app], { stdio: "inherit" });
const startedAt = new Date().toISOString();
let timeout;
let settle;
let fail;
const received = new Promise((resolve, reject) => {
  settle = resolve;
  fail = reject;
});
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/results") {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1024 * 1024) throw new Error("Report exceeds 1 MiB");
    }
    const report = JSON.parse(body);
    if (
      !Array.isArray(report.results) ||
      report.results.length !== 1 ||
      report.results[0].provider !== provider
    ) {
      throw new Error("Expected the selected provider outcome");
    }
    response.writeHead(200).end("Recorded");
    settle(report);
  } catch (error) {
    response.writeHead(400).end(String(error));
    fail(error);
  }
});
server.on("error", (error) => fail(error));
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  timeout = setTimeout(
    () => fail(new Error("No app report within five minutes")),
    300_000,
  );
  execFileSync(
    "xcrun",
    ["simctl", "launch", "--terminate-running-process", device, bundleID],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SIMCTL_CHILD_STUDY_MODEL_PATH: path.resolve(model),
        SIMCTL_CHILD_STUDY_REPORT_URL: `http://localhost:${port}/results`,
      },
    },
  );
  const report = await received;
  const evidence = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    scope:
      "iOS Simulator functional integration; not physical-device performance",
    device,
    bundle_id: bundleID,
    model: { file: path.basename(model), sha256: hash(model) },
    sources: Object.fromEntries(
      [
        "src/App.tsx",
        "src/protocol.ts",
        "src/thistle.ts",
        "src/llama.ts",
        "native-run.mjs",
        "package-lock.json",
        "ios/Podfile.lock",
      ].map((file) => [file, hash(path.join(root, file))]),
    ),
    ...report,
  };
  writeFileSync(
    path.join(root, `native-results-${provider}.json`),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (report.results.some((item) => item.error)) {
    throw new Error(
      `Native integration failure; see native-results-${provider}.json`,
    );
  }
} finally {
  clearTimeout(timeout);
  server.close();
  execFileSync("xcrun", ["simctl", "terminate", device, bundleID], {
    stdio: "inherit",
  });
}
