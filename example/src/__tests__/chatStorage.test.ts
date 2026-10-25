import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createChat,
  deleteChat,
  loadChats,
  saveChats,
  type ChatLibrary,
} from '../chatStorage';
import { promptWithHistory } from '../conversation';
import type { ThistleModel } from 'react-native-thistle';

jest.mock('react-native-encrypted-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

const mockGetItem =
  jest.fn<(key: string) => Promise<string | null | undefined>>();
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>();

beforeEach(() => {
  jest.resetAllMocks();
});

describe('encrypted chat library', () => {
  it.each([null, undefined])(
    'starts empty when storage returns %s for a missing library',
    async (missing) => {
      mockGetItem.mockResolvedValue(missing);
      await expect(loadChats()).resolves.toEqual({
        version: 1,
        activeChatId: null,
        chats: [],
      });
      expect(mockSetItem).not.toHaveBeenCalled();
    }
  );

  it('round-trips chats, selection, transcript and model context across restarts', async () => {
    const chat = createChat();
    chat.title = 'France';
    chat.messages = [
      { id: 'user', role: 'user', text: 'Capital of France?' },
      { id: 'assistant', role: 'assistant', text: 'Paris.' },
    ];
    chat.turns = [{ user: 'Capital of France?', assistant: 'Paris.' }];
    const library: ChatLibrary = {
      version: 1,
      activeChatId: chat.id,
      chats: [chat, createChat()],
    };
    mockSetItem.mockImplementation(async (_key, value) => {
      mockGetItem.mockResolvedValue(value);
    });

    await saveChats(library);
    expect(mockSetItem).toHaveBeenCalledWith(
      'thistle-lite.chats.v1',
      JSON.stringify(library)
    );
    await expect(loadChats()).resolves.toEqual(library);
  });

  it.each([
    'not json',
    'undefined',
    '',
    '{}',
    '{"version":2,"activeChatId":null,"chats":[]}',
    '{"version":1,"activeChatId":"missing","chats":[]}',
    '{"version":1,"activeChatId":null,"chats":[{"id":"bad"}]}',
  ])('surfaces corrupt saved data without overwriting it: %s', async (data) => {
    mockGetItem.mockResolvedValue(data);
    await expect(loadChats()).rejects.toThrow();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('surfaces read and write errors instead of pretending changes are saved', async () => {
    mockGetItem.mockRejectedValue(new Error('Keychain locked'));
    await expect(loadChats()).rejects.toThrow('Keychain locked');
    mockSetItem.mockRejectedValue(new Error('Storage full'));
    await expect(
      saveChats({ version: 1, activeChatId: null, chats: [] })
    ).rejects.toThrow('Storage full');
  });

  it('creates distinct empty chats even within the same millisecond', () => {
    const first = createChat();
    const second = createChat();
    expect(first.id).not.toBe(second.id);
    expect(first.messages).toEqual([]);
    expect(first.turns).toEqual([]);
  });

  it('deletes only the selected chat, chooses a remaining chat, and persists removal', async () => {
    const first = createChat();
    const second = createChat();
    const library: ChatLibrary = {
      version: 1,
      activeChatId: first.id,
      chats: [first, second],
    };
    const after = deleteChat(library, first.id);
    expect(after.chats).toEqual([second]);
    expect(after.activeChatId).toBe(second.id);
    expect(library.chats).toHaveLength(2);
    await saveChats(after);
    expect(mockSetItem).toHaveBeenCalledWith(
      'thistle-lite.chats.v1',
      JSON.stringify(after)
    );
    expect(deleteChat(after, second.id)).toEqual({
      version: 1,
      activeChatId: null,
      chats: [],
    });
    expect(
      deleteChat({ ...library, activeChatId: second.id }, first.id).activeChatId
    ).toBe(second.id);
  });

  it('uses only the selected restored chat as model context', async () => {
    const france = createChat();
    france.turns = [{ user: 'Capital of France?', assistant: 'Paris.' }];
    const japan = createChat();
    japan.turns = [{ user: 'Capital of Japan?', assistant: 'Tokyo.' }];
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        version: 1,
        activeChatId: japan.id,
        chats: [france, japan],
      })
    );
    const restored = await loadChats();
    const selected = restored.chats.find(
      (chat) => chat.id === restored.activeChatId
    );
    if (!selected) throw new Error('Expected selected chat');
    const model = {
      prompt: jest
        .fn<ThistleModel['prompt']>()
        .mockResolvedValue('A large city.'),
      unload: jest.fn<ThistleModel['unload']>(),
    };
    await promptWithHistory(model, selected.turns, 'Tell me about it');
    expect(model.prompt).toHaveBeenCalledWith('Tell me about it', {
      history: [
        { role: 'user', content: 'Capital of Japan?' },
        { role: 'assistant', content: 'Tokyo.' },
      ],
    });
  });
});
