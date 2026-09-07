<div align="center">
	<img src="example/assets/logo.png" alt="Thistle logo" width="128" />
	<h1>Thistle</h1>
	<p>Local GGUF inference for React Native apps.</p>
	<p>
		<img src="https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=white" alt="React Native 0.85" />
		<img src="https://img.shields.io/badge/iOS-Metal-000000?logo=apple&logoColor=white" alt="iOS Metal backend" />
		<img src="https://img.shields.io/badge/TypeScript-supported-3178C6?logo=typescript&logoColor=white" alt="TypeScript supported" />
		<img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT license" />
	</p>
</div>

Thistle is a React Native Nitro Module for running local GGUF language models on-device. It keeps the JavaScript API small while the native runtime handles tokenization, llama.cpp inference, CPU execution, and iOS Metal acceleration.

## Features

- **Local GGUF inference** from a model bundled into the native iOS app
- **iOS Metal acceleration** with CPU fallback through llama.cpp
- **Instruction scaffolding** with the built-in `eggwhite` preset or custom guidance
- **Structured context injection** for app data, attachments, and retrieved content
- **Independent model instances** so apps can manage multiple local models
- **Typed runtime limits** for input, context, output, and reasoning tokens
- **Debug logging controls** for prompt/output diagnostics during development

## Requirements

- React Native with Nitro Modules
- iOS 15.1 or newer for the current iOS implementation
- A GGUF model compatible with the bundled llama.cpp runtime
- Enough device memory for the model, context state, and Metal buffers

Thistle is a React Native package for simple, local AI inference. The intended developer experience is:

1. Install the package.
2. Drop a supported model into `assets/`.
3. Initialize one or more model instances.
4. Use those instances anywhere in your JavaScript or TypeScript code.

The public API is designed to hide Nitro Modules, native ML runtimes, tokenizers, delegates, and hardware selection from the application developer.

## Installation

```sh
npm install react-native-thistle react-native-nitro-modules
npx react-native-thistle setup
```

