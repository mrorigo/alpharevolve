import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { deserialize, serialize } from 'v8';
import { runProcess } from './ProcessRunner';
import { sandboxCommand } from './ExecutionSandbox';

export interface PerformanceMetrics {
  executionTime: number;
  correctnessCheckTimeMs?: number;
  benchmark?: {
    samplesMs: number[];
    medianMs: number;
    madMs: number;
    warmupRuns: number;
    finalScoreMad?: number;
  };
  memoryUsage: { before: NodeJS.MemoryUsage; after: NodeJS.MemoryUsage; delta: NodeJS.MemoryUsage };
  cpuUsage: { user: number; system: number };
  gcStats?: { count: number; totalTime: number };
  resourceMetrics?: { available: boolean; processCount: number; source: 'node-preload' };
  stats?: { functionCalls?: number; iterations?: number; memoryLimitExceeded?: boolean };
}

export interface SafeEvalOptions {
  timeoutMs?: number;
  functionName?: string;
  maxMemoryMB?: number;
  trackDetailedStats?: boolean;
  cleanupFiles?: boolean;
  sandbox?: boolean;
}

export interface SafeEvalResult {
  result: any;
  executionTime: number;
  performanceMetrics?: PerformanceMetrics;
}

const RUNNER = String.raw`
const fs = require('fs');
const { deserialize, serialize } = require('v8');
const { performance, PerformanceObserver } = require('perf_hooks');
const { code, input, functionName, trackDetailedStats } = deserialize(Buffer.from(fs.readFileSync(0, 'utf8'), 'base64'));
let gcCount = 0;
let gcTotalTime = 0;
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) if (entry.name.startsWith('gc')) { gcCount++; gcTotalTime += entry.duration; }
});
try { observer.observe({ entryTypes: ['gc'] }); } catch {}
const before = process.memoryUsage();
const cpuBefore = process.cpuUsage();
let calls = 0;
const start = performance.now();
Promise.resolve().then(() => {
  const fn = new Function(code + '\nreturn ' + functionName + ';')();
  calls++;
  return fn(input);
}).then(result => {
  const executionTime = performance.now() - start;
  const after = process.memoryUsage();
  const cpuUsage = process.cpuUsage(cpuBefore);
  const delta = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
  observer.disconnect();
  const response = { success: true, result, executionTime, performanceMetrics: {
    executionTime, memoryUsage: { before, after, delta }, cpuUsage,
    gcStats: { count: gcCount, totalTime: gcTotalTime },
    ...(trackDetailedStats ? { stats: { functionCalls: calls } } : {})
  }};
  fs.writeSync(3, serialize(response));
}).catch(error => {
  observer.disconnect();
  const message = String(error && error.stack || error);
  fs.writeSync(3, serialize({ success: false, error: message,
    memoryLimitExceeded: /allocation failed|heap out of memory/i.test(message) }));
  process.exitCode = 1;
});
`;

/** Evaluate candidate code in a resource-limited child process. */
export async function safeEval(
  code: string,
  input: any,
  timeoutMs: number | SafeEvalOptions = 5000,
  functionNameOrOptions?: string | SafeEvalOptions
): Promise<SafeEvalResult> {
  const options: SafeEvalOptions = typeof timeoutMs === 'object'
    ? timeoutMs
    : typeof functionNameOrOptions === 'object'
      ? { timeoutMs, ...functionNameOrOptions }
      : { timeoutMs, functionName: typeof functionNameOrOptions === 'string' ? functionNameOrOptions : undefined };
  const timeout = options.timeoutMs ?? 5000;
  const maxMemoryMB = options.maxMemoryMB ?? 500;
  const functionName = options.functionName ?? 'sort';
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('timeoutMs must be positive');
  if (!Number.isInteger(maxMemoryMB) || maxMemoryMB < 16) throw new Error('maxMemoryMB must be an integer of at least 16');
  if (!/^[$A-Z_a-z][$\w]*$/.test(functionName)) throw new Error('functionName must be a valid JavaScript identifier');

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `alphaevolve-eval-${randomUUID()}-`));
  const runnerPath = path.join(workspace, 'runner.cjs');
  try {
    fs.writeFileSync(runnerPath, RUNNER, { mode: 0o600 });
    const payload = serialize({ code, input, functionName, trackDetailedStats: options.trackDetailedStats !== false }).toString('base64');
    const command = sandboxCommand(process.execPath, [`--max-old-space-size=${maxMemoryMB}`, runnerPath], {
      workspaceRoot: workspace,
      projectRoot: process.cwd(),
      allowNetwork: false,
      enabled: options.sandbox !== false,
    });
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: workspace,
      TMPDIR: workspace,
      TMP: workspace,
      TEMP: workspace,
      NODE_NO_WARNINGS: '1',
    };
    const result = await runProcess(command.command, command.args, {
      cwd: workspace, env, timeoutMs: timeout, stdio: 'pipe', extraOutput: true, input: payload,
    });
    if (result.timedOut) throw new Error(`Evaluation timed out after ${timeout}ms`);
    if (/sandbox_(?:apply|init)|operation not permitted/i.test(result.stderr)) {
      throw new Error(`The operating system could not apply the requested evaluation sandbox: ${result.stderr.trim()}`);
    }
    if (!result.extraOutput) throw new Error(`Evaluation process returned no result${result.stderr ? `: ${result.stderr}` : ''}`);
    const response = deserialize(Buffer.from(result.extraOutput, 'base64')) as any;
    if (!response.success) {
      const memory = response.memoryLimitExceeded ? `Memory limit exceeded (${maxMemoryMB}MB): ` : '';
      throw new Error(memory + response.error);
    }
    if (result.exitCode !== 0) throw new Error(`Evaluation process exited with code ${result.exitCode}`);
    return { result: response.result, executionTime: response.executionTime, performanceMetrics: response.performanceMetrics };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Failed to set up evaluation: ${String(error)}`);
  } finally {
    if (options.cleanupFiles !== false) fs.rmSync(workspace, { recursive: true, force: true });
  }
}
