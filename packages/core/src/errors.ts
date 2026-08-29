/** Stable, machine-readable error codes returned by Agent Media. */
export type MediaErrorCode =
  | 'FFMPEG_NOT_FOUND'
  | 'PROBE_FAILED'
  | 'UNSUPPORTED_INPUT'
  | 'INVALID_PLAN'
  | 'EXECUTION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'PATH_NOT_ALLOWED'
  | 'OUTPUT_EXISTS'
  | 'OPERATION_TIMEOUT'
  | 'OPERATION_CANCELLED';

export interface MediaErrorDetails {
  code: MediaErrorCode;
  message: string;
  context?: Record<string, unknown>;
  suggestedActions?: string[];
  debug?: { backend?: string; stderr?: string };
}

/** Error whose stable fields are safe for agents to consume. */
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly context: Record<string, unknown> | undefined;
  readonly suggestedActions: string[] | undefined;
  readonly debug: MediaErrorDetails['debug'] | undefined;

  constructor(details: MediaErrorDetails) {
    super(details.message);
    this.name = 'MediaError';
    this.code = details.code;
    this.context = details.context;
    this.suggestedActions = details.suggestedActions;
    this.debug = details.debug;
  }

  toJSON(): MediaErrorDetails {
    return {
      code: this.code,
      message: this.message,
      ...(this.context === undefined ? {} : { context: this.context }),
      ...(this.suggestedActions === undefined ? {} : { suggestedActions: this.suggestedActions }),
      ...(this.debug === undefined ? {} : { debug: this.debug }),
    };
  }
}
