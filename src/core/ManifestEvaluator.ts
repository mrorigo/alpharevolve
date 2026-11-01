import * as fs from 'fs';
import * as path from 'path';
import { EvaluationWorkspace } from './EvaluationWorkspace';
import { sandboxCommand } from './ExecutionSandbox';
import { runProcess } from './ProcessRunner';
import { CandidateSnapshot, CandidateSnapshotEvaluator, FitnessFunctionResult } from './types';
import { PerformanceMetrics } from './safeEval';
import { LoadedTaskManifest, TaskCommand } from './TaskManifest';
import { NODE_METRICS_PRELOAD } from './MetricsPreload';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface CommandResult {
  passed: boolean;
  reason: string;
  stdout: string;
  stderr: string;
}

interface NodeResourceMetric {
  executionTime: number;
  memoryUsage: PerformanceMetrics['memoryUsage'];
  cpuUsage: PerformanceMetrics['cpuUsage'];
  gcStats: NonNullable<PerformanceMetrics['gcStats']>;
}

function readNodeResourceMetrics(workspace: EvaluationWorkspace): Pick<PerformanceMetrics,
  'memoryUsage' | 'cpuUsage' | 'gcStats' | 'resourceMetrics'> {
  const metrics: NodeResourceMetric[] = [];
  for (const filename of fs.readdirSync(workspace.metricsDirectoryPath)) {
    if (!filename.endsWith('.json')) continue;
    try {
      metrics.push(JSON.parse(fs.readFileSync(path.join(workspace.metricsDirectoryPath, filename), 'utf8')));
    } catch {
      // A process can be killed before its exit hook writes a complete record.
    }
  }

  const peakProcess = metrics.sort((a, b) => b.memoryUsage.after.heapUsed - a.memoryUsage.after.heapUsed)[0];
  const zeroMemory = { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  return {
    memoryUsage: peakProcess
      ? peakProcess.memoryUsage
      : { before: { ...zeroMemory }, after: { ...zeroMemory }, delta: { ...zeroMemory } },
    cpuUsage: metrics.reduce((total, item) => ({
      user: total.user + item.cpuUsage.user,
      system: total.system + item.cpuUsage.system,
    }), { user: 0, system: 0 }),
    gcStats: metrics.reduce((total, item) => ({
      count: total.count + item.gcStats.count,
      totalTime: total.totalTime + item.gcStats.totalTime,
    }), { count: 0, totalTime: 0 }),
    resourceMetrics: {
      available: metrics.length > 0,
      processCount: metrics.length,
      source: 'node-preload',
    },
  };
}

/** Executes allowlisted file snapshots using manifest commands and the OS sandbox. */
export class ManifestEvaluator implements CandidateSnapshotEvaluator {
  readonly candidateType = 'snapshot' as const;

  /** Run-wide anchor median (ms) for relative scoring; injected on resume or captured from the first benchmark. */
  private baselineMedianMs: number | null = null;

  constructor(private readonly loaded: LoadedTaskManifest) {}

  /**
   * Restores the relative-scoring anchor when resuming a run, so post-restart
   * scores stay on the same scale as the ones already saved. Expected to be
   * the baseline candidate's recorded benchmark median.
   */
  setBaselineMedianMs(medianMs: number): void {
    if (!Number.isFinite(medianMs) || medianMs < 0) {
      throw new Error('Baseline median must be a finite, non-negative duration');
    }
    this.baselineMedianMs = medianMs;
  }

  /**
   * Efficiency scoring.
   * - 'absolute' (default, legacy): 1000/(1000+medianMs). Meaningful spread only
   *   for slow workloads; saturates near 1.0 for few-millisecond benchmarks.
   * - 'relative': baseline/(baseline+medianMs) with the anchor at parity=0.5.
   *   A candidate as fast as the baseline scores 0.5; 2× faster scores 0.667;
   *   the resolution survives fast benchmarks while staying in [0, 1).
   */
  private scoreEfficiency(medianMs: number): { efficiencyScore: number; baselineMedianMs: number | null } {
    if (this.loaded.config.scoreMode === 'relative') {
      let baseline = this.baselineMedianMs;
      if (baseline === null) {
        // First benchmark of the process becomes the anchor (parity = 0.5).
        baseline = medianMs;
        this.baselineMedianMs = medianMs;
      }
      return { efficiencyScore: baseline / (baseline + medianMs), baselineMedianMs: baseline };
    }
    return { efficiencyScore: 1000 / (1000 + medianMs), baselineMedianMs: null };
  }

  async evaluate(candidate: CandidateSnapshot): Promise<FitnessFunctionResult> {
    const { config, projectRoot } = this.loaded;
    if (!config.files.includes(candidate.primaryFile)) {
      throw new Error(`Primary candidate file is not configured: ${candidate.primaryFile}`);
    }

    const correctnessWorkspace = new EvaluationWorkspace(projectRoot, config.files);
    try {
      correctnessWorkspace.writeCandidates(candidate.files);
      const correctnessStarted = Date.now();
      const correctness = await this.runCommand(correctnessWorkspace, config.correctness, 4 * 1024 * 1024, {}, true);
      const correctnessCheckTimeMs = Date.now() - correctnessStarted;
      if (!correctness.passed) return { status: 'invalid', reason: correctness.reason };
      const resourceMetrics = readNodeResourceMetrics(correctnessWorkspace);

      const benchmarkWorkspace = new EvaluationWorkspace(projectRoot, config.files);
      let benchmark: NonNullable<PerformanceMetrics['benchmark']>;
      try {
        benchmarkWorkspace.writeCandidates(candidate.files);
        const result = await this.runBenchmark(benchmarkWorkspace);
        if ('reason' in result) return { status: 'invalid', reason: result.reason };
        benchmark = result;
      } finally {
        benchmarkWorkspace.cleanup();
      }

      const qualityScore = 1;
      const { efficiencyScore, baselineMedianMs } = this.scoreEfficiency(benchmark.medianMs);
      const { quality, efficiency } = config.scoreWeights;
      const totalWeight = quality + efficiency;
      const finalScore = (qualityScore * quality + efficiencyScore * efficiency) / totalWeight;
      const sampleEfficience = benchmark.samplesMs.map(sampleMs => this.scoreEfficiency(sampleMs).efficiencyScore);
      const sampleScores = benchmark.samplesMs.map((_, index) =>
        (qualityScore * quality + sampleEfficience[index] * efficiency) / totalWeight
      );
      const sampleMedian = median(sampleScores);
      benchmark.finalScoreMad = median(sampleScores.map(score => Math.abs(score - sampleMedian)));
      if (baselineMedianMs !== null && baselineMedianMs !== undefined) {
        benchmark.baselineMedianMs = baselineMedianMs;
      }

      const metrics: PerformanceMetrics = {
        executionTime: correctnessCheckTimeMs,
        correctnessCheckTimeMs,
        benchmark,
        ...resourceMetrics,
      };
      return { qualityScore, efficiencyScore, finalScore, performanceMetrics: metrics };
    } finally {
      correctnessWorkspace.cleanup();
    }
  }

  private async runBenchmark(workspace: EvaluationWorkspace): Promise<
    NonNullable<PerformanceMetrics['benchmark']> | { reason: string }
  > {
    const { benchmark } = this.loaded.config;
    const result = await this.runCommand(workspace, benchmark, 1024 * 1024, {
      ALPHA_BENCHMARK_WARMUP_RUNS: String(benchmark.warmupRuns),
      ALPHA_BENCHMARK_SAMPLE_RUNS: String(benchmark.sampleRuns),
    });
    if (!result.passed) return { reason: result.reason };

    let payload: any;
    try {
      payload = JSON.parse(result.stdout.trim());
    } catch (error) {
      throw new Error(`Benchmark command must print one JSON object to stdout: ${String(error)}`);
    }
    const samples = payload?.samplesMs;
    if (!Array.isArray(samples) || samples.length !== benchmark.sampleRuns ||
        samples.some((sample: unknown) => typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0)) {
      throw new Error(`Benchmark output samplesMs must contain exactly ${benchmark.sampleRuns} finite, non-negative durations`);
    }
    if (payload.warmupRuns !== benchmark.warmupRuns) {
      throw new Error(`Benchmark output warmupRuns must equal ${benchmark.warmupRuns}`);
    }

    const medianMs = median(samples);
    const madMs = median(samples.map((sample: number) => Math.abs(sample - medianMs)));
    return { samplesMs: samples, medianMs, madMs, warmupRuns: benchmark.warmupRuns };
  }

  private async runCommand(
    workspace: EvaluationWorkspace,
    spec: TaskCommand,
    maxOutputBytes: number,
    extraEnv: NodeJS.ProcessEnv = {},
    collectNodeMetrics = false
  ): Promise<CommandResult> {
    const primary = workspace.targetFilePath;
    const replaceTokens = (value: string) => value
      .replace(/\{workspace\}/g, () => workspace.root)
      .replace(/\{primary\}/g, () => primary);
    const args = spec.args.map(replaceTokens);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: workspace.homePath,
      USERPROFILE: workspace.homePath,
      TMPDIR: workspace.tempPath,
      TMP: workspace.tempPath,
      TEMP: workspace.tempPath,
      CI: 'true',
      ...extraEnv,
    };
    if (collectNodeMetrics) {
      fs.writeFileSync(workspace.metricsPreloadPath, NODE_METRICS_PRELOAD, 'utf8');
      env.ALPHA_METRICS_DIRECTORY = workspace.metricsDirectoryPath;
      env.NODE_OPTIONS = `--require=${JSON.stringify(workspace.metricsPreloadPath)}`;
    }
    for (const name of ['LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR']) {
      if (process.env[name]) env[name] = process.env[name];
    }

    const wrapped = sandboxCommand(spec.command, args, {
      workspaceRoot: workspace.root,
      projectRoot: this.loaded.projectRoot,
      allowNetwork: this.loaded.config.allowNetwork,
      enabled: this.loaded.config.sandbox,
    });
    const result = await runProcess(wrapped.command, wrapped.args, {
      cwd: workspace.root,
      env,
      timeoutMs: this.loaded.config.timeoutMs,
      stdio: 'pipe',
      maxOutputBytes,
    });
    if (/sandbox_(?:apply|init)|operation not permitted/i.test(result.stderr)) {
      throw new Error(`The operating system could not apply the requested evaluation sandbox: ${result.stderr.trim()}`);
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.timedOut) {
      return { passed: false, reason: `Command timed out after ${this.loaded.config.timeoutMs}ms`, stdout: result.stdout, stderr: result.stderr };
    }
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      return {
        passed: false,
        reason: `Command exited with code ${String(result.exitCode)}${detail ? `: ${detail.slice(-2000)}` : ''}`,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    return { passed: true, reason: '', stdout: result.stdout, stderr: result.stderr };
  }
}
