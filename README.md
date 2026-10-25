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
- **Works with standard instruct GGUFs** by rendering the model's own chat template (Jinja), with built-in template fallbacks and overrides
- **Real multi-turn chat** with `system`, `user`, and `assistant` messages
- **Typed runtime limits** for input, context, output, and reasoning tokens, with safe mobile defaults
- **Sampling controls** for temperature, top-k, top-p, min-p, repetition penalty, and seed
- **Typed errors** with stable codes such as `context_length_exceeded`
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

When migrating an existing hosted-model integration, map system instructions to `scaffolding` (or a `system` message) and pass earlier turns as `history`, or send the whole conversation with `model.chat(messages)`. Pass structured app context or attachment metadata through the `data` option. Streaming, tool calls, images, and behavior that depends on a particular hosted model require application-level changes.

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
  maxContextSize: 2048,
  maxOutputTokens: 512,
});
const answer = await model.prompt('What is the capital of France?');

console.log(answer);
```

### Follow-up questions

Pass earlier turns, oldest first, as `history`. They are rendered as real `user` and `assistant` messages with the model's chat template, so the model sees a normal conversation:

```tsx
const followUp = await model.prompt('How many people live there?', {
  history: [
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'Paris.' },
  ],
});
```

For full control, use `chat()`. The last message must come from the user. It resolves with the answer and generation metadata:

```tsx
const result = await model.chat([
  { role: 'system', content: 'Answer in one sentence.' },
  { role: 'user', content: 'What is the capital of France?' },
]);

result.text; // answer, without any <think> block
result.reasoning; // reasoning text, when the model produced any
result.finishReason; // 'stop' or 'length'
result.promptTokens; // also completionTokens, reasoningTokens, contextSize
```

`scaffolding` is added as the system message, ahead of any system message you supply. Models whose template has no system role receive it at the start of the first user message.

### Chat templates and model compatibility

Thistle renders prompts with the `tokenizer.chat_template` stored in the GGUF, which is how instruct models from Hugging Face and similar sources describe their own prompt format. If a template cannot be rendered, Thistle falls back to llama.cpp's built-in detection for the common formats. If a GGUF has no template, or you need a different one, pass `chatTemplate`:

```tsx
// A llama.cpp built-in name, such as chatml, llama3, gemma, phi3, mistral-v7
const model = await Thistle.init('model.gguf', { chatTemplate: 'chatml' });

// Or a full Jinja template
const custom = await Thistle.init('model.gguf', {
  chatTemplate: '{% for m in messages %}...{% endfor %}',
});
```

Base (non-instruct) models such as Phi-2 usually ship without a template and are rejected with `missing_chat_template`; encoder-decoder and tokenizer-less models are rejected with `unsupported_model`. You can force a template on a base model with `chatTemplate`, and Thistle will stop at the template's turn markers even when they are plain text for that tokenizer, but base models are not trained to follow chat turns, so expect weak answers. Prefer an instruct or chat build of the model. User text is always tokenized as plain text, so a user cannot inject control tokens such as `<|im_end|>` when the GGUF's Jinja template is used.

### Tested instruct models

The following Q4_K_M GGUFs passed the shared engine's host smoke tests under AddressSanitizer using their embedded chat templates, without a `chatTemplate` override:

| Model                   | GGUF filename                              |
| ----------------------- | ------------------------------------------ |
| Qwen3-VL 2B Instruct    | `Qwen3VL-2B-Instruct-Q4_K_M.gguf`          |
| Llama 3.2 1B Instruct   | `Llama-3.2-1B-Instruct-Q4_K_M.gguf`        |
| Vikhr Gemma 2B Instruct | `Vikhr-Gemma-2B-instruct-Q4_K_M.gguf`      |
| Ministral 3 3B Instruct | `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` |
| Phi-3.5 Mini Instruct   | `Phi-3.5-mini-instruct-Q4_K_M.gguf`        |

Checks cover factual answers, history-dependent follow-ups, earlier-turn recall, UTF-8 input, turn termination without template-marker leakage, control-token text in user input, output limits, warmup, and unload. Qwen also passed the more extensive engine regression suite, including reasoning budgets and unloading during generation. See [native test instructions](cpp/thistle/tests/README.md) to reproduce these checks with your own models.

These are host CPU tests, not a guarantee of answer quality, resistance to prompt injection, or on-device memory/performance. Validate your exact GGUF on target devices. Qwen3-VL was tested with text input only; image input is not supported.

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

Other useful scaffolds might define a concise travel planner, a recipe assistant that respects dietary constraints, a journaling companion with a reflective tone, or an offline developer-help tool that only answers from an embedded API reference. Keep the scaffold focused on behavior and output format; pass changing facts, user data, and documents through `data` or the prompt instead.

### Runtime Options

| Option               | Applied when   | Default                                    | Purpose                                                                                        |
| -------------------- | -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `scaffolding`        | Every prompt   | None                                       | System instructions; use `xylem` for the built-in preset.                                      |
| `chatTemplate`       | Model instance | Template stored in the GGUF                | Jinja template or llama.cpp built-in template name.                                            |
| `maxContextSize`     | Each prompt    | 2048, capped at the model's trained window | Context/KV-cache window. Larger values use substantially more memory.                          |
| `maxOutputTokens`    | Each prompt    | `min(512, maxContextSize / 2)`             | Caps generated tokens, including reasoning. Must be smaller than `maxContextSize`.             |
| `maxInputTokens`     | Each prompt    | `maxContextSize - maxOutputTokens`         | Rejects longer prompts with `context_length_exceeded`. Never exceeds the room left for output. |
| `maxReasoningTokens` | Each prompt    | No separate cap                            | Closes a `<think>` block after this many tokens so the model must answer.                      |
| `enableThinking`     | Each prompt    | `false`                                    | Passed to templates that support `enable_thinking`, such as Qwen3.                             |
| `temperature`        | Each prompt    | `0.7`                                      | `0` selects greedy, deterministic decoding.                                                    |
| `topK` / `topP`      | Each prompt    | `40` / `0.9`                               | Sampling filters. `topK: 0` disables top-k.                                                    |
| `minP`               | Each prompt    | `0.05`                                     | Minimum probability relative to the most likely token.                                         |
| `repeatPenalty`      | Each prompt    | `1.1` over the last 64 tokens              | Discourages loops. `1` disables it; `repeatLastN` changes the window.                          |
| `seed`               | Each prompt    | Random                                     | Fixed seed for reproducible sampling.                                                          |
| `debug`              | Model instance | `false`                                    | Logs prepared requests, outputs, and failures when true.                                       |

Generation options passed to `Thistle.init()` are defaults for that instance; options passed to `prompt()` or `chat()` override them for one call. Invalid values reject with `invalid_argument` before native code runs. For compatibility with earlier releases, `0` or `null` for `maxInputTokens`, `maxContextSize`, or `maxOutputTokens` selects the default.

Prompt-specific data can be injected with the `data` option. It is serialized as JSON and placed in the user message, ahead of the request, so it is treated as content rather than instructions:

```tsx
const answer = await model.prompt('Summarize the latest result.', {
  data: { result: 'The build passed', timestamp: Date.now() },
  maxOutputTokens: 200,
});
```

Debug logging is off by default. Set `debug: true` to log prepared requests, outputs, and failures.

### Errors

Failures reject with a `ThistleError` whose `code` is stable and safe to branch on:

```tsx
import { ThistleError } from 'react-native-thistle';

