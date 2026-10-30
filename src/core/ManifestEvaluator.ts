import { EvaluationWorkspace } from './EvaluationWorkspace';
import { sandboxCommand } from './ExecutionSandbox';
import { runProcess } from './ProcessRunner';
import { CandidateSnapshot, CandidateSnapshotEvaluator, FitnessFunctionResult } from './types';
import { PerformanceMetrics } from './safeEval';
import { LoadedTaskManifest, TaskCommand } from './TaskManifest';

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

/** Executes allowlisted file snapshots using manifest commands and the OS sandbox. */
export class ManifestEvaluator implements CandidateSnapshotEvaluator {
  readonly candidateType = 'snapshot' as const;

  constructor(private readonly loaded: LoadedTaskManifest, private readonly sandbox = true) {}

  async evaluate(candidate: CandidateSnapshot): Promise<FitnessFunctionResult> {
    const { config, projectRoot } = this.loaded;
    if (!config.files.includes(candidate.primaryFile)) {
      throw new Error(`Primary candidate file is not configured: ${candidate.primaryFile}`);
    }

    const correctnessWorkspace = new EvaluationWorkspace(projectRoot, config.files);
    try {
      correctnessWorkspace.writeCandidates(candidate.files);
      const correctnessStarted = Date.now();
      const correctness = await this.runCommand(correctnessWorkspace, config.correctness, 4 * 1024 * 1024);
      const correctnessCheckTimeMs = Date.now() - correctnessStarted;
      if (!correctness.passed) return { status: 'invalid', reason: correctness.reason };

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
      const efficiencyScore = 1000 / (1000 + benchmark.medianMs);
      const { quality, efficiency } = config.scoreWeights;
      const totalWeight = quality + efficiency;
      const finalScore = (qualityScore * quality + efficiencyScore * efficiency) / totalWeight;
      const sampleScores = benchmark.samplesMs.map(sampleMs =>
        (qualityScore * quality + (1000 / (1000 + sampleMs)) * efficiency) / totalWeight
      );
      const sampleMedian = median(sampleScores);
      benchmark.finalScoreMad = median(sampleScores.map(score => Math.abs(score - sampleMedian)));

      const metrics: PerformanceMetrics = {
        executionTime: correctnessCheckTimeMs,
        correctnessCheckTimeMs,
        benchmark,
        memoryUsage: { before: {} as any, after: {} as any, delta: {} as any },
        cpuUsage: { user: 0, system: 0 },
        gcStats: { count: 0, totalTime: 0 },
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
    extraEnv: NodeJS.ProcessEnv = {}
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
    for (const name of ['LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR']) {
      if (process.env[name]) env[name] = process.env[name];
    }

    const wrapped = sandboxCommand(spec.command, args, {
      workspaceRoot: workspace.root,
      projectRoot: this.loaded.projectRoot,
      allowNetwork: this.loaded.config.allowNetwork,
      enabled: this.sandbox,
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
