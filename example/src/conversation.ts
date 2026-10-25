import type {
  ThistleError,
  ThistleMessage,
  ThistleModel,
} from 'react-native-thistle';

export type ConversationTurn = { user: string; assistant: string };

/** Passed to Thistle.init; the engine reserves maxOutputTokens for the reply. */
export const conversationLimits = {
  maxContextSize: 2048,
  maxOutputTokens: 300,
};

function toMessages(turns: readonly ConversationTurn[]): ThistleMessage[] {
  return turns.flatMap((turn) => [
    { role: 'user' as const, content: turn.user },
    { role: 'assistant' as const, content: turn.assistant },
  ]);
}

export async function promptWithHistory(
  model: Pick<ThistleModel, 'prompt'>,
  turns: readonly ConversationTurn[],
  text: string
): Promise<{ response: string; turns: ConversationTurn[] }> {
  let history = [...turns];

  while (true) {
    try {
      const response = await model.prompt(
        text,
        history.length > 0 ? { history: toMessages(history) } : {}
      );
      return {
        response,
        turns: [...history, { user: text, assistant: response }],
      };
    } catch (error: unknown) {
      const exceedsContext =
        (error as Partial<ThistleError> | null)?.code ===
        'context_length_exceeded';
      if (!exceedsContext || history.length === 0) {
        throw error;
      }
      // Drop complete oldest exchanges, never the current question or half a turn.
      history = history.slice(1);
    }
  }
}
