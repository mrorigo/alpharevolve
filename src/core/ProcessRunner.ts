import { SpawnOptions, StdioOptions } from 'child_process';
import { spawn } from 'cross-spawn';

export interface ProcessRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killGraceMs?: number;
  stdio?: 'inherit' | 'pipe';
  extraOutput?: boolean;
  input?: string;
  maxOutputBytes?: number;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  extraOutput: string;
}

function signalProcessTree(pid: number, signal: NodeJS.Signals, detached: boolean): void {
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => undefined);
    return;
  }

  try {
    process.kill(detached ? -pid : pid, signal);
  } catch (error: any) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function appendBounded(current: Buffer[], chunk: Buffer, maxBytes: number): Buffer[] {
  current.push(chunk);
  let size = current.reduce((sum, part) => sum + part.length, 0);
  while (size > maxBytes && current.length > 0) {
    const first = current[0];
    const excess = size - maxBytes;
    if (first.length <= excess) {
      current.shift();
      size -= first.length;
    } else {
      current[0] = first.subarray(excess);
      size -= excess;
    }
  }
  return current;
}

/** Run a child process with a deadline and terminate its process tree on timeout. */
export function runProcess(command: string, args: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const capture = options.stdio === 'pipe' || options.input !== undefined;
    const stdio: StdioOptions = capture
      ? options.extraOutput ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe']
      : 'inherit';
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env,
      detached,
      windowsHide: true,
      stdio,
    };
    const child = spawn(command, args, spawnOptions);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const extraOutput: Buffer[] = [];
    const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    let timedOut = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const cleanupTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.on('error', error => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(error);
    });
    if (capture) {
      child.stdout?.on('data', (chunk: Buffer) => appendBounded(stdout, chunk, maxOutputBytes));
      child.stderr?.on('data', (chunk: Buffer) => appendBounded(stderr, chunk, maxOutputBytes));
      if (options.extraOutput) {
        child.stdio[3]?.on('data', (chunk: Buffer) => appendBounded(extraOutput, chunk, maxOutputBytes));
      }
      if (options.input !== undefined) child.stdin?.end(options.input);
      else child.stdin?.end();
    }

    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        if (child.pid) signalProcessTree(child.pid, 'SIGTERM', detached);
        killTimer = setTimeout(() => {
          if (child.pid) signalProcessTree(child.pid, 'SIGKILL', detached);
        }, options.killGraceMs ?? 1000);
      }, options.timeoutMs);
    }

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        extraOutput: Buffer.concat(extraOutput).toString('utf8'),
      });
    });
  });
}
