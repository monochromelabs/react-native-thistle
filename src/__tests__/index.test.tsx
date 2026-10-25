import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Thistle as ThistleSpec } from '../Thistle.nitro';

const mockNative = {
  loadModel: jest.fn<ThistleSpec['loadModel']>(),
  warmup: jest.fn<ThistleSpec['warmup']>(),
  prompt: jest.fn<ThistleSpec['prompt']>(),
  unloadModel: jest.fn<ThistleSpec['unloadModel']>(),
};

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    // Lazy, because the module creates its hybrid object at import time.
    createHybridObject: () =>
      new Proxy(
        {},
        { get: (_target, key) => mockNative[key as keyof typeof mockNative] }
      ),
  },
}));

import { Thistle, ThistleError } from '../index';

const completion = (text: string, extra: object = {}) =>
  JSON.stringify({
    text,
    reasoning: '',
    finishReason: 'stop',
    promptTokens: 10,
    completionTokens: 2,
    reasoningTokens: 0,
    contextSize: 2048,
    ...extra,
  });

function lastRequest() {
  const call = mockNative.prompt.mock.calls.at(-1);
  return JSON.parse(call![1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.loadModel.mockResolvedValue(7);
  mockNative.warmup.mockResolvedValue();
  mockNative.prompt.mockResolvedValue(completion('Hello.'));
});

describe('Thistle.init', () => {
  it('loads asynchronously, passes the chat template, and warms up', async () => {
    await Thistle.init('/models/a.gguf', {
      chatTemplate: 'chatml',
      maxContextSize: 1024,
    });
    expect(mockNative.loadModel).toHaveBeenCalledWith(
      '/models/a.gguf',
      JSON.stringify({ chatTemplate: 'chatml' })
    );
    expect(mockNative.warmup).toHaveBeenCalledWith(7, 1024);
  });

  it('unloads the model when warmup fails', async () => {
    mockNative.warmup.mockRejectedValue(
      new Error('[thistle:context_creation_failed] Out of memory')
    );
    const failure = Thistle.init('/models/a.gguf');
    await expect(failure).rejects.toMatchObject({
      name: 'ThistleError',
      code: 'context_creation_failed',
      message: 'Out of memory',
    });
    expect(mockNative.unloadModel).toHaveBeenCalledWith(7);
  });

  it('maps native load errors to ThistleError codes', async () => {
    mockNative.loadModel.mockRejectedValue(
      new Error(
        'Thistle.loadModel(...): [thistle:missing_chat_template] No template.'
      )
    );
    await expect(Thistle.init('/models/a.gguf')).rejects.toMatchObject({
      code: 'missing_chat_template',
      message: 'No template.',
    });
  });

  it.each([
    [{ maxContextSize: 8 }],
    [{ maxOutputTokens: -1 }],
    [{ maxContextSize: 1.5 }],
    [{ maxOutputTokens: Number.NaN }],
    [{ maxOutputTokens: 1e12 }],
    [{ maxContextSize: 512, maxOutputTokens: 512 }],
    [{ temperature: -1 }],
    [{ topP: 2 }],
  ])('rejects invalid options %p before loading', async (options) => {
    await expect(Thistle.init('/m.gguf', options)).rejects.toMatchObject({
      code: 'invalid_argument',
    });
    expect(mockNative.loadModel).not.toHaveBeenCalled();
  });
});

describe('legacy falsy limits', () => {
  it('treats 0 and null limits as the native defaults', async () => {
    const model = await Thistle.init('/m.gguf', {
      maxInputTokens: 0,
      maxContextSize: 0,
      maxOutputTokens: null as unknown as number,
      maxReasoningTokens: 0,
    });
    expect(mockNative.warmup).toHaveBeenCalledWith(7, 0);
    await model.prompt('Hi');
    expect(lastRequest()).toEqual({
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });
});

describe('model.prompt', () => {
  it('sends scaffolding as system, history as turns, and data in the user turn', async () => {
    const model = await Thistle.init('/m.gguf', {
      scaffolding: 'Be brief.',
      maxContextSize: 2048,
      maxOutputTokens: 300,
    });
    const text = await model.prompt('And its population?', {
      data: { units: 'metric' },
      history: [
        { role: 'user', content: 'Capital of France?' },
        { role: 'assistant', content: 'Paris.' },
      ],
    });

    expect(text).toBe('Hello.');
    const request = lastRequest();
    expect(request).toEqual({
      maxContextSize: 2048,
      maxOutputTokens: 300,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Capital of France?' },
        { role: 'assistant', content: 'Paris.' },
        {
          role: 'user',
          content:
            'Context data (use this when relevant):\n{\n  "units": "metric"\n}\n\nUser request:\nAnd its population?',
        },
      ],
    });
    expect(request.messages[0].content).not.toContain('units');
  });

  it('expands the xylem scaffolding preset', async () => {
    const model = await Thistle.init('/m.gguf', { scaffolding: 'xylem' });
    await model.prompt('Hi');
    expect(lastRequest().messages[0].content).toMatch(
      /^You are a helpful assistant inside a mobile application/
    );
  });

  it('lets per-prompt options override init defaults', async () => {
    const model = await Thistle.init('/m.gguf', {
      maxOutputTokens: 100,
      temperature: 0.7,
    });
    await model.prompt('Hi', { maxOutputTokens: 50, temperature: 0, seed: 3 });
    expect(lastRequest()).toMatchObject({
      maxOutputTokens: 50,
      temperature: 0,
      seed: 3,
    });
  });

  it('rejects data that cannot be serialized', async () => {
    const model = await Thistle.init('/m.gguf');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(model.prompt('Hi', { data: circular })).rejects.toMatchObject({
      code: 'invalid_argument',
    });
    expect(mockNative.prompt).not.toHaveBeenCalled();
  });

  it('surfaces context errors with a code', async () => {
    mockNative.prompt.mockRejectedValue(
      new Error(
        '[thistle:context_length_exceeded] The prompt uses 3000 tokens.'
      )
    );
    const model = await Thistle.init('/m.gguf');
    const error = await model.prompt('Hi').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThistleError);
    expect(error).toMatchObject({ code: 'context_length_exceeded' });
  });
});

describe('model.chat', () => {
  it('returns completion metadata including reasoning', async () => {
    mockNative.prompt.mockResolvedValue(
      completion('391', {
        reasoning: '17*23',
        reasoningTokens: 4,
        finishReason: 'length',
      })
    );
    const model = await Thistle.init('/m.gguf');
    const result = await model.chat([{ role: 'user', content: '17*23?' }], {
      enableThinking: true,
      maxReasoningTokens: 64,
    });
    expect(result).toEqual({
      text: '391',
      reasoning: '17*23',
      finishReason: 'length',
      promptTokens: 10,
      completionTokens: 2,
      reasoningTokens: 4,
      contextSize: 2048,
    });
    expect(lastRequest()).toMatchObject({
      enableThinking: true,
      maxReasoningTokens: 64,
    });
  });

  it('merges scaffolding into an existing system message', async () => {
    const model = await Thistle.init('/m.gguf', { scaffolding: 'Rules.' });
    await model.chat([
      { role: 'system', content: 'Persona.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(lastRequest().messages).toEqual([
      { role: 'system', content: 'Rules.\n\nPersona.' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it.each([
    [[]],
    [[{ role: 'assistant', content: 'Hi' }]],
    [[{ role: 'tool', content: 'Hi' }]],
    [[{ role: 'user', content: 3 }]],
  ])('rejects invalid conversations %p', async (messages) => {
    const model = await Thistle.init('/m.gguf');
    await expect(model.chat(messages as never)).rejects.toMatchObject({
      code: 'invalid_argument',
    });
  });
});

describe('model.unload', () => {
  it('is idempotent and rejects later prompts without calling native code', async () => {
    const model = await Thistle.init('/m.gguf');
    expect(model.isLoaded).toBe(true);
    model.unload();
    model.unload();
    expect(model.isLoaded).toBe(false);
    expect(mockNative.unloadModel).toHaveBeenCalledTimes(1);
    await expect(model.prompt('Hi')).rejects.toMatchObject({
      code: 'model_unloaded',
    });
    expect(mockNative.prompt).not.toHaveBeenCalled();
  });
});
