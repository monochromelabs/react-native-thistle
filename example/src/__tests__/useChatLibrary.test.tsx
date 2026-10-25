import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createChat } from '../chatStorage';
import { useChatLibrary } from '../useChatLibrary';

jest.mock('react-native-encrypted-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

const mockGetItem = jest.fn<(key: string) => Promise<string | null>>();
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>();
let current: ReturnType<typeof useChatLibrary>;
let renderer: ReactTestRenderer;

function Harness() {
  current = useChatLibrary();
  return null;
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});

it('keeps unsaved changes available and retries the same encrypted snapshot', async () => {
  mockGetItem.mockResolvedValue(null);
  mockSetItem
    .mockRejectedValueOnce(new Error('Keychain locked'))
    .mockResolvedValueOnce();
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(current.status).toBe('ready');
  const chat = createChat();
  const next = {
    ...current.library,
    activeChatId: chat.id,
    chats: [chat],
  };
  await act(async () => current.commit(next));
  expect(current.library).toEqual(next);
  expect(current.status).toBe('error');
  expect(current.error).toContain('Changes are not saved');
  await act(async () => current.retry());
  expect(current.status).toBe('ready');
  expect(current.error).toBeNull();
  expect(mockSetItem).toHaveBeenNthCalledWith(
    2,
    'thistle-lite.chats.v1',
    JSON.stringify(next)
  );
});

it('never saves an empty replacement on a read error and retries loading', async () => {
  mockGetItem
    .mockRejectedValueOnce(new Error('Keychain locked'))
    .mockResolvedValueOnce(null);
  await act(async () => {
    renderer = create(<Harness />);
  });
  expect(current.status).toBe('error');
  expect(current.error).toContain('Could not open encrypted chats');
  expect(mockSetItem).not.toHaveBeenCalled();
  await act(async () => current.retry());
  expect(current.status).toBe('ready');
  expect(mockGetItem).toHaveBeenCalledTimes(2);
});
