# Running Thistle

Thistle is currently a React Native Nitro Module package with a Community CLI example app. The current native implementation exposes a `multiply` function and displays `Result: 21` in the example app.

The model-loading and NPU-backed inference APIs described in the project direction are not implemented yet. The setup below runs the current native module environment and explains the next inference boundary.

## Requirements

- Node.js `>= 22.11.0`
- Yarn `4.11.0`
- Xcode for iOS development
- CocoaPods for iOS dependencies
- Android Studio, an Android SDK, and an emulator or connected device for Android development

The repository is a Yarn workspace. Use Yarn commands from the repository root rather than npm for development.

## Initial Setup

From the repository root:

```sh
yarn
yarn nitrogen
```

`yarn nitrogen` generates the native Nitro boilerplate from `src/Thistle.nitro.ts`. Run it again whenever a `*.nitro.ts` specification changes. It has already generated the current bindings in `nitrogen/generated`.

### iOS setup

Install the CocoaPods dependencies once, or again after native dependency changes:

```sh
cd example/ios
pod install
cd ../..
```

Open `example/ios/ThistleLite.xcworkspace` in Xcode if you need to inspect or edit the iOS project. Do not open the `.xcodeproj` when using CocoaPods.

### Android setup

Start an Android emulator or connect a device with USB debugging enabled. Android Studio can open the `example/android` directory.

The example is configured with the React Native New Architecture enabled and Hermes enabled.

## Run the Example

Use two terminals from the repository root.

Terminal 1 starts Metro:

```sh
yarn example start
```

Terminal 2 runs the iOS app:

```sh
yarn example ios
```

Or run Android:

```sh
yarn example android
```

To target a particular device, pass React Native CLI arguments after the workspace command, for example:

```sh
yarn example ios --device
```

The equivalent npm forwarding form is:

```sh
npm run example -- start
npm run example -- ios
npm run example -- android
```

Running `npm run example` by itself is incomplete. The root script forwards to `yarn workspace react-native-thistle-example`, which requires a workspace command such as `start`, `ios`, or `android`.

## Development Cycle

### TypeScript or JavaScript changes

Keep Metro running and reload the app. JavaScript changes are picked up without rebuilding the native app.

### Native Swift or Kotlin changes

Rebuild the example app:

```sh
yarn example ios
# or
yarn example android
```

### Nitro specification changes

After changing `src/Thistle.nitro.ts`, regenerate the native bindings and then reinstall or synchronize native dependencies as needed:

```sh
yarn nitrogen
cd example/ios
pod install
cd ../..
yarn example ios
```

For Android, rebuilding the example app synchronizes the generated Gradle sources:

```sh
yarn nitrogen
yarn example android
```

## Validate the Package

Run these commands from the repository root:

```sh
yarn typecheck
yarn test
yarn lint
```

The current Jest suite contains a pending placeholder test, so passing Jest does not yet verify model inference behavior.

## Current Native API

The current specification is equivalent to:

```ts
export interface Thistle extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  multiply(a: number, b: number): number;
}
```

The JavaScript package calls the native Nitro object on iOS and Android. The native implementations currently multiply two numbers; they do not load models or use an NPU.

## Planned Local Inference API

A future API could expose model lifecycle and inference operations through the same Nitro module boundary:

```ts
export interface Thistle extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  loadModel(path: string): Promise<number>;
  run(modelId: number, input: ArrayBuffer): Promise<ArrayBuffer>;
  unloadModel(modelId: number): void;
}
```

The native implementation would keep the expensive work outside JavaScript and return only the inference result.

A practical first milestone is to support one model type and one model format. For a cross-platform starting point, an ONNX model could use:

- iOS: ONNX Runtime with the Core ML execution provider, falling back to CPU.
- Android: ONNX Runtime with the NNAPI execution provider, falling back to CPU.

For Apple-first development, Core ML is the direct route to CPU, GPU, and Neural Engine selection. Android NPU behavior varies by device, chipset, vendor driver, and runtime, so accelerator use must always have a fallback path.

The runtime choice should be made after selecting the workload. LLMs, Whisper, embeddings, object detection, and image generation have different model formats, tensor shapes, memory requirements, and accelerator support.

## Suggested First Inference Milestone

1. Choose one workload, such as image classification or embeddings.
2. Choose one model format, such as ONNX.
3. Implement `loadModel`, `run`, and `unloadModel` in the Nitro specification.
4. Generate bindings with `yarn nitrogen`.
5. Implement the selected runtime separately in Swift/Core ML and Kotlin/Android.
6. Add a CPU fallback and return runtime or accelerator information for diagnostics.
7. Add an example screen and native integration tests for model loading and inference.

Until those steps are implemented, the runnable example verifies Nitro module wiring only; it does not verify local AI inference or NPU utilization.
