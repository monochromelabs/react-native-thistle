import type { HybridObject } from 'react-native-nitro-modules';

export interface Thistle extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  loadModel(path: string): number;
  warmup(modelId: number, maxContextSize: number): void;
  prompt(
    modelId: number,
    text: string,
    maxInputTokens: number,
    maxContextSize: number,
    maxOutputTokens: number,
    maxReasoningTokens: number
  ): Promise<string>;
  unloadModel(modelId: number): void;
}
