import { Thistle } from 'react-native-thistle';
import { contextSize, outputTokens, type Session } from './protocol';

export const provider = 'thistle';

export async function createSession(path: string): Promise<Session> {
  const model = await Thistle.init(path, {
    maxContextSize: contextSize,
    maxOutputTokens: outputTokens,
    temperature: 0,
    seed: 42,
    enableThinking: false,
  });
  return {
    async complete(messages, onDelta) {
      const result = onDelta
        ? await model.stream(messages, onDelta)
        : await model.chat(messages);
      return { text: result.text, tokens: result.completionTokens };
    },
    async release() {
      model.unload();
    },
  };
}
