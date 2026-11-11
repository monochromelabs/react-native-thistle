import { initLlama } from 'llama.rn';
import { contextSize, outputTokens, type Session } from './protocol';

export const provider = 'llama';

export async function createSession(path: string): Promise<Session> {
  const context = await initLlama({
    model: path,
    n_ctx: contextSize,
    n_parallel: 1,
    n_gpu_layers: 0,
  });
  return {
    async complete(messages, onDelta) {
      const result = await context.completion(
        {
          messages,
          n_predict: outputTokens,
          temperature: 0,
          seed: 42,
          enable_thinking: false,
          reasoning_format: 'none',
        },
        onDelta ? ({ token }) => onDelta(token) : undefined
      );
      return { text: result.text, tokens: result.tokens_predicted };
    },
    async release() {
      await context.release();
    },
  };
}
