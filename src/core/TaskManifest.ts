import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface TaskCommand {
  command: string;
  args: string[];
}

export interface TaskManifest {
  version: 1;
  goal: string;
  files: string[];
  correctness: TaskCommand;
  benchmark: TaskCommand & { warmupRuns: number; sampleRuns: number };
  iterations: number;
  evaluationRepeats: number;
  timeoutMs: number;
  minImprovement: number;
  noiseToleranceMultiplier: number;
  scoreWeights: { quality: number; efficiency: number };
  allowNetwork: boolean;
}

export interface LoadedTaskManifest {
  manifestPath: string;
  projectRoot: string;
  manifestHash: string;
  config: TaskManifest;
  initialFiles: Record<string, string>;
}

const EXCLUDED_PATH_PARTS = new Set([
  '.git', 'node_modules', 'downstream', 'runs', 'coverage',
  '.aws', '.ssh', '.codex', '.agents', '.claude', '.config',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

function requireObject(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, any>;
}

function positiveInteger(value: unknown, name: string, fallback: number, minimum = 1): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || (result as number) < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return result as number;
}

function nonNegativeNumber(value: unknown, name: string, fallback: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return result;
}

function commandSpec(value: unknown, name: string): TaskCommand {
  const record = requireObject(value, name);
  if (typeof record.command !== 'string' || record.command.trim() === '') {
    throw new Error(`${name}.command must be a non-empty string`);
  }
  const args = record.args === undefined ? [] : record.args;
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new Error(`${name}.args must be an array of strings`);
  }
  return { command: record.command, args: [...args] };
}

function normalizeFilePath(value: unknown, root: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\\') || path.isAbsolute(value)) {
    throw new Error(`Task file paths must be non-empty, relative POSIX paths: ${String(value)}`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.env'))) {
    throw new Error(`Unsafe task file path: ${value}`);
  }
  if (parts.some(part => EXCLUDED_PATH_PARTS.has(part))) {
    throw new Error(`Task file uses an excluded project path: ${value}`);
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(value).toLowerCase())) {
    throw new Error(`Task files must be TypeScript or JavaScript source files: ${value}`);
  }

  const absolute = path.resolve(root, ...parts);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Task file is outside the project root: ${value}`);
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Task file does not exist or is not a regular file: ${value}`);
  }
  const real = fs.realpathSync(absolute);
  const realRelative = path.relative(root, real);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Task file resolves outside the project root: ${value}`);
  }
  const canonical = realRelative.split(path.sep).join('/');
  if (canonical.split('/').some(part => EXCLUDED_PATH_PARTS.has(part) || part.startsWith('.env'))) {
    throw new Error(`Task file resolves inside an excluded project path: ${value}`);
  }
  return canonical;
}

/** Read and validate one version 1 single-task JSON manifest. */
export function loadTaskManifest(manifestPath: string): LoadedTaskManifest {
  const absoluteManifestPath = path.resolve(manifestPath);
  const raw = fs.readFileSync(absoluteManifestPath, 'utf8');
  let parsed: Record<string, any>;
  try {
    parsed = requireObject(JSON.parse(raw), 'Manifest');
  } catch (error) {
    throw new Error(`Could not parse task manifest ${absoluteManifestPath}: ${String(error)}`);
  }
  if (parsed.version !== 1) throw new Error('Task manifest version must be 1');

  const projectRoot = fs.realpathSync(path.dirname(absoluteManifestPath));
  if (typeof parsed.goal !== 'string' || parsed.goal.trim() === '') {
    throw new Error('Task manifest goal must be a non-empty string');
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error('Task manifest files must be a non-empty array');
  }
  const files = parsed.files.map((file: unknown) => normalizeFilePath(file, projectRoot));
  if (new Set(files).size !== files.length) throw new Error('Task manifest files must be unique');

  const correctness = commandSpec(parsed.correctness, 'correctness');
  const benchmarkRecord = requireObject(parsed.benchmark, 'benchmark');
  const benchmarkCommand = commandSpec(benchmarkRecord, 'benchmark');
  const warmupRuns = positiveInteger(benchmarkRecord.warmupRuns, 'benchmark.warmupRuns', 1, 0);
  const sampleRuns = positiveInteger(benchmarkRecord.sampleRuns, 'benchmark.sampleRuns', 5);
  const scoreWeightsRecord = parsed.scoreWeights === undefined
    ? { quality: 0.7, efficiency: 0.3 }
    : requireObject(parsed.scoreWeights, 'scoreWeights');
  const scoreWeights = {
    quality: nonNegativeNumber(scoreWeightsRecord.quality, 'scoreWeights.quality', 0.7),
    efficiency: nonNegativeNumber(scoreWeightsRecord.efficiency, 'scoreWeights.efficiency', 0.3),
  };
  if (scoreWeights.quality + scoreWeights.efficiency <= 0) {
    throw new Error('At least one score weight must be positive');
  }
  if (parsed.allowNetwork !== undefined && typeof parsed.allowNetwork !== 'boolean') {
    throw new Error('allowNetwork must be a boolean');
  }

  const config: TaskManifest = {
    version: 1,
    goal: parsed.goal.trim(),
    files,
    correctness,
    benchmark: { ...benchmarkCommand, warmupRuns, sampleRuns },
    iterations: positiveInteger(parsed.iterations, 'iterations', 10),
    evaluationRepeats: positiveInteger(parsed.evaluationRepeats, 'evaluationRepeats', 1),
    timeoutMs: positiveInteger(parsed.timeoutMs, 'timeoutMs', 120_000),
    minImprovement: nonNegativeNumber(parsed.minImprovement, 'minImprovement', 0),
    noiseToleranceMultiplier: nonNegativeNumber(parsed.noiseToleranceMultiplier, 'noiseToleranceMultiplier', 1),
    scoreWeights,
    allowNetwork: parsed.allowNetwork ?? false,
  };
  const initialFiles = Object.fromEntries(
    files.map(file => [file, fs.readFileSync(path.join(projectRoot, ...file.split('/')), 'utf8')])
  );

  return {
    manifestPath: absoluteManifestPath,
    projectRoot,
    manifestHash: crypto.createHash('sha256').update(raw).digest('hex'),
    config,
    initialFiles,
  };
}
