import { expect, it, jest } from '@jest/globals';
import { Thistle } from '../index';
import type { Thistle as ThistleSpec } from '../Thistle.nitro';
import {
  conversationLimits,
  promptWithHistory,
} from '../../example/src/conversation';

const mockNativePrompt = jest.fn<ThistleSpec['prompt']>();

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => ({
      loadModel: async () => 1,
      warmup: async () => {},
      prompt: (...args: Parameters<ThistleSpec['prompt']>) =>
        mockNativePrompt(...args),
      unloadModel: () => {},
    }),
  },
}));

const reply = (text: string) =>
  Promise.resolve(JSON.stringify({ text, finishReason: 'stop' }));

it('delivers the example app conversation to native inference as structured chat messages', async () => {
  mockNativePrompt
    .mockImplementationOnce(() => reply('Paris.'))
    .mockImplementationOnce(() => reply('About 2 million.'));
  const model = await Thistle.init('test.gguf', {
    scaffolding: 'xylem',
    ...conversationLimits,
  });

  const first = await promptWithHistory(model, [], 'Capital of France?');
  const second = await promptWithHistory(
    model,
    first.turns,
    'How many people live there?'
  );

  expect(second.response).toBe('About 2 million.');
  const [modelId, requestJson] = mockNativePrompt.mock.calls[1]!;
  expect(modelId).toBe(1);
  const request = JSON.parse(requestJson);
  expect(request).toMatchObject({ maxContextSize: 2048, maxOutputTokens: 300 });
  expect(request.messages.map((m: { role: string }) => m.role)).toEqual([
    'system',
    'user',
    'assistant',
    'user',
  ]);
  expect(request.messages.slice(1)).toEqual([
    { role: 'user', content: 'Capital of France?' },
    { role: 'assistant', content: 'Paris.' },
    { role: 'user', content: 'How many people live there?' },
  ]);
});
