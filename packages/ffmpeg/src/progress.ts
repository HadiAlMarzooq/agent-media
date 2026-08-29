export type MediaProgressPhase =
  'inspecting' | 'planning' | 'executing' | 'verifying' | 'completed';

/** A monotonic progress event safe to surface through SDK, CLI, and MCP adapters. */
export interface MediaProgress {
  phase: MediaProgressPhase;
  percent: number;
  message: string;
  processedSeconds?: number;
  totalSeconds?: number;
  speed?: number;
}

export type ProgressCallback = (progress: MediaProgress) => void;

interface ExecutionProgressReporter {
  start(): void;
  write(chunk: string): void;
  complete(): void;
}

/** Parse FFmpeg's `-progress` key/value stream without depending on chunk boundaries. */
export function createExecutionProgressReporter(
  totalSeconds: number | undefined,
  onProgress: ProgressCallback | undefined,
): ExecutionProgressReporter {
  let buffer = '';
  let fields: Record<string, string> = {};
  let lastPercent = -1;
  let lastProcessedSeconds = -1;

  const emit = (
    percent: number,
    message: string,
    processedSeconds?: number,
    speed?: number,
  ): void => {
    const normalizedPercent = Math.max(lastPercent, Math.min(100, Math.round(percent)));
    if (
      normalizedPercent === lastPercent &&
      (processedSeconds === undefined || processedSeconds - lastProcessedSeconds < 0.25)
    ) {
      return;
    }
    lastPercent = normalizedPercent;
    if (processedSeconds !== undefined) lastProcessedSeconds = processedSeconds;
    safelyNotify(onProgress, {
      phase: 'executing',
      percent: normalizedPercent,
      message,
      ...(processedSeconds === undefined ? {} : { processedSeconds }),
      ...(totalSeconds === undefined ? {} : { totalSeconds }),
      ...(speed === undefined ? {} : { speed }),
    });
  };

  const flushLine = (line: string): void => {
    const separator = line.indexOf('=');
    if (separator === -1) return;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    fields[key] = value;
    if (key !== 'progress') return;

    const processedSeconds = parseProcessedSeconds(fields);
    const speed = parseSpeed(fields.speed);
    const percent =
      processedSeconds === undefined || totalSeconds === undefined || totalSeconds <= 0
        ? 0
        : Math.min(99, (processedSeconds / totalSeconds) * 100);
    emit(percent, 'FFmpeg is executing the media plan.', processedSeconds, speed);
    fields = {};
  };

  return {
    start: () => emit(0, 'FFmpeg started executing the media plan.', 0),
    write: (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        flushLine(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    complete: () => emit(100, 'FFmpeg completed the media plan.', totalSeconds, undefined),
  };
}

export function safelyNotify(
  onProgress: ProgressCallback | undefined,
  progress: MediaProgress,
): void {
  try {
    onProgress?.(progress);
  } catch {
    // Progress is observational and must never change execution semantics.
  }
}

function parseProcessedSeconds(fields: Record<string, string>): number | undefined {
  const microseconds = Number(fields.out_time_us);
  if (Number.isFinite(microseconds) && microseconds >= 0) return microseconds / 1_000_000;

  const timestamp = fields.out_time;
  if (timestamp === undefined) return undefined;
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(timestamp);
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const value = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(value) ? value : undefined;
}

function parseSpeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const speed = Number(value.replace(/x$/, ''));
  return Number.isFinite(speed) ? speed : undefined;
}