`react-native-nitro-modules` is required because Thistle uses [Nitro Modules](https://nitro.margelo.com/) for its native bridge.

The setup command creates the app-level `assets/` directory, configures Android to package `.gguf` files from it, and adds an iOS build phase through CocoaPods. It is safe to run again after native project changes.

Thistle is a native module. After installation or setup, rebuild the native app; a Metro reload is not enough:

```sh
npm run ios
# or
npm run android
```

For an existing React Native app, install the iOS dependencies after setup:

```sh
cd ios
pod install
cd ..
```

The package postinstall script creates an `assets/` directory in the consuming app when it does not already exist. To opt out:

```sh
THISTLE_SKIP_ASSETS=1 npm install react-native-thistle
```

Creating the folder is only a convenience. You still need to add a model file yourself.

## From Claude Or Axios

Thistle runs a local GGUF model on the device. It is not a drop-in replacement for a Claude API client, and it does not require Axios or a network request. Replace the remote request with a model instance and a local prompt:

```tsx
import { Thistle } from 'react-native-thistle';

const model = await Thistle.init('model.gguf', {
  scaffolding: 'eggwhite',
});

const answer = await model.prompt(userMessage);
```

When migrating an existing Claude integration, convert message history and system instructions into the prompt text and `scaffolding` option. Pass structured app context or attachment metadata through the `data` option. Streaming, tool calls, provider-specific message formats, and Claude model behavior require application-level changes.

## Add A Model

Put a GGUF model in the application-level `assets/` directory:

```text
my-app/
	assets/
		model.gguf
	src/
		chat.ts
```

For iOS, CocoaPods copies `.gguf` files from the application-level `assets/` directory into the app bundle during the build. For Android, the setup command configures `android/app/build.gradle` to use that same application-level `assets/` directory as an Android asset source. You do not need to copy the model into `android/app/src/main/assets/` separately. Both platforms can initialize the model by filename:

```tsx
const model = await Thistle.init('model.gguf');
```

The example Metro configuration blocks `.gguf` files from the JavaScript bundle, which avoids Metro's asset-size limits for large models. If your app has its own Metro setup and uses a small static asset with `require('./assets/model.gguf')`, Thistle also accepts the resulting React Native asset reference. Dynamic paths such as `require(pathFromUserInput)` cannot be resolved by Metro. Set `THISTLE_MODEL_DIR` during the iOS build if your models live in a different directory.

## Initialize And Prompt

```tsx
import { Thistle } from 'react-native-thistle';

const model = await Thistle.init('model.gguf', {
  scaffolding: 'eggwhite',
  maxInputTokens: 0,
  maxContextSize: 0,
  maxOutputTokens: 0,
  maxReasoningTokens: 0,
  debug: false,
});
const answer = await model.prompt('What is the capital of France?');

console.log(answer);
```

`scaffolding` is optional persistent guidance applied to every prompt. The built-in `eggwhite` preset provides conservative assistant behavior, evidence-aware answers, arithmetic checking, and attachment handling. You can also pass your own scaffolding string. `maxInputTokens`, `maxContextSize`, `maxOutputTokens`, and `maxReasoningTokens` are numeric runtime limits. Falsy values such as `0`, `undefined`, and `null` mean no explicit limit; the model's own context capacity remains the hard upper bound. Each setting can be overridden for an individual prompt.

### Runtime Options

| Option               | Applied when   | Falsy value                                           | Purpose                                                                   |
| -------------------- | -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `scaffolding`        | Every prompt   | No scaffolding                                        | Persistent system-style guidance; use `eggwhite` for the built-in preset. |
| `maxInputTokens`     | Each prompt    | No input limit                                        | Rejects prompts whose tokenized input exceeds this value.                 |
| `maxContextSize`     | Each prompt    | Model context size                                    | Caps the context/KV-cache window used by native inference.                |
| `maxOutputTokens`    | Each prompt    | Generate until the context is full or the model stops | Caps newly generated tokens.                                              |
| `maxReasoningTokens` | Each prompt    | No reasoning limit                                    | Reserved for runtimes/models that expose a separate reasoning phase.      |
| `debug`              | Model instance | Enabled                                               | Logs prepared prompts, outputs, and failures when true.                   |

The numeric limits can be passed to `Thistle.init()` as defaults or overridden in `model.prompt(text, options)`. Falsy limits are normalized to no explicit limit; native model/context capacity remains the hard ceiling.

Prompt-specific data can be injected with the second argument to `prompt()`:

```tsx
const answer = await model.prompt('Summarize the latest result.', {
  data: { result: 'The build passed', timestamp: Date.now() },
  maxOutputTokens: 200,
});
```

Debug logging is enabled by default. Set `debug: false` in the initialization options to silence Thistle's prompt, output, and failure logs.

`Thistle.init()` accepts either a Metro asset returned by `require(...)` or a string path supported by the native runtime:

```tsx
const model = await Thistle.init('model.gguf');
```

Each call creates an independent model instance. Release instances when they are no longer needed:

```tsx
const model = await Thistle.init('model.gguf');

try {
  const answer = await model.prompt('Summarize this text.');
  console.log(answer);
} finally {
  model.unload();
}
```

## Multiple Models

Multiple models can be initialized with separate handles. This is useful for different workloads, but every loaded model consumes memory:

```tsx
import { Thistle } from 'react-native-thistle';

const chatModel = await Thistle.init('chat.gguf');
const smallModel = await Thistle.init('small-model.gguf');

const answer = await chatModel.prompt('Write a short welcome message.');
const quickAnswer = await smallModel.prompt('Reply with one word.');

chatModel.unload();
smallModel.unload();
```

Prefer a smaller quantized model when the device has limited memory. A model can require substantially more memory than the size of its file because of runtime buffers and context state.

## Example Chat App

The repository example app demonstrates the intended application shape in [example/src/App.tsx](example/src/App.tsx). Its model is defined at:

```tsx
const modelAsset = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
```

The example initializes that bundled model on mount, displays model status, accepts text input, invokes `model.prompt(...)`, and renders assistant output with Markdown and native SVG LaTeX. Responses are selectable and can be copied to the clipboard.

Run the example from the repository root with two terminals:

```sh
# Terminal 1
yarn example start

# Terminal 2
yarn example ios
```

For Android project work:

```sh
yarn example android
```

The example uses the Yarn workspace. `npm run example` by itself is incomplete because it forwards to a workspace command. The equivalent npm commands are:

```sh
npm run example -- start
npm run example -- ios
npm run example -- android
```

## Current Implementation Status

The JavaScript API, iOS llama.cpp bridge, Metal backend, bundled shader resources, and chat harness are in place:

```ts
type ThistleModel = {
  prompt(text: string): Promise<string>;
  unload(): void;
};
```

Android inference uses the same llama.cpp runtime through a JNI bridge. The current Android path supports bundled GGUF files and CPU/GPU backend selection through llama.cpp; test on a physical arm64 device for realistic model size and performance.

The intended native architecture is:

```text
React Native JavaScript
				|
				v
Thistle.init() / model.prompt()
				|
				v
Nitro Module
				|
				v
llama.cpp GGUF runtime
				|
				+-- iOS Metal / CPU
				+-- Android llama.cpp backends
```

The example's Android Gradle build copies `example/assets/*.gguf` into the APK assets automatically. For a separate consumer app, add the GGUF to that app's Android assets and use a physical arm64 device when validating `prompt()` with a large model.

## Development Workflow

From the repository root:

```sh
yarn
yarn nitrogen
```

Run Nitrogen whenever `src/Thistle.nitro.ts` changes. Native changes require rebuilding the example app. JavaScript changes are picked up by Metro.

Validate the package with:

```sh
yarn typecheck
yarn test
yarn lint
```

The root lint configuration excludes the vendored llama.cpp sources. Their web UI has a separate Prettier configuration and dependency set, so it is not included in Thistle package linting.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
