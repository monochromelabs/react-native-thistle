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

**Private by default. Available to more people.**

Thistle is a React Native Nitro Module for operationalizing local AI in native mobile experiences. It runs compatible GGUF language models on the hardware already in the user's device, helping apps keep sensitive work local, reduce reliance on remote inference services, and make capable AI more accessible where network access or hosted API costs are limiting.

The JavaScript API stays small while the native runtime handles tokenization, llama.cpp inference, CPU execution, and iOS Metal acceleration. Thistle gives application developers more control over where inference happens, which model is used, and how local AI fits into the product.

## Features

- **Local GGUF inference** from a model bundled into the native iOS app
- **iOS Metal acceleration** with CPU fallback through llama.cpp
- **Private-by-default execution** without sending model prompts to a remote service
- **More control over cost, connectivity, and deployment** by running on-device
- **Less dependence on remote data centers** for everyday inference workloads
- **Instruction scaffolding** with the built-in `xylem` preset or custom guidance
- **Structured context injection** for app data, attachments, and retrieved content
- **Independent model instances** so apps can manage multiple local models
- **Typed runtime limits** for input, context, output, and reasoning tokens
- **Debug logging controls** for prompt/output diagnostics during development

## Requirements

- React Native with Nitro Modules
- iOS 15.1 or newer for the current iOS implementation
- A GGUF model compatible with the bundled llama.cpp runtime
- Enough device memory for the model, context state, and Metal buffers

Local inference does require a compatible model and sufficient device resources. In return, prompts and responses can stay on the device, apps can continue working without a model API connection, and teams can choose a model and deployment experience that fits their users.

Thistle is a React Native package for putting local inference into real mobile workflows without asking each app to build its own native model pipeline. The intended developer experience is:

1. Install the package.
2. Drop a supported model into `assets/`.
3. Initialize one or more model instances.
4. Use those instances anywhere in your JavaScript or TypeScript code.

The public API is designed to hide Nitro Modules, native ML runtimes, tokenizers, delegates, and hardware selection from the application developer while preserving control over the local model and the app's AI behavior.

## Installation

```sh
npm install react-native-thistle
npx react-native-thistle setup
```

