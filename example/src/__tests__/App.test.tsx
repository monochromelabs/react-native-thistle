import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import type { ThistleModel } from 'react-native-thistle';
import App from '../App';
import { createChat, type ChatLibrary } from '../chatStorage';

const mockGetItem = jest.fn<(key: string) => Promise<string | null>>();
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>();
const mockPrompt = jest.fn<ThistleModel['prompt']>();

jest.mock('react-native-encrypted-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));
jest.mock('react-native-thistle', () => ({
  Thistle: {
    init: async () => ({ prompt: mockPrompt, unload: () => {} }),
  },
}));
jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-markdown-display', () => 'Markdown');
jest.mock(
  '@dawsonxiong/react-native-latex-renderer/lib/module/MathView',
  () => ({ MathView: 'MathView' }),
  { virtual: true }
);
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

let renderer: ReactTestRenderer;

function button(label: string): ReactTestInstance {
  const result = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function'
  )[0];
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function changeInput(text: string) {
  const input = renderer.root.findAll(
    (node) => typeof node.props.onChangeText === 'function'
  )[0];
  if (!input) throw new Error('Composer not found');
  input.props.onChangeText(text);
}

async function press(label: string) {
  await act(async () => button(label).props.onPress());
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  mockSetItem.mockResolvedValue();
  mockPrompt.mockResolvedValue('Follow-up answer');
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mountLibrary(library: ChatLibrary) {
  mockGetItem.mockResolvedValue(JSON.stringify(library));
  await act(async () => {
    renderer = create(<App />);
  });
}

function lastSaved(): ChatLibrary {
  const value = mockSetItem.mock.calls.at(-1)?.[1];
  if (!value) throw new Error('Expected saved library');
  return JSON.parse(value);
}

it('switches saved chats and sends only the selected conversation to the model', async () => {
  const first = { ...createChat(), title: 'France' };
  first.turns = [{ user: 'Capital of France?', assistant: 'Paris.' }];
  const second = { ...createChat(), title: 'Japan' };
  second.turns = [{ user: 'Capital of Japan?', assistant: 'Tokyo.' }];
  await mountLibrary({
    version: 1,
    activeChatId: first.id,
    chats: [first, second],
  });
  await press('Open chat menu');
  const chatLink = renderer.root.findAll(
    (node) =>
      node.props.accessibilityState?.selected === false &&
      typeof node.props.onPress === 'function'
  )[0];
  if (!chatLink) throw new Error('Expected unselected chat');
  await act(async () => chatLink.props.onPress());
  expect(lastSaved().activeChatId).toBe(second.id);
  await act(async () => {
    changeInput('Tell me more');
  });
  await press('Send message');
  expect(mockPrompt).toHaveBeenCalledWith('Tell me more', {
    history: [
      { role: 'user', content: 'Capital of Japan?' },
      { role: 'assistant', content: 'Tokyo.' },
    ],
  });
  expect(lastSaved().chats[0]?.turns.at(-1)).toEqual({
    user: 'Tell me more',
    assistant: 'Follow-up answer',
  });
});

it('creates a new empty chat without reusing the previous model context', async () => {
  const old = createChat();
  old.turns = [{ user: 'Old question', assistant: 'Old answer' }];
  await mountLibrary({ version: 1, activeChatId: old.id, chats: [old] });
  await press('Open chat menu');
  await press('New chat');
  expect(lastSaved().chats).toHaveLength(2);
  expect(lastSaved().activeChatId).not.toBe(old.id);
  await act(async () => {
    changeInput('New topic');
  });
  await press('Send message');
  expect(mockPrompt).toHaveBeenCalledWith('New topic', {});
});

it('requires permanent-deletion confirmation and leaves chats untouched on cancel', async () => {
  const chat = { ...createChat(), title: 'Saved chat' };
  const alert = jest.spyOn(Alert, 'alert');
  await mountLibrary({ version: 1, activeChatId: chat.id, chats: [chat] });
  await press('Open chat menu');
  await press('Delete chat: Saved chat');
  expect(mockSetItem).not.toHaveBeenCalled();
  const [title, message, actions] = alert.mock.calls[0] ?? [];
  expect(title).toBe('Delete chat forever?');
  expect(message).toContain('deleted forever');
  expect(actions?.find((action) => action.text === 'Cancel')?.style).toBe(
    'cancel'
  );
  await act(async () => {
    actions?.find((action) => action.text === 'Cancel')?.onPress?.();
  });
  expect(mockSetItem).not.toHaveBeenCalled();
  expect(actions?.find((action) => action.style === 'destructive')?.text).toBe(
    'Delete forever'
  );
  await act(async () => {
    actions?.find((action) => action.style === 'destructive')?.onPress?.();
  });
  expect(lastSaved()).toEqual({
    version: 1,
    activeChatId: null,
    chats: [],
  });
});

it('blocks chat changes during generation so the reply cannot land in another chat', async () => {
  const chat = { ...createChat(), title: 'Current chat' };
  let finish: ((response: string) => void) | undefined;
  mockPrompt.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await mountLibrary({ version: 1, activeChatId: chat.id, chats: [chat] });
  await act(async () => changeInput('Question'));
  let sending: Promise<void> | undefined;
  await act(async () => {
    sending = button('Send message').props.onPress();
  });
  await press('Open chat menu');
  expect(button('New chat').props.disabled).toBe(true);
  expect(button('Delete chat: Current chat').props.disabled).toBe(true);
  await press('New chat');
  expect(mockSetItem).not.toHaveBeenCalled();
  await act(async () => {
    finish?.('Answer');
    await sending;
  });
  expect(lastSaved().activeChatId).toBe(chat.id);
  expect(lastSaved().chats).toHaveLength(1);
  expect(lastSaved().chats[0]?.turns).toEqual([
    { user: 'Question', assistant: 'Answer' },
  ]);
});
