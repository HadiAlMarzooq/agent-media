import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface RunProcessOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: number | RunProcessOptions = 30_000,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const { timeoutMs, signal } = typeof options === 'number' ? { timeoutMs: options } : options;
    if (signal?.aborted) {
      resolve({ stdout: '', stderr: '', exitCode: -1, timedOut: false, aborted: true });
      return;
    }
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const stopForAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs ?? 30_000);
    signal?.addEventListener('abort', stopForAbort, { once: true });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stopForAbort);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stopForAbort);
      resolve({ stdout, stderr, exitCode: exitCode ?? -1, timedOut, aborted });
    });
  });
}
