export interface Prompt {
  /** Safety rules, language, size and format rules. Never contains sender text. */
  readonly system: string;
  /** Sender text between one open and one close delimiter. */
  readonly user: string;
}

export interface AiClient {
  complete(prompt: Prompt): Promise<string>;
}

export const AI_ERROR_KINDS = ['quota', 'timeout', 'network', 'unknown'] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

const FOREIGN_ERROR_MESSAGE = 'Unknown AI error';

export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'AiError';
    this.kind = kind;
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}

/** Non-AiError values become kind 'unknown'. The original message is dropped. */
export function toAiError(value: unknown): AiError {
  return isAiError(value) ? value : new AiError('unknown', FOREIGN_ERROR_MESSAGE);
}
