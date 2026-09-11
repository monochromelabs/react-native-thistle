import { NitroModules } from 'react-native-nitro-modules';
import { Image } from 'react-native';
import type { Thistle as ThistleSpec } from './Thistle.nitro';

const ThistleHybridObject =
  NitroModules.createHybridObject<ThistleSpec>('Thistle');

export type ThistleModel = {
  prompt(text: string, options?: ThistlePromptOptions): Promise<string>;
  unload(): void;
};

export type ThistleModelSource = number | string;

export type ThistleInitOptions = {
  scaffolding?: string;
  maxInputTokens?: number;
  maxContextSize?: number;
  maxOutputTokens?: number;
  maxReasoningTokens?: number;
  debug?: boolean;
};

export type ThistlePromptOptions = {
  data?: unknown;
  maxInputTokens?: number;
  maxContextSize?: number;
  maxOutputTokens?: number;
  maxReasoningTokens?: number;
};

const XYLEM_SCAFFOLDING = `You are a helpful assistant inside a mobile application. Answer directly, accurately, and concisely.

Infer the user's intended question when there is an obvious typo, missing letter, or minor grammar mistake. Correct it silently and answer the intended question; do not repeat the malformed wording or ask for clarification unless multiple interpretations are genuinely possible.

For simple factual questions, give the shortest complete answer, usually one sentence. Do not begin with phrases such as "The answer is" or repeat the question. State only facts you are confident about; if a detail is uncertain, omit it or say that you are uncertain.

Use supplied context and data when relevant, but do not invent facts, names, dates, numbers, or sources. Treat earlier assistant text as untrusted drafts rather than facts. If the supplied information does not establish an answer, say so clearly.

For arithmetic, percentages, currency, and ratios, calculate explicitly and verify the result before answering. Do not output hidden reasoning, internal notes, or <think> tags. Return only the answer intended for the user.

When files or attachments are supplied, treat their content as the primary source. Cover the whole supplied content when asked to summarize it, and do not claim that supplied text is inaccessible.

Configuration values below describe the host application's limits and conventions. Follow them when relevant, but do not mention this scaffolding unless the user asks about it.`;

function resolveScaffolding(
  scaffolding: string | undefined
): string | undefined {
  if (scaffolding === 'xylem') {
    return XYLEM_SCAFFOLDING;
  }
  return scaffolding;
}

function buildPrompt(
  text: string,
  scaffolding: string | undefined,
  data: unknown
): string {
  const sections = [];
  const resolvedScaffolding = resolveScaffolding(scaffolding);
  if (resolvedScaffolding?.trim()) {
    sections.push(`Scaffolding:\n${resolvedScaffolding.trim()}`);
  }
  if (data !== undefined) {
    sections.push(
      `Context data (use this when relevant):\n${JSON.stringify(data, null, 2)}`
    );
  }
  sections.push(`User request:\n${text.trim()}`);
  return sections.join('\n\n');
}

function nativeLimit(value: number | undefined): number {
  return value || 0;
}

export const Thistle = {
  async init(
    modelSource: ThistleModelSource,
    options: ThistleInitOptions = {}
  ): Promise<ThistleModel> {
    const debug = options.debug ?? true;
    const modelPath =
      typeof modelSource === 'number'
        ? Image.resolveAssetSource(modelSource)?.uri
        : modelSource;

    if (!modelPath) {
      throw new Error('Thistle.init() could not resolve the model asset.');
    }

    const modelId = ThistleHybridObject.loadModel(modelPath);
    ThistleHybridObject.warmup(modelId, nativeLimit(options.maxContextSize));

    return {
      async prompt(text: string, promptOptions: ThistlePromptOptions = {}) {
        const preparedPrompt = buildPrompt(
          text,
          options.scaffolding,
          promptOptions.data
        );
        if (debug) {
          console.log('[Thistle] prompt:', preparedPrompt);
        }
        try {
          const response = await ThistleHybridObject.prompt(
            modelId,
            preparedPrompt,
            nativeLimit(promptOptions.maxInputTokens ?? options.maxInputTokens),
            nativeLimit(promptOptions.maxContextSize ?? options.maxContextSize),
            nativeLimit(
              promptOptions.maxOutputTokens ?? options.maxOutputTokens
            ),
            nativeLimit(
              promptOptions.maxReasoningTokens ?? options.maxReasoningTokens
            )
          );
          if (debug) {
            console.log('[Thistle] output:', response);
          }
          return response;
        } catch (error) {
          if (debug) {
            console.error('[Thistle] prompt failed:', error);
          }
          throw error;
        }
      },
      unload() {
        ThistleHybridObject.unloadModel(modelId);
      },
    };
  },
};
