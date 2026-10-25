import { NitroModules } from 'react-native-nitro-modules';
import { Image } from 'react-native';
import type { Thistle as ThistleSpec } from './Thistle.nitro';

const ThistleHybridObject =
  NitroModules.createHybridObject<ThistleSpec>('Thistle');

export type ThistleRole = 'system' | 'user' | 'assistant';

export type ThistleMessage = {
  role: ThistleRole;
  content: string;
};

export type ThistleFinishReason = 'stop' | 'length';

export type ThistleCompletion = {
  /** The answer, with any `<think>` reasoning removed. */
  text: string;
  /** Reasoning emitted inside `<think>…</think>`, if the model produced any. */
  reasoning: string;
  /** `stop` when the model ended its turn, `length` when it hit maxOutputTokens. */
  finishReason: ThistleFinishReason;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  contextSize: number;
};

export type ThistleLimits = {
  /** Upper bound for prompt tokens. Always capped at maxContextSize - maxOutputTokens. 0 means the default. */
  maxInputTokens?: number;
  /** Context window allocated per prompt. Defaults to 2048 (capped at the model's training context). 0 means the default. */
  maxContextSize?: number;
  /** Generated tokens, including reasoning. Defaults to min(512, maxContextSize / 2). 0 means the default. */
  maxOutputTokens?: number;
  /** Closes a `<think>` block after this many tokens. 0 or undefined means no separate cap. */
  maxReasoningTokens?: number;
};

export type ThistleSampling = {
  /** 0 selects greedy decoding. Default 0.7. */
  temperature?: number;
  /** Default 40. 0 disables top-k. */
  topK?: number;
  /** Default 0.9. */
  topP?: number;
  /** Default 0.05. */
  minP?: number;
  /** Default 1.1. 1 disables the penalty. */
  repeatPenalty?: number;
  /** Default 64. */
  repeatLastN?: number;
  /** Fixed seed for reproducible sampling. Random by default. */
  seed?: number;
};

export type ThistleGenerationOptions = ThistleLimits &
  ThistleSampling & {
    /** Passed to templates that support `enable_thinking` (e.g. Qwen3). Default false. */
    enableThinking?: boolean;
  };

export type ThistleInitOptions = ThistleGenerationOptions & {
  /** System instructions, or `'xylem'` for the built-in mobile assistant prompt. */
  scaffolding?: string;
  /**
   * Overrides the GGUF chat template. Accepts a Jinja template or a llama.cpp
   * built-in template name such as `chatml`, `llama3`, `gemma`, `mistral-v7`.
   * Required for GGUF files that ship without `tokenizer.chat_template`.
   */
  chatTemplate?: string;
  /** Logs prompts and outputs to the console. Default false. */
  debug?: boolean;
};

export type ThistlePromptOptions = ThistleGenerationOptions & {
  /** JSON-serializable data added to the user message as context. */
  data?: unknown;
  /** Earlier turns of the conversation, oldest first. */
  history?: readonly ThistleMessage[];
};

export type ThistleModel = {
  /** Sends one user request (plus optional history and data) and resolves with the answer text. */
  prompt(text: string, options?: ThistlePromptOptions): Promise<string>;
  /** Runs a structured conversation. The last message must be from the user. */
  chat(
    messages: readonly ThistleMessage[],
    options?: ThistleGenerationOptions
  ): Promise<ThistleCompletion>;
  /** Releases the model. Idempotent; in-flight prompts reject with `model_unloaded`. */
  unload(): void;
  readonly isLoaded: boolean;
};

export type ThistleModelSource = number | string;

export type ThistleErrorCode =
  | 'invalid_argument'
  | 'model_load_failed'
  | 'model_not_loaded'
  | 'model_unloaded'
  | 'missing_chat_template'
  | 'unsupported_chat_template'
  | 'unsupported_model'
  | 'context_length_exceeded'
  | 'context_creation_failed'
  | 'decode_failed'
  | 'tokenization_failed'
  | 'detokenization_failed'
  | 'out_of_memory'
  | 'internal_error'
  | 'unknown';

export class ThistleError extends Error {
  readonly code: ThistleErrorCode;

  constructor(code: ThistleErrorCode, message: string) {
    super(message);
    this.name = 'ThistleError';
    this.code = code;
  }
}

