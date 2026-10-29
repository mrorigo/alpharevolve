import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import { EvaluationWorkspace } from './EvaluationWorkspace';
import { runProcess } from './ProcessRunner';
import { sandboxCommand } from './ExecutionSandbox';
import { FitnessFunctionResult } from './types';
import { Logger } from './logger';

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
    /** Allow evaluation tests to access the network. Defaults to false. */
    allowNetwork?: boolean;
    /** Explicit opt-out for trusted test suites on unsupported systems. */
    sandbox?: boolean;
}

export class BenchmarkRunner {
    private readonly options: BenchmarkOptions;

    constructor(options: BenchmarkOptions) {
        this.options = {
            ...options,
            projectRoot: path.resolve(options.projectRoot || process.cwd()),
            testCommand: options.testCommand || process.execPath,
            qualityWeight: options.qualityWeight ?? 0.7,
            efficiencyWeight: options.efficiencyWeight ?? 0.3,
            timeoutMs: options.timeoutMs ?? 120_000,
            allowNetwork: options.allowNetwork ?? false,
            sandbox: options.sandbox ?? true,
        };
        if (this.options.testArgs) this.options.testArgs = [...this.options.testArgs];
        const weights = [this.options.qualityWeight, this.options.efficiencyWeight];
        if (weights.some(weight => !Number.isFinite(weight) || weight! < 0) || weights.every(weight => weight === 0)) {
            throw new Error('Score weights must be finite, non-negative, and at least one must be positive');
        }
        if (!Number.isFinite(this.options.timeoutMs) || this.options.timeoutMs! < 1) {
            throw new Error('Test timeout must be a positive number of milliseconds');
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
            const testResult = await this.runTests(workspace);
            const executionTime = Date.now() - startTime;
            const passed = testResult.passed;

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

            const qualityScore = passed ? 1.0 : 0.0;
            // Enhanced efficiency score including GC penalties?
            // For now, keep simple time-based, but we *record* detailed metrics for the LLM.
            const efficiencyScore = passed ? (1000 / (1000 + executionTime)) : 0;

            const totalWeight = this.options.qualityWeight! + this.options.efficiencyWeight!;
            const finalScore = (
                qualityScore * this.options.qualityWeight! +
                efficiencyScore * this.options.efficiencyWeight!
            ) / totalWeight;

            if (!passed) {
                return { status: 'invalid', reason: testResult.reason };
            }

            return {
                qualityScore,
                efficiencyScore,
                finalScore,
                performanceMetrics: detailedMetrics
            };

        } catch (error) {
            Logger.error('Benchmark evaluation failed', error);
            throw new Error(`Benchmark evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            workspace.cleanup();
        }
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
        const env: NodeJS.ProcessEnv = {
            PATH: process.env.PATH || '/usr/bin:/bin',
            HOME: workspace.homePath,
            USERPROFILE: workspace.homePath,
            TMPDIR: workspace.tempPath,
            TMP: workspace.tempPath,
            TEMP: workspace.tempPath,
            CI: 'true',
            ALPHA_METRICS_PATH: workspace.metricsFilePath,
        };
        for (const name of ['LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR']) {
            if (process.env[name]) env[name] = process.env[name];
        }

        const wrapped = sandboxCommand(this.options.testCommand!, args, {
            workspaceRoot: workspace.root,
            projectRoot: this.options.projectRoot,
            allowNetwork: this.options.allowNetwork,
            enabled: this.options.sandbox,
        });
        const result = await runProcess(wrapped.command, wrapped.args, {
            cwd: workspace.root,
            env,
            timeoutMs: this.options.timeoutMs,
            stdio: 'inherit',
        });

        if (result.timedOut) {
            return { passed: false, reason: `Test suite timed out after ${this.options.timeoutMs}ms` };
        }
        if (result.exitCode !== 0) {
            return { passed: false, reason: `Test suite exited with code ${String(result.exitCode)}` };
        }
        return { passed: true, reason: '' };
    }
}
