import { describe, expect, it, jest } from '@jest/globals';
import type { ThistleModel } from 'react-native-thistle';
import { promptWithHistory } from '../conversation';

class ThistleError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function createModel() {
  return { prompt: jest.fn<ThistleModel['prompt']>() };
}

const contextError = () =>
  new ThistleError('context_length_exceeded', 'The prompt uses 2000 tokens.');

describe('Thistle Lite conversation context', () => {
  it('sends the first question without history', async () => {
    const model = createModel();
    model.prompt.mockResolvedValue('Paris.');

    const result = await promptWithHistory(model, [], 'Capital of France?');

    expect(model.prompt).toHaveBeenCalledWith('Capital of France?', {});
    expect(result).toEqual({
      response: 'Paris.',
      turns: [{ user: 'Capital of France?', assistant: 'Paris.' }],
    });
  });

  it('passes completed turns as real user and assistant messages in order', async () => {
    const model = createModel();
    model.prompt
      .mockResolvedValueOnce('Paris.')
      .mockResolvedValueOnce('About 2 million.')
      .mockResolvedValueOnce('The Eiffel Tower.');

    const first = await promptWithHistory(model, [], 'Capital of France?');
    const second = await promptWithHistory(
      model,
      first.turns,
      'How many people live there?'
    );
    await promptWithHistory(model, second.turns, 'What is a landmark there?');

    expect(model.prompt).toHaveBeenNthCalledWith(
      2,
      'How many people live there?',
      {
        history: [
          { role: 'user', content: 'Capital of France?' },
          { role: 'assistant', content: 'Paris.' },
        ],
      }
    );
    expect(model.prompt).toHaveBeenNthCalledWith(
      3,
      'What is a landmark there?',
      {
        history: [
          { role: 'user', content: 'Capital of France?' },
          { role: 'assistant', content: 'Paris.' },
          { role: 'user', content: 'How many people live there?' },
          { role: 'assistant', content: 'About 2 million.' },
        ],
      }
    );
    expect(second.turns).toHaveLength(2);
  });

  it('removes only the oldest complete exchange when the context is exceeded', async () => {
    const model = createModel();
    const turns = [
      { user: 'Old question', assistant: 'Old answer' },
      { user: 'Recent question', assistant: 'Recent answer' },
    ];
    model.prompt
      .mockRejectedValueOnce(contextError())
      .mockResolvedValueOnce('Follow-up answer');

    const result = await promptWithHistory(model, turns, 'Follow-up');

    expect(model.prompt).toHaveBeenCalledTimes(2);
    expect(model.prompt).toHaveBeenLastCalledWith('Follow-up', {
      history: [
        { role: 'user', content: 'Recent question' },
        { role: 'assistant', content: 'Recent answer' },
      ],
    });
    expect(result.turns).toEqual([
      turns[1],
      { user: 'Follow-up', assistant: 'Follow-up answer' },
    ]);
    expect(turns).toHaveLength(2);
  });

  it('can remove all history without removing or duplicating the current question', async () => {
    const model = createModel();
    model.prompt
      .mockRejectedValueOnce(contextError())
      .mockRejectedValueOnce(contextError())
      .mockResolvedValueOnce('Answer');

    const result = await promptWithHistory(
      model,
      [
        { user: 'First', assistant: 'First answer' },
        { user: 'Second', assistant: 'Second answer' },
      ],
      'Current'
    );

    expect(model.prompt).toHaveBeenLastCalledWith('Current', {});
    expect(result.turns).toEqual([{ user: 'Current', assistant: 'Answer' }]);
  });

  it('surfaces a question that cannot fit even without history', async () => {
    const model = createModel();
    const error = contextError();
    model.prompt.mockRejectedValue(error);

    await expect(promptWithHistory(model, [], 'Too long')).rejects.toBe(error);
    expect(model.prompt).toHaveBeenCalledTimes(1);
  });

  it('does not retry other errors or include failed turns in future context', async () => {
    const model = createModel();
    const turns = [{ user: 'Question', assistant: 'Answer' }];
    const error = new ThistleError('decode_failed', 'llama_decode failed.');
    model.prompt
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('New answer');

    await expect(promptWithHistory(model, turns, 'Failed')).rejects.toBe(error);
    expect(model.prompt).toHaveBeenCalledTimes(1);
    const result = await promptWithHistory(model, turns, 'Retry');

    expect(result.turns).toEqual([
      ...turns,
      { user: 'Retry', assistant: 'New answer' },
    ]);
    expect(model.prompt).toHaveBeenLastCalledWith('Retry', {
      history: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ],
    });
  });
});
