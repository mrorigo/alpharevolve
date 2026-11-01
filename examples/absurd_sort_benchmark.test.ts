import { sort } from './absurd_sort_target';

/**
 * ABSURDITY CAMPAIGN correctness suite — tightened relative to the legacy
 * sort_benchmark.test.ts. The evolved code must match a reference oracle on
 * adversarial orderings and duplicates, not just tiny hand-written cases.
 *
 * The oracle is allowed to use the built-in sort: the constraint that the
 * built-in sort is unavailable applies to the target implementation only.
 */
function oracle(values: number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}

function isPermutationOf(actual: number[], expected: number[]): boolean {
  if (actual.length !== expected.length) return false;
  const a = oracle(actual);
  const b = oracle(expected);
  return a.every((v, i) => v === b[i]);
}

describe('Absurd Sort', () => {
  it('should sort an empty array', () => {
    expect(sort([])).toEqual([]);
  });

  it('should sort a single element', () => {
    expect(sort([42])).toEqual([42]);
  });

  it('should sort two elements in either order', () => {
    expect(sort([2, 1])).toEqual([1, 2]);
    expect(sort([1, 2])).toEqual([1, 2]);
  });

  it('should sort a small random array', () => {
    const input = [5, 3, 8, 1, 2, 9, 4, 7, 6];
    expect(sort([...input])).toEqual(oracle(input));
  });

  it('should handle already sorted arrays', () => {
    const input = [1, 2, 3, 4, 5];
    expect(sort([...input])).toEqual(input);
  });

  it('should handle reverse sorted arrays', () => {
    const input = [5, 4, 3, 2, 1];
    expect(sort([...input])).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle all-equal arrays', () => {
    const input = new Array(1000).fill(7);
    expect(sort([...input])).toEqual(input);
  });

  it('should handle duplicate-heavy arrays', () => {
    const input = [3, 1, 2, 3, 1];
    expect(sort([...input])).toEqual([1, 1, 2, 3, 3]);
  });

  it('should sort negative numbers and floats', () => {
    const input = [-1.5, 0, -7, 3.25, -0.25, 2, -7.5];
    expect(sort([...input])).toEqual(oracle(input));
  });

  it('should sort adversarial sawtooth pattern', () => {
    const input: number[] = [];
    for (let i = 0; i < 5000; i++) input.push((i * 7919) % 100);
    expect(sort([...input])).toEqual(oracle(input));
  });

  it('should match the oracle on random arrays of many sizes', () => {
    for (const size of [3, 17, 100, 1000, 10000]) {
      const input = Array.from({ length: size }, () =>
        Math.floor(Math.random() * size - size / 3)
      );
      const output = sort([...input]);
      expect(output).toEqual(oracle(input));
      expect(isPermutationOf(output, input)).toBe(true);
    }
  });

  // Performance stress (correctness only — speed is measured by the benchmark
  // command, but the suite must complete quickly, which is itself a check).
  it('should sort large arrays correctly and repeatedly fast', () => {
    for (let size = 100; size <= 25000; size *= 2) {
      const input = Array.from({ length: size }, () => Math.floor(Math.random() * size));
      const output = sort([...input]);
      const output2 = sort([...input]);
      const output3 = sort([...input]);

      const expected = oracle(input);
      expect(output).toEqual(expected);
      expect(output2).toEqual(expected);
      expect(output3).toEqual(expected);
    }
  }, 30000);
});
