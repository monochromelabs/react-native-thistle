export type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type Session = {
  complete(
    messages: Message[],
    onDelta?: (text: string) => void
  ): Promise<{ text: string; tokens: number }>;
  release(): Promise<void>;
};

export const contextSize = 2048;
export const outputTokens = 64;

type Completion = { text: string; tokens: number };
type Observations = {
  messages: Message[];
  chunks: string[];
  first?: Completion;
  second?: Completion;
};

export class ProtocolFailure extends Error {
  constructor(
    message: string,
    readonly observations: Observations,
    cause: unknown
  ) {
    super(message, { cause });
  }
}

export async function exercise(
  createSession: (path: string) => Promise<Session>,
  path: string
) {
  const session = await createSession(path);
  const observations: Observations = { messages: [], chunks: [] };
  try {
    const messages: Message[] = [
      { role: 'system', content: 'Answer directly and concisely.' },
      {
        role: 'user',
        content: 'Name a river that flows through Paris.',
      },
    ];
    observations.messages = messages;
    const first = await session.complete(messages);
    observations.first = first;
    if (!first.text.trim()) throw new Error('Empty non-streaming completion');
    messages.push(
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content:
          'Describe a forest beside that river in at least one hundred words.',
      }
    );
    const chunks: string[] = [];
    observations.chunks = chunks;
    const second = await session.complete(messages, (text) =>
      chunks.push(text)
    );
    observations.second = second;
    if (!second.text.trim()) throw new Error('Empty streaming completion');
    if (chunks.length === 0) throw new Error('No streaming callbacks');
    if (chunks.join('') !== second.text) {
      throw new Error('Stream does not reconstruct final completion');
    }
    if (first.tokens > outputTokens || second.tokens > outputTokens) {
      throw new Error('Output budget exceeded');
    }
    return {
      first,
      second,
      chunks,
      checks: {
        nonemptyChat: true,
        nonemptyStream: true,
        exactReconstruction: true,
        outputBudget: true,
      },
    };
  } catch (error) {
    throw new ProtocolFailure(
      error instanceof Error ? error.message : String(error),
      observations,
      error
    );
  } finally {
    await session.release();
  }
}