Thistle uses [Nitro Modules](https://nitro.margelo.com/) for its native bridge and declares `react-native-nitro-modules` as a peer dependency. The package is intended to make local inference practical to adopt: install it, connect the model assets you want, and let the native build package them for the app. Modern npm versions automatically install a compatible peer dependency when possible, so installing `react-native-thistle` is usually sufficient. To declare Nitro explicitly in the app, or when using a package manager that does not automatically install peers, run:

```sh
npm install react-native-thistle react-native-nitro-modules
```

The setup command creates the app-level `assets/` directory, lists the `.gguf` files currently in it, and lets you select one or more models to connect to the native app. The selection is saved in `.thistle/models.json`, so selected models are already checked the next time setup runs. Android and iOS are both configured from that same selection. It is safe to run again after native project changes.

The final `None` option disconnects every model. Choosing it and pressing Enter asks for confirmation before native wiring is cleared. Adding a new `.gguf` file to `assets/` makes it available the next time setup runs; removing a file removes it from the available selection and native configuration.

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

## Implementing Local AI Requests

If your app currently sends prompts to a hosted model provider, Thistle lets you build that experience around local inference instead. This applies to integrations with any hosted AI service or provider SDK, not a specific provider. Keeping the request on the device can improve privacy, reduce dependence on network availability and hosted API pricing, and give the app more control over the model it ships. Local inference does not require Axios or another HTTP client for the model request. Replace the network-backed model call with a Thistle model instance and a local prompt:

```tsx
import { Thistle } from 'react-native-thistle';

const model = await Thistle.init('model.gguf', {
  scaffolding: 'xylem',
});

const answer = await model.prompt(userMessage);
```

> [!NOTE]
> **What is `xylem`?** `xylem` is Thistle's built-in instruction scaffold: persistent guidance that is added to each prompt to encourage concise answers, careful use of supplied context, checked arithmetic, and clear uncertainty. It is not a model, an AI provider, or a network service. Replace it with your own scaffolding when your app needs a different role or output format.

When migrating an existing hosted-model integration, convert message history and system instructions into the prompt text and `scaffolding` option. Pass structured app context or attachment metadata through the `data` option. Streaming, tool calls, provider-specific message formats, and behavior that depends on a particular hosted model require application-level changes.

## Add A Model

Put a GGUF model in the application-level `assets/` directory:

```text
my-app/
	assets/
		model.gguf
	src/
		chat.ts
```

For iOS, CocoaPods copies the selected `.gguf` files from the application-level `assets/` directory into the app bundle during the build. For Android, the setup command copies the same selected files into a generated Android assets directory during the build. You do not need to copy models into `android/app/src/main/assets/` separately. This keeps model selection in the app project, where the team can make an explicit choice about model size, capabilities, and the device experience. Both platforms can initialize any connected model by filename:

```tsx
const model = await Thistle.init('model.gguf');
```

The example Metro configuration blocks `.gguf` files from the JavaScript bundle, which avoids Metro's asset-size limits for large models. If your app has its own Metro setup and uses a small static asset with `require('./assets/model.gguf')`, Thistle also accepts the resulting React Native asset reference. Dynamic paths such as `require(pathFromUserInput)` cannot be resolved by Metro. Set `THISTLE_MODEL_DIR` during the iOS build if your models live in a different directory.

## Initialize And Prompt

```tsx
import { Thistle } from 'react-native-thistle';

const model = await Thistle.init('model.gguf', {
  scaffolding: 'xylem',
  maxInputTokens: 0,
  maxContextSize: 0,
  maxOutputTokens: 0,
  maxReasoningTokens: 0,
  debug: false,
});
const answer = await model.prompt('What is the capital of France?');

console.log(answer);
```

`scaffolding` is optional persistent guidance applied to every prompt. The built-in `xylem` preset is a general-purpose starting point for an assistant embedded in a mobile app: it encourages concise answers, careful use of supplied context, explicit uncertainty, checked arithmetic, and faithful handling of attachments. The name reflects its role as a transport layer for useful context and instructions between the app and the model. It is guidance, not a new model or a security boundary, so validate sensitive or high-impact output in your application.

You can also pass your own scaffolding string when the app has a more specific job. For example:

```tsx
const supportModel = await Thistle.init('support.gguf', {
  scaffolding:
    'You are a support assistant. Use the supplied product notes, ask for missing account details, and never invent policy or refund information.',
});

const tutorModel = await Thistle.init('tutor.gguf', {
  scaffolding:
    'You are a patient science tutor. Give one step at a time, ask a short checking question, and adapt explanations to the learner level in the supplied context.',
});

const fieldModel = await Thistle.init('field.gguf', {
  scaffolding:
    'You help summarize field observations. Separate observations from interpretation, preserve measurements and units, and mark missing data clearly.',
});

const extractionModel = await Thistle.init('forms.gguf', {
  scaffolding:
    'Extract only the requested fields from the supplied document. Return valid JSON with the requested keys and use null when a value is absent.',
});
```

Other useful scaffolds might define a concise travel planner, a recipe assistant that respects dietary constraints, a journaling companion with a reflective tone, or an offline developer-help tool that only answers from an embedded API reference. Keep the scaffold focused on behavior and output format; pass changing facts, user data, and documents through `data` or the prompt instead. `maxInputTokens`, `maxContextSize`, `maxOutputTokens`, and `maxReasoningTokens` are numeric runtime limits. Falsy values such as `0`, `undefined`, and `null` mean no explicit limit; the model's own context capacity remains the hard upper bound. Each setting can be overridden for an individual prompt.

### Runtime Options

| Option               | Applied when   | Falsy value                                           | Purpose                                                               |
| -------------------- | -------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `scaffolding`        | Every prompt   | No scaffolding                                        | Persistent system-style guidance; use`xylem` for the built-in preset. |
| `maxInputTokens`     | Each prompt    | No input limit                                        | Rejects prompts whose tokenized input exceeds this value.             |
| `maxContextSize`     | Each prompt    | Model context size                                    | Caps the context/KV-cache window used by native inference.            |
| `maxOutputTokens`    | Each prompt    | Generate until the context is full or the model stops | Caps newly generated tokens.                                          |
| `maxReasoningTokens` | Each prompt    | No reasoning limit                                    | Reserved for runtimes/models that expose a separate reasoning phase.  |
| `debug`              | Model instance | Enabled                                               | Logs prepared prompts, outputs, and failures when true.               |

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

Prefer a smaller quantized model when the device has limited memory. A model can require substantially more memory than the size of its file because of runtime buffers and context state. Choosing a model that fits the target hardware is part of making local AI useful and available to more people.

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

The JavaScript API, iOS llama.cpp bridge, Metal backend, bundled shader resources, and chat harness are in place. Together they provide a foundation for building native experiences around local AI while keeping model execution close to the user and under the application's control:

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
