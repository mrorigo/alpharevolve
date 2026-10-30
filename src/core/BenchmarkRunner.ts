import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import { EvaluationWorkspace } from './EvaluationWorkspace';
import { runProcess } from './ProcessRunner';
import type { ProcessRunResult } from './ProcessRunner';
import { sandboxCommand } from './ExecutionSandbox';
import { CandidateEvaluator, FitnessFunctionResult } from './types';
import { PerformanceMetrics } from './safeEval';
import { Logger } from './logger';

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface BenchmarkOptions {
    /** Candidate source file inside projectRoot */
    targetFilePath: string;
    /** Path to the test file that verifies the code */
    testFilePath: string;
    /** Project root mirrored into an isolated workspace (defaults to cwd). */
    projectRoot?: string;
    /** Command to run tests (defaults to the current Node executable). */
    testCommand?: string;
    /** Optional extra arguments for the test command */
    testArgs?: string[];
    /** Relative weights for correctness and execution efficiency. */
    qualityWeight?: number;
    efficiencyWeight?: number;
    /** Maximum time allowed for one test process. */
    timeoutMs?: number;
    /** Optional command that prints a JSON benchmark result to stdout. */
    benchmarkCommand?: string;
    /** Arguments for the benchmark command; supports {workspace}, {target}, and {test}. */
    benchmarkArgs?: string[];
    /** Warmup count supplied to the benchmark command. Defaults to 1. */
    benchmarkWarmupRuns?: number;
    /** Number of measured samples requested from the benchmark command. Defaults to 5. */
    benchmarkSampleRuns?: number;
    /** Allow evaluation tests to access the network. Defaults to false. */
    allowNetwork?: boolean;
    /** Explicit opt-out for trusted test suites on unsupported systems. */
    sandbox?: boolean;
}

export class BenchmarkRunner implements CandidateEvaluator {
    private readonly options: BenchmarkOptions;

    constructor(options: BenchmarkOptions) {
        this.options = {
            ...options,
            projectRoot: path.resolve(options.projectRoot || process.cwd()),
            testCommand: options.testCommand || process.execPath,
            qualityWeight: options.qualityWeight ?? (options.benchmarkCommand ? 0.7 : 1),
            efficiencyWeight: options.benchmarkCommand ? (options.efficiencyWeight ?? 0.3) : 0,
            timeoutMs: options.timeoutMs ?? 120_000,
            benchmarkWarmupRuns: options.benchmarkWarmupRuns ?? 1,
            benchmarkSampleRuns: options.benchmarkSampleRuns ?? 5,
            allowNetwork: options.allowNetwork ?? false,
            sandbox: options.sandbox ?? true,
        };
        if (this.options.testArgs) this.options.testArgs = [...this.options.testArgs];
        if (this.options.benchmarkArgs) this.options.benchmarkArgs = [...this.options.benchmarkArgs];
        const weights = [this.options.qualityWeight, this.options.efficiencyWeight];
        if (weights.some(weight => !Number.isFinite(weight) || weight! < 0) || weights.every(weight => weight === 0)) {
            throw new Error('Score weights must be finite, non-negative, and at least one must be positive');
        }
        if (!Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs! < 1) {
            throw new Error('Test timeout must be a positive number of milliseconds');
        }
        if (!this.options.benchmarkCommand && this.options.benchmarkArgs?.length) {
            throw new Error('benchmarkArgs require benchmarkCommand');
        }
        if (!Number.isInteger(this.options.benchmarkWarmupRuns) || this.options.benchmarkWarmupRuns! < 0) {
            throw new Error('benchmarkWarmupRuns must be a non-negative integer');
        }
        if (!Number.isInteger(this.options.benchmarkSampleRuns) || this.options.benchmarkSampleRuns! < 1) {
            throw new Error('benchmarkSampleRuns must be a positive integer');
        }
    }

