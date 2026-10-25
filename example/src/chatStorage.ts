import EncryptedStorage from 'react-native-encrypted-storage';
import type { ConversationTurn } from './conversation';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};
export type Chat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  turns: ConversationTurn[];
};
export type ChatLibrary = {
  version: 1;
  activeChatId: string | null;
  chats: Chat[];
};

const storageKey = 'thistle-lite.chats.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string'
  );
}

function isTurn(value: unknown): value is ConversationTurn {
  return (
    isRecord(value) &&
    typeof value.user === 'string' &&
    typeof value.assistant === 'string'
  );
}

function isChat(value: unknown): value is Chat {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    Array.isArray(value.turns) &&
    value.turns.every(isTurn)
  );
}

export async function loadChats(): Promise<ChatLibrary> {
  const stored = await EncryptedStorage.getItem(storageKey);
  if (stored === null || stored === undefined) {
    return { version: 1, activeChatId: null, chats: [] };
  }
  const value: unknown = JSON.parse(stored);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.chats) ||
    !value.chats.every(isChat) ||
    new Set(value.chats.map((chat) => chat.id)).size !== value.chats.length ||
    !(
      value.activeChatId === null ||
      (typeof value.activeChatId === 'string' &&
        value.chats.some((chat) => chat.id === value.activeChatId))
    )
  ) {
    throw new Error(
      'Saved chats are invalid. Existing data has not been replaced.'
    );
  }
  return {
    version: 1,
    activeChatId: value.activeChatId,
    chats: value.chats,
  };
}

export async function saveChats(library: ChatLibrary): Promise<void> {
  await EncryptedStorage.setItem(storageKey, JSON.stringify(library));
}

let nextId = 0;
export function createChat(): Chat {
  const now = Date.now();
  return {
    id: `${now}-${nextId++}`,
    title: 'New chat',
    updatedAt: now,
    messages: [],
    turns: [],
  };
}

export function deleteChat(library: ChatLibrary, id: string): ChatLibrary {
  const chats = library.chats.filter((chat) => chat.id !== id);
  return {
    ...library,
    chats,
    activeChatId:
      library.activeChatId === id
        ? (chats[0]?.id ?? null)
        : library.activeChatId,
  };
}
