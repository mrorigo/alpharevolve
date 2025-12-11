import { spawn } from 'cross-spawn';
import * as fs from 'fs';
import * as path from 'path'; import { FitnessScores } from './types';
import { Logger } from './logger';

export interface BenchmarkOptions {
    /** Path currently occupied by the code we want to optimize */
    targetFilePath: string;
    /** Path to the test file that verifies the code */
    testFilePath: string;
    /** Command to run tests (default: 'npx jest') */
    testCommand?: string;
    /** Optional extra arguments for the test command */
    testArgs?: string[];
}

export class BenchmarkRunner {
    private options: BenchmarkOptions;
    private originalContent: string | null = null;

    constructor(options: BenchmarkOptions) {
        this.options = options;
        this.options.testCommand = options.testCommand || 'npx';
        this.options.testArgs = options.testArgs || ['jest'];
    }

    /**
     * Backups the original file content
     */
    private backupOriginal(): void {
        if (fs.existsSync(this.options.targetFilePath)) {
            this.originalContent = fs.readFileSync(this.options.targetFilePath, 'utf-8');
        }
    }

    /**
     * Restores the original file content
     */
    private restoreOriginal(): void {
        if (this.originalContent !== null) {
            fs.writeFileSync(this.options.targetFilePath, this.originalContent);
        }
    }

    /**
     * Evaluates a candidate solution by running the test suite
     */
    public async evaluate(solution: string): Promise<FitnessScores> {
        // 1. Backup
        if (this.originalContent === null) {
            this.backupOriginal();
        }

        const metricsPath = path.join(process.cwd(), `metrics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`);

        try {
            // 2. Write candidate solution
            fs.writeFileSync(this.options.targetFilePath, solution);

            // 3. Run tests
            const startTime = Date.now();
            const passed = await this.runTests(metricsPath);
            const executionTime = Date.now() - startTime;

            // 4. Collect & Aggregate Metrics
            let detailedMetrics = {
                executionTime,
                memoryUsage: { before: {} as any, after: {} as any, delta: {} as any },
                cpuUsage: { user: 0, system: 0 },
                gcStats: { count: 0, totalTime: 0 }
            };

            if (passed && fs.existsSync(metricsPath)) {
                try {
                    const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
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

                // Cleanup metrics file
                try { fs.unlinkSync(metricsPath); } catch (e) { }
            }

            // 5. Calculate scores
            const qualityScore = passed ? 1.0 : 0.0;
            // Enhanced efficiency score including GC penalties?
            // For now, keep simple time-based, but we *record* detailed metrics for the LLM.
            const efficiencyScore = passed ? (1000 / (1000 + executionTime)) : 0;

            const finalScore = (qualityScore * 0.7) + (efficiencyScore * 0.3);

            return {
                qualityScore,
                efficiencyScore,
                finalScore,
                performanceMetrics: detailedMetrics
            };

        } catch (error) {
            Logger.error('Benchmark evaluation failed', error);
            // Cleanup metrics file if exists
            if (fs.existsSync(metricsPath)) { try { fs.unlinkSync(metricsPath); } catch (e) { } }

            return {
                qualityScore: 0,
                efficiencyScore: 0,
                finalScore: 0
            };
        } finally {
            // 6. Restore
            this.restoreOriginal();
        }
    }

    private runTests(metricsPath: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Locate our custom environment
            // Jest needs a JS file for the environment, even if using ts-jest, 
            // unless we jump through hoops. We rely on the build output.
            const envPath = path.resolve(process.cwd(), 'dist/core/jest/AlphaEnvironment.js');

            if (!fs.existsSync(envPath)) {
                Logger.warn(`AlphaEnvironment not found at ${envPath}. Metrics will not be collected.`);
            }

            console.log(`Using Jest Environment: ${envPath}`);

            const allArgs = [
                ...(this.options.testArgs || []),
                this.options.testFilePath,
                '--env', envPath
            ];

            const child = spawn(this.options.testCommand!, allArgs, {
                env: {
                    ...process.env,
                    CI: 'true',
                    ALPHA_METRICS_PATH: metricsPath
                },
                stdio: 'inherit'
            });

            child.on('close', (code: number) => {
                resolve(code === 0);
            });

            child.on('error', (err: Error) => {
                Logger.error('Failed to start test process', err);
                resolve(false);
            });
        });
    }
}