const NATIVE_ERROR_PATTERN = /\[thistle:([a-z_]+)\]\s*([\s\S]*)/;

function toThistleError(error: unknown): ThistleError {
  if (error instanceof ThistleError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = NATIVE_ERROR_PATTERN.exec(message);
  if (match) {
    return new ThistleError(match[1] as ThistleErrorCode, match[2]!.trim());
  }
  return new ThistleError('unknown', message);
}

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

const MAX_TOKENS = 1_048_576;
const LIMIT_KEYS = [
  'maxInputTokens',
  'maxContextSize',
  'maxOutputTokens',
  'maxReasoningTokens',
] as const;
const GENERATION_KEYS = [
  ...LIMIT_KEYS,
  'enableThinking',
  'temperature',
  'topK',
  'topP',
  'minP',
  'repeatPenalty',
  'repeatLastN',
  'seed',
] as const;

// Earlier releases treated falsy limits as "no explicit limit", so 0 and null
// still select the native default.
function isUnset(key: keyof ThistleGenerationOptions, value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (value === 0 && (LIMIT_KEYS as readonly string[]).includes(key))
  );
}

function invalid(message: string): ThistleError {
  return new ThistleError('invalid_argument', message);
}

function checkInteger(name: string, value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw invalid(`${name} must be an integer from ${min} to ${max}.`);
  }
}

function checkNumber(name: string, value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw invalid(`${name} must be a number from ${min} to ${max}.`);
  }
}

function validateGenerationOptions(options: ThistleGenerationOptions) {
  const checks: Record<keyof ThistleGenerationOptions, (v: unknown) => void> = {
    maxInputTokens: (v) => checkInteger('maxInputTokens', v, 1, MAX_TOKENS),
    maxContextSize: (v) => checkInteger('maxContextSize', v, 16, MAX_TOKENS),
    maxOutputTokens: (v) => checkInteger('maxOutputTokens', v, 1, MAX_TOKENS),
    maxReasoningTokens: (v) =>
      checkInteger('maxReasoningTokens', v, 0, MAX_TOKENS),
    enableThinking: (v) => {
      if (typeof v !== 'boolean') {
        throw invalid('enableThinking must be a boolean.');
      }
    },
    temperature: (v) => checkNumber('temperature', v, 0, 100),
    topK: (v) => checkInteger('topK', v, 0, 1_000_000),
    topP: (v) => checkNumber('topP', v, 0, 1),
    minP: (v) => checkNumber('minP', v, 0, 1),
    repeatPenalty: (v) => checkNumber('repeatPenalty', v, 0.01, 10),
    repeatLastN: (v) => checkInteger('repeatLastN', v, 0, MAX_TOKENS),
    seed: (v) => checkInteger('seed', v, 0, 0xffffffff),
  };
  for (const key of GENERATION_KEYS) {
    if (!isUnset(key, options[key])) {
      checks[key](options[key]);
    }
  }
  const { maxContextSize, maxOutputTokens } = options;
  if (
    !isUnset('maxContextSize', maxContextSize) &&
    !isUnset('maxOutputTokens', maxOutputTokens) &&
    maxOutputTokens! >= maxContextSize!
  ) {
    throw invalid('maxOutputTokens must be smaller than maxContextSize.');
  }
}

function pickGenerationOptions(
  options: ThistleGenerationOptions
): ThistleGenerationOptions {
  const picked: Record<string, unknown> = {};
  for (const key of GENERATION_KEYS) {
    if (!isUnset(key, options[key])) {
      picked[key] = options[key];
    }
  }
  return picked as ThistleGenerationOptions;
}

function validateMessages(messages: readonly ThistleMessage[]) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalid('messages must be a non-empty array.');
  }
  for (const message of messages) {
    if (
      message === null ||
      typeof message !== 'object' ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      throw invalid(
        'Each message needs a role of system, user, or assistant and string content.'
      );
    }
  }
  if (messages[messages.length - 1]!.role !== 'user') {
    throw invalid('The last message must have the user role.');
  }
}

