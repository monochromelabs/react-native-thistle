import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Low-level native bridge. Structured data crosses the bridge as JSON so both
 * platforms share one request/response contract with the C++ engine
 * (see cpp/thistle/ThistleEngine.h). Use the typed API in `index.tsx`.
 */
export interface Thistle extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /** optionsJson: `{"chatTemplate"?: string}`. Returns a model id. */
  loadModel(path: string, optionsJson: string): Promise<number>;
  warmup(modelId: number, maxContextSize: number): Promise<void>;
  /** Resolves with a JSON-encoded completion. */
  prompt(modelId: number, requestJson: string): Promise<string>;
  /** Emits answer text deltas, then resolves with a JSON-encoded completion. */
  stream(
    modelId: number,
    requestJson: string,
    onChunk: (text: string) => void
  ): Promise<string>;
  /** Idempotent; cancels in-flight prompts for the model. */
  unloadModel(modelId: number): void;
}