try {
  await model.prompt(question, { history });
} catch (error) {
  if (
    error instanceof ThistleError &&
    error.code === 'context_length_exceeded'
  ) {
    // Drop the oldest turns from history and try again.
  }
}
```

| Code                                                     | Meaning                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `invalid_argument`                                       | Bad option, message, or non-UTF-8 text.                                       |
| `model_load_failed`                                      | The file is missing, unreadable, or not a GGUF this runtime supports.         |
| `missing_chat_template` / `unsupported_chat_template`    | Pass a `chatTemplate`.                                                        |
| `unsupported_model`                                      | Encoder-decoder or tokenizer-less model.                                      |
| `context_length_exceeded`                                | Prompt and output do not fit in the context; shorten history or raise limits. |
| `context_creation_failed` / `out_of_memory`              | Not enough memory for this context size; lower `maxContextSize`.              |
| `model_unloaded` / `model_not_loaded`                    | The instance was unloaded, including while a prompt was running.              |
| `decode_failed`, `tokenization_failed`, `internal_error` | Native inference failure.                                                     |

`Thistle.init()` accepts either a Metro asset returned by `require(...)` or a string path supported by the native runtime:

```tsx
const model = await Thistle.init('model.gguf');
```

Each call creates an independent model instance. Prompts on one instance run one at a time, and each prompt uses a fresh context, so conversation state lives only in the messages you pass. Release instances when they are no longer needed. `unload()` is idempotent; prompts that are still running reject with `model_unloaded`, and the model memory is freed once they stop:

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

The example currently uses only this Qwen GGUF in `example/assets/`. The other models in the compatibility table were temporary test assets and are not required to build or run the example. After adding or removing model assets, rebuild the native app to update the packaged files; a Metro reload does not update native assets.

The example initializes that bundled model on mount, displays model status, accepts text input, invokes `model.prompt(...)`, and renders assistant output with Markdown and native SVG LaTeX. Responses are selectable and can be copied to the clipboard.

The hamburger menu lets users create, switch between, and permanently delete chats with confirmation. Chat history is stored in encrypted storage, and only the selected chat's history is sent to the model. When a conversation exceeds the context limit, the example drops the oldest complete turns from the active context and retries.

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
  prompt(text: string, options?: ThistlePromptOptions): Promise<string>;
  chat(
    messages: readonly ThistleMessage[],
    options?: ThistleGenerationOptions
  ): Promise<ThistleCompletion>;
  unload(): void;
  readonly isLoaded: boolean;
};
```

iOS and Android share one C++ engine in `cpp/thistle`, which handles chat templates, tokenization, sampling, limits, and model lifetime. The platform bindings only resolve model paths and move JSON across the bridge on background threads. Native engine tests that run a real GGUF are described in [cpp/thistle/tests/README.md](cpp/thistle/tests/README.md). Streaming, tool calls, and image input are not supported yet.

The shared engine wraps the vendored [llama.cpp runtime](cpp/llama.cpp/); it does not replace it. Both [cpp/thistle/](cpp/thistle/) and [cpp/llama.cpp/](cpp/llama.cpp/) are required for native builds.

Android inference uses the same engine through a JNI bridge that passes UTF-8 bytes, so emoji and other non-BMP text round-trip correctly. Bundled models are copied once per app version into a private cache, atomically, so an interrupted copy is never loaded; test on a physical arm64 device for realistic model size and performance.

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
