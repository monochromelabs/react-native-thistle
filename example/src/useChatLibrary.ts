import { useEffect, useRef, useState } from 'react';
import { loadChats, saveChats, type ChatLibrary } from './chatStorage';

type StorageStatus = 'loading' | 'ready' | 'saving' | 'error';

export function useChatLibrary() {
  const [library, setLibrary] = useState<ChatLibrary>({
    version: 1,
    activeChatId: null,
    chats: [],
  });
  const [status, setStatus] = useState<StorageStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ChatLibrary | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  function reportError(action: string, caught: unknown) {
    if (!mounted.current) return;
    setError(
      `${action}: ${caught instanceof Error ? caught.message : String(caught)}`
    );
    setStatus('error');
  }

  async function restore() {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading');
    setError(null);
    try {
      const saved = await loadChats();
      if (mounted.current) {
        setLibrary(saved);
        setStatus('ready');
      }
    } catch (caught: unknown) {
      reportError('Could not open encrypted chats', caught);
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    restore();
    return () => {
      mounted.current = false;
    };
    // Load once; later retries are explicit so unread data is never overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit(next: ChatLibrary) {
    if (busy.current) {
      throw new Error('Encrypted chat storage is busy.');
    }
    busy.current = true;
    pending.current = next;
    setLibrary(next);
    setStatus('saving');
    setError(null);
    try {
      await saveChats(next);
      pending.current = null;
      if (mounted.current) setStatus('ready');
    } catch (caught: unknown) {
      reportError(
        'Changes are not saved. Retry before leaving the app',
        caught
      );
    } finally {
      busy.current = false;
    }
  }

  async function retry() {
    if (busy.current) return;
    if (pending.current) {
      await commit(pending.current);
    } else {
      await restore();
    }
  }

  return {
    library,
    status,
    error,
    commit,
    retry,
    isBusy: () => busy.current,
  };
}