function serializeData(data: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(data, null, 2);
  } catch (error) {
    throw invalid(
      `data must be JSON-serializable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (serialized === undefined) {
    throw invalid('data must be JSON-serializable.');
  }
  return serialized;
}

/** Builds the user turn for `prompt()`; context data stays in the user role. */
export function buildUserContent(text: string, data?: unknown): string {
  if (typeof text !== 'string') {
    throw invalid('The prompt text must be a string.');
  }
  if (data === undefined) {
    return text.trim();
  }
  return `Context data (use this when relevant):\n${serializeData(
    data
  )}\n\nUser request:\n${text.trim()}`;
}

/** Prepends scaffolding as a system message, merging with an existing one. */
export function withScaffolding(
  messages: readonly ThistleMessage[],
  scaffolding: string | undefined
): ThistleMessage[] {
  const system = resolveScaffolding(scaffolding)?.trim();
  if (!system) {
    return [...messages];
  }
  const [first, ...rest] = messages;
  if (first?.role === 'system') {
    return [
      { role: 'system', content: `${system}\n\n${first.content}` },
      ...rest,
    ];
  }
  return [{ role: 'system', content: system }, ...messages];
}

function parseCompletion(json: string): ThistleCompletion {
  const value = JSON.parse(json) as Partial<ThistleCompletion>;
  return {
    text: value.text ?? '',
    reasoning: value.reasoning ?? '',
    finishReason: value.finishReason === 'stop' ? 'stop' : 'length',
    promptTokens: value.promptTokens ?? 0,
    completionTokens: value.completionTokens ?? 0,
    reasoningTokens: value.reasoningTokens ?? 0,
    contextSize: value.contextSize ?? 0,
  };
}

function resolveModelPath(modelSource: ThistleModelSource): string {
  const modelPath =
    typeof modelSource === 'number'
      ? Image.resolveAssetSource(modelSource)?.uri
      : modelSource;
  if (typeof modelPath !== 'string' || modelPath.length === 0) {
    throw invalid('Thistle.init() could not resolve the model asset.');
  }
  return modelPath;
}

export const Thistle = {
  async init(
    modelSource: ThistleModelSource,
    options: ThistleInitOptions = {}
  ): Promise<ThistleModel> {
    const debug = options.debug ?? false;
    validateGenerationOptions(options);
    if (
      options.chatTemplate !== undefined &&
      typeof options.chatTemplate !== 'string'
    ) {
      throw invalid('chatTemplate must be a string.');
    }
    const modelPath = resolveModelPath(modelSource);
    const defaults = pickGenerationOptions(options);

    let modelId: number;
    try {
      modelId = await ThistleHybridObject.loadModel(
        modelPath,
        JSON.stringify(
          options.chatTemplate ? { chatTemplate: options.chatTemplate } : {}
        )
      );
    } catch (error) {
      throw toThistleError(error);
    }
    try {
      await ThistleHybridObject.warmup(modelId, defaults.maxContextSize ?? 0);
    } catch (error) {
      ThistleHybridObject.unloadModel(modelId);
      throw toThistleError(error);
    }

    let loaded = true;

    const chat = async (
      messages: readonly ThistleMessage[],
      chatOptions: ThistleGenerationOptions = {}
    ): Promise<ThistleCompletion> => {
      if (!loaded) {
        throw new ThistleError(
          'model_unloaded',
          'This model has been unloaded.'
        );
      }
      validateMessages(messages);
      const generation = { ...defaults, ...pickGenerationOptions(chatOptions) };
      validateGenerationOptions(generation);
      const request = {
        ...generation,
        messages: withScaffolding(messages, options.scaffolding).map(
          ({ role, content }) => ({ role, content })
        ),
      };
      if (debug) {
        console.log('[Thistle] request:', request);
      }
      try {
        const completion = parseCompletion(
          await ThistleHybridObject.prompt(modelId, JSON.stringify(request))
        );
        if (debug) {
          console.log('[Thistle] completion:', completion);
        }
        return completion;
      } catch (error) {
        const thistleError = toThistleError(error);
        if (debug) {
          console.error('[Thistle] prompt failed:', thistleError);
        }
        throw thistleError;
      }
    };

    return {
      chat,
      async prompt(text: string, promptOptions: ThistlePromptOptions = {}) {
        const { data, history = [], ...generation } = promptOptions;
        const completion = await chat(
          [...history, { role: 'user', content: buildUserContent(text, data) }],
          generation
        );
        return completion.text;
      },
      unload() {
        if (!loaded) {
          return;
        }
        loaded = false;
        ThistleHybridObject.unloadModel(modelId);
      },
      get isLoaded() {
        return loaded;
      },
    };
  },
};
