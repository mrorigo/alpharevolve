import { performance } from 'perf_hooks';
import { sort } from './absurd2_sort_target';

/**
 * ABSURDITY CAMPAIGN benchmark workload.
 *
 * Heavier and nastier than the legacy sort_benchmark_command.ts:
 *   • 50,000 elements (legacy: 2,500)
 *   • One deterministic mixed-pattern input per sample:
 *       - 40% seeded pseudo-random values
 *       - 20% duplicate-heavy values (25 distinct keys)
 *       - 20% strictly reversed run
 *       - 20% sawtooth pattern
 *
 * Protocol (unchanged): print exactly one JSON object on stdout with the
 * configured warmupRuns and exactly sampleRuns numbers in samplesMs.
 * Diagnostics must go to stderr.
 */

const warmupRuns = Number(process.env.ALPHA_BENCHMARK_WARMUP_RUNS);
const sampleRuns = Number(process.env.ALPHA_BENCHMARK_SAMPLE_RUNS);
if (!Number.isInteger(warmupRuns) || warmupRuns < 0 || !Number.isInteger(sampleRuns) || sampleRuns < 1) {
  throw new Error('Benchmark run counts must be provided by AlphaRevolve');
}

const N = 50000;
/** Segment generators: seeded pseudo-random, duplicate-heavy, reversed run, sawtooth. */
const SEGMENTS: Array<((index: number, random: () => number) => number)> = [
  (_index, random) => random() % 100000,
  (_index, random) => random() % 25,
  (index) => N - index,
  (index) => (index * 57721) % 4993,
];

function buildInput(): number[] {
  const input = new Array<number>(N);
  // Deterministic LCG so every sample sorts the exact same input.
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed;
  };
  // NOTE: cumulative bounds (not per-segment fractions) so every index is
  // assigned exactly once — holes would silently break sort/oracle parity.
  const bounds = [0.4, 0.6, 0.8, 1].map(f => Math.floor(N * f));
  let lower = 0;
  SEGMENTS.forEach((generator, segmentIndex) => {
    const upper = bounds[segmentIndex];
    for (let index = lower; index < upper; index++) {
      input[index] = generator(index, random);
    }
    lower = upper;
  });
  return input;
}

const input = buildInput();

function measureSort(): number {
  const values = [...input];
  const startedAt = performance.now();
  sort(values);
  return performance.now() - startedAt;
}

// Sanity checks: input must be hole-free and finite, and the seeded sort must
// actually agree with the oracle on this workload.
if (input.length !== N || Object.keys(input).length !== N || input.some(Number.isNaN) || !input.every(Number.isFinite)) {
  process.stderr.write('Benchmark self-check FAILED: input contains holes or non-finite values\n');
  process.exit(1);
}
const check = [...input];
const oracle = [...input].sort((a, b) => a - b);
if (JSON.stringify(sort(check)) !== JSON.stringify(oracle)) {
  process.stderr.write('Benchmark self-check FAILED: sort output differs from oracle\n');
  process.exit(1);
}

for (let index = 0; index < warmupRuns; index++) measureSort();
const samplesMs = Array.from({ length: sampleRuns }, measureSort);
console.log(JSON.stringify({ warmupRuns, samplesMs }));
