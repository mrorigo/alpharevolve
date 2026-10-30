import { performance } from 'perf_hooks';
import { sort } from './sort_target';

const warmupRuns = Number(process.env.ALPHA_BENCHMARK_WARMUP_RUNS);
const sampleRuns = Number(process.env.ALPHA_BENCHMARK_SAMPLE_RUNS);
if (!Number.isInteger(warmupRuns) || warmupRuns < 0 || !Number.isInteger(sampleRuns) || sampleRuns < 1) {
  throw new Error('Benchmark run counts must be provided by AlphaRevolve');
}

const input = Array.from({ length: 2500 }, (_, index) => (index * 1543) % 2500);
function measureSort(): number {
  const values = [...input];
  const startedAt = performance.now();
  sort(values);
  return performance.now() - startedAt;
}

for (let index = 0; index < warmupRuns; index++) measureSort();
const samplesMs = Array.from({ length: sampleRuns }, measureSort);
console.log(JSON.stringify({ warmupRuns, samplesMs }));