    /**
     * Evaluates a candidate solution by running the test suite
     */
    public async evaluate(solution: string): Promise<FitnessFunctionResult> {
        const workspace = new EvaluationWorkspace(
            this.options.projectRoot!,
            this.options.targetFilePath,
            this.options.testFilePath
        );

        try {
            workspace.writeCandidate(solution);

            const startTime = Date.now();
            const correctnessStart = Date.now();
            const testResult = await this.runTests(workspace);
            const correctnessCheckTimeMs = Date.now() - correctnessStart;
            const passed = testResult.passed;

            if (!passed) return { status: 'invalid', reason: testResult.reason };

            let benchmark: PerformanceMetrics['benchmark'];
            if (this.options.benchmarkCommand) {
                const benchmarkWorkspace = new EvaluationWorkspace(
                    this.options.projectRoot!,
                    this.options.targetFilePath,
                    this.options.testFilePath
                );
                try {
                    benchmarkWorkspace.writeCandidate(solution);
                    const result = await this.runBenchmark(benchmarkWorkspace);
                    if ('reason' in result) return { status: 'invalid', reason: result.reason };
                    benchmark = result;
                } finally {
                    benchmarkWorkspace.cleanup();
                }
            }
            const executionTime = Date.now() - startTime;

            let detailedMetrics = {
                executionTime,
                memoryUsage: { before: {} as any, after: {} as any, delta: {} as any },
                cpuUsage: { user: 0, system: 0 },
                gcStats: { count: 0, totalTime: 0 }
            };

            if (passed && fs.existsSync(workspace.metricsFilePath)) {
                try {
                    const metricsData = JSON.parse(fs.readFileSync(workspace.metricsFilePath, 'utf-8'));
                    // Aggregate metrics from all tests
                    let totalGcCount = 0;
                    let totalGcTime = 0;
                    let maxHeapUsed = 0;
                    let aggregatedDelta: any = { heapUsed: 0, rss: 0, heapTotal: 0 };

                    Object.values(metricsData).forEach((m: any) => {
                        totalGcCount += m.gcStats.count;
                        totalGcTime += m.gcStats.totalTime;

                        if (m.memoryUsage.end.heapUsed > maxHeapUsed) {
                            maxHeapUsed = m.memoryUsage.end.heapUsed;
                            // Use the delta from the most memory-intensive test
                            // This is a heuristic; technically we might want sum of deltas
                            // if looking for leaks, but max usage snapshot is good for peak.
                            if (m.memoryUsage.delta) {
                                aggregatedDelta = m.memoryUsage.delta;
                            }
                        }
                    });

                    detailedMetrics.gcStats = { count: totalGcCount, totalTime: totalGcTime };
                    detailedMetrics.memoryUsage.after = { heapUsed: maxHeapUsed } as any;
                    detailedMetrics.memoryUsage.delta = aggregatedDelta;
                } catch (e) {
                    Logger.error('Failed to parse metrics file', e);
                }

            }

            const qualityScore = 1;
            const efficiencyScore = benchmark ? 1000 / (1000 + benchmark.medianMs) : 1;

            const totalWeight = this.options.qualityWeight! + this.options.efficiencyWeight!;
            if (totalWeight <= 0) throw new Error('At least one effective score weight must be positive');
            const finalScore = (
                qualityScore * this.options.qualityWeight! +
                efficiencyScore * this.options.efficiencyWeight!
            ) / totalWeight;
            if (benchmark) {
                const sampleScores = benchmark.samplesMs.map(sampleMs => (
                    qualityScore * this.options.qualityWeight! +
                    (1000 / (1000 + sampleMs)) * this.options.efficiencyWeight!
                ) / totalWeight);
                const sampleScoreMedian = median(sampleScores);
                benchmark.finalScoreMad = median(sampleScores.map(score => Math.abs(score - sampleScoreMedian)));
            }

            return {
                qualityScore,
                efficiencyScore,
                finalScore,
                performanceMetrics: {
                    ...detailedMetrics,
                    correctnessCheckTimeMs,
                    benchmark,
                }
            };

        } catch (error) {
            Logger.error('Benchmark evaluation failed', error);
            throw new Error(`Benchmark evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            workspace.cleanup();
        }
    }

    private async runBenchmark(workspace: EvaluationWorkspace): Promise<
        NonNullable<PerformanceMetrics['benchmark']> | { reason: string }
    > {
        const replacePathTokens = (value: string): string => value
            .replace(/\{workspace\}/g, () => workspace.root)
            .replace(/\{target\}/g, () => workspace.targetFilePath)
            .replace(/\{test\}/g, () => workspace.testFilePath);
        const args = (this.options.benchmarkArgs || []).map(replacePathTokens);
        const result = await this.runEvaluationCommand(
            workspace,
            this.options.benchmarkCommand!,
            args,
            {
                ALPHA_BENCHMARK_WARMUP_RUNS: String(this.options.benchmarkWarmupRuns),
                ALPHA_BENCHMARK_SAMPLE_RUNS: String(this.options.benchmarkSampleRuns),
            },
            1024 * 1024
        );
        this.assertSandboxStarted(result.stderr);
        if (result.timedOut) return { reason: `Benchmark command timed out after ${this.options.timeoutMs}ms` };
        if (result.exitCode !== 0) {
            return { reason: `Benchmark command exited with code ${String(result.exitCode)}${result.stderr.trim() ? `: ${result.stderr.trim().slice(-2000)}` : ''}` };
        }

        let payload: any;
        try {
            payload = JSON.parse(result.stdout.trim());
        } catch (error) {
            throw new Error(`Benchmark command must print one JSON object to stdout: ${String(error)}`);
        }
        const samples = payload?.samplesMs;
        const expectedSamples = this.options.benchmarkSampleRuns!;
        if (!Array.isArray(samples) || samples.length !== expectedSamples ||
            samples.some((sample: unknown) => typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0)) {
            throw new Error(`Benchmark output samplesMs must contain exactly ${expectedSamples} finite, non-negative durations`);
        }
        if (payload.warmupRuns !== this.options.benchmarkWarmupRuns) {
            throw new Error(`Benchmark output warmupRuns must equal ${this.options.benchmarkWarmupRuns}`);
        }

        const sorted = [...samples].sort((a: number, b: number) => a - b);
        const medianMs = sorted.length % 2
            ? sorted[Math.floor(sorted.length / 2)]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        const deviations = samples.map((sample: number) => Math.abs(sample - medianMs)).sort((a: number, b: number) => a - b);
        const madMs = deviations.length % 2
            ? deviations[Math.floor(deviations.length / 2)]
            : (deviations[deviations.length / 2 - 1] + deviations[deviations.length / 2]) / 2;
        return { samplesMs: samples, medianMs, madMs, warmupRuns: this.options.benchmarkWarmupRuns! };
    }

    private async runTests(workspace: EvaluationWorkspace): Promise<{ passed: boolean; reason: string }> {
        const envPath = path.join(workspace.root, 'dist/core/jest/AlphaEnvironment.js');
        if (!fs.existsSync(envPath)) {
            Logger.warn(`AlphaEnvironment not found in isolated workspace. Metrics will not be collected.`);
        }

        const defaultJest = path.join(workspace.root, 'node_modules/jest/bin/jest.js');
        const args = [
            ...(this.options.testArgs || [defaultJest]),
            path.relative(workspace.root, workspace.testFilePath),
            '--env', envPath,
        ];
        const result = await this.runEvaluationCommand(
            workspace,
            this.options.testCommand!,
            args,
            { ALPHA_METRICS_PATH: workspace.metricsFilePath },
            4 * 1024 * 1024
        );

        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        this.assertSandboxStarted(result.stderr);

        if (result.timedOut) {
            return { passed: false, reason: `Test suite timed out after ${this.options.timeoutMs}ms${result.stderr ? `: ${result.stderr.trim()}` : ''}` };
        }
        if (result.exitCode !== 0) {
            const detail = result.stderr.trim();
            return { passed: false, reason: `Test suite exited with code ${String(result.exitCode)}${detail ? `: ${detail.slice(-2000)}` : ''}` };
        }
        return { passed: true, reason: '' };
    }

    private evaluationEnvironment(
        workspace: EvaluationWorkspace,
        extra: NodeJS.ProcessEnv
    ): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            PATH: process.env.PATH || '/usr/bin:/bin',
            HOME: workspace.homePath,
            USERPROFILE: workspace.homePath,
            TMPDIR: workspace.tempPath,
            TMP: workspace.tempPath,
            TEMP: workspace.tempPath,
            CI: 'true',
            ...extra,
        };
        for (const name of ['LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR']) {
            if (process.env[name]) env[name] = process.env[name];
        }
        return env;
    }

    private async runEvaluationCommand(
        workspace: EvaluationWorkspace,
        command: string,
        args: string[],
        extraEnv: NodeJS.ProcessEnv,
        maxOutputBytes: number
    ): Promise<ProcessRunResult> {
        const wrapped = sandboxCommand(command, args, {
            workspaceRoot: workspace.root,
            projectRoot: this.options.projectRoot,
            allowNetwork: this.options.allowNetwork,
            enabled: this.options.sandbox,
        });
        const result = await runProcess(wrapped.command, wrapped.args, {
            cwd: workspace.root,
            env: this.evaluationEnvironment(workspace, extraEnv),
            timeoutMs: this.options.timeoutMs,
            stdio: 'pipe',
            maxOutputBytes,
        });
        return result;
    }

    private assertSandboxStarted(stderr: string): void {
        if (/sandbox_(?:apply|init)|operation not permitted/i.test(stderr)) {
            throw new Error(`The operating system could not apply the requested evaluation sandbox: ${stderr.trim()}`);
        }
    }
}
