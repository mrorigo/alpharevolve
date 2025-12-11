import NodeEnvironment from 'jest-environment-node';
import { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import { PerformanceObserver } from 'perf_hooks';
import * as fs from 'fs';

export interface Metrics {
    executionTime: number;
    memoryUsage: {
        start: NodeJS.MemoryUsage;
        end: NodeJS.MemoryUsage;
        delta: {
            rss: number;
            heapTotal: number;
            heapUsed: number;
            external: number;
            arrayBuffers: number;
        }
    };
    gcStats: {
        count: number;
        totalTime: number;
    };
}

class AlphaEnvironment extends NodeEnvironment {
    private _gcCount: number;
    private _gcTotalTime: number;
    private _obs: PerformanceObserver;
    private _testMetrics: Record<string, Metrics> = {};
    private _currentTestStartMemory?: NodeJS.MemoryUsage;
    private _currentTestStartTime?: number;

    constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
        super(config as any, context);
        this._gcCount = 0;
        this._gcTotalTime = 0;

        // Set up PerformanceObserver for GC stats
        this._obs = new PerformanceObserver((list: any) => {
            const entries = list.getEntries();
            for (const entry of entries) {
                if (entry.entryType === 'gc') {
                    this._gcCount++;
                    this._gcTotalTime += entry.duration;
                }
            }
        });
        this._obs.observe({ entryTypes: ['gc'], buffered: true });
    }

    async setup() {
        await super.setup();
    }
    // Expose GC hook if not already exposed? 
    // jest usually runs with --expose-gc if we ask it to, but we can't force it from here easily.
    // However, performance hooks work regardless of exposure for monitoring.


    async teardown() {
        // Flush any pending observations
        this._flushObserver();
        this._obs.disconnect();

        // Write metrics to file if env var is present
        const metricsPath = process.env.ALPHA_METRICS_PATH;
        if (metricsPath) {
            fs.writeFileSync(metricsPath, JSON.stringify(this._testMetrics, null, 2));
        }

        await super.teardown();
    }

    private _flushObserver() {
        const entries = this._obs.takeRecords();
        for (const entry of entries) {
            if (entry.entryType === 'gc') {
                this._gcCount++;
                this._gcTotalTime += entry.duration;
            }
        }
    }

    async handleTestEvent(event: any, state: any) {
        if (event.name === 'test_start') {
            // Reset GC counters for this test? 
            // Actually, we probably want cumulative or per-test. 
            // Let's do per-test differential.
            // But _obs callback is async/detached. We'll just snapshot current cumulative values.

            // Flush before start to ensure clean slate? Or just snapshot.
            // Snapshotting cumulative is safer.
            this._flushObserver(); // Ensure we have latest counts

            // We'll track "test window" by snapshotting start values
            this._currentTestStartMemory = process.memoryUsage();
            this._currentTestStartTime = performance.now();

            // Store current GC totals to subtract later
            (this as any)._gcStartCount = this._gcCount;
            (this as any)._gcStartTime = this._gcTotalTime;

        } else if (event.name === 'test_done') {
            const endTime = performance.now();
            const endMemory = process.memoryUsage();

            this._flushObserver(); // Capture any GCs that happened during test

            const startMemory = this._currentTestStartMemory || endMemory;
            const startTime = this._currentTestStartTime || endTime;

            const gcStartCount = (this as any)._gcStartCount || 0;
            const gcStartTime = (this as any)._gcStartTime || 0;

            const memoryDelta = {
                rss: endMemory.rss - startMemory.rss,
                heapTotal: endMemory.heapTotal - startMemory.heapTotal,
                heapUsed: endMemory.heapUsed - startMemory.heapUsed,
                external: endMemory.external - startMemory.external,
                arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
            };

            this._testMetrics[event.test.name] = {
                executionTime: endTime - startTime,
                memoryUsage: {
                    start: startMemory,
                    end: endMemory,
                    delta: memoryDelta
                },
                gcStats: {
                    count: this._gcCount - gcStartCount,
                    totalTime: this._gcTotalTime - gcStartTime
                }
            };
        }
    }
}

module.exports = AlphaEnvironment;
