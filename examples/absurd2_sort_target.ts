/**
 * ABSURDITY CAMPAIGN II - seeded from the Absurdity Campaign I winner
 * ===================================================================
 * Provenance: run-2026-10-30T22-41-39-963Z-fe60ecf9, program mvvken3z-4c7a0f5a7de5
 * (iteration 4, final score 0.99785, benchmark median 3.595 ms vs 6.507 ms seed).
 * Evolved from the Legacy Run winner (run-2025-12-11_21-27-18) by beam:cloud.
 *
 * Inherited machinery: 3-way Dutch-national-flag partitioning, ninther pivot,
 * insertion-sort cutoff, smaller-side-first stack, introsort heap fallback.
 *
 * CAMPAIGN GOAL: push beyond this implementation under relative scoring
 * (baseline anchored at the Absurdity I winner median, parity = 0.5).
 */

/**
 * ABSURDITY CAMPAIGN — seeded from the Legacy Run winner
 * ======================================================
 * In-place iterative introsort with:
 *   • 3-way (Dutch national flag) partitioning for heavy duplicates
 *   • median-of-three pivot selection (ninther for large ranges)
 *   • tuned insertion-sort cutoff
 *   • explicit stack with smaller-side-first processing
 *   • introsort heap-sort fallback for adversarial inputs
 *   • overflow-safe index calculations for V8
 */

const INSERTION_CUTOFF = 24;

export function sort(arr: number[]): number[] {
  const n = arr.length;
  if (n < 2) return arr;

  const stack: number[] = [];
  let sp = 0;
  let low = 0;
  let high = n - 1;
  let depth = (Math.floor(Math.log2(n)) << 1) | 0;
  if (depth < 1) depth = 1;

  while (true) {
    const range = high - low;

    // Small ranges are finished with insertion sort.
    if (range <= INSERTION_CUTOFF) {
      insertionSort(arr, low, high);
      if (sp === 0) break;
      depth = stack[--sp];
      high = stack[--sp];
      low = stack[--sp];
      continue;
    }

    // Introsort fallback: guarantee O(n log n) on adversarial inputs.
    if (depth <= 0) {
      heapSort(arr, low, high);
      if (sp === 0) break;
      depth = stack[--sp];
      high = stack[--sp];
      low = stack[--sp];
      continue;
    }

    // Pivot selection: ninther for large ranges, median-of-three otherwise.
    if (range > 1024) {
      ninther(arr, low, high);
    } else {
      const mid = low + ((range) >>> 1);
      if (arr[mid] < arr[low]) {
        const t = arr[low]; arr[low] = arr[mid]; arr[mid] = t;
      }
      if (arr[high] < arr[mid]) {
        const t = arr[mid]; arr[mid] = arr[high]; arr[high] = t;
      }
      if (arr[mid] < arr[low]) {
        const t = arr[low]; arr[low] = arr[mid]; arr[mid] = t;
      }
      // Move the median pivot to arr[low].
      const t = arr[low]; arr[low] = arr[mid]; arr[mid] = t;
    }

    const pivot = arr[low];
    depth--;

    // 3-way partition: [low, lt-1] < pivot, [lt, gt] == pivot, [gt+1, high] > pivot.
    let lt = low;
    let gt = high;
    let i = low + 1;
    while (i <= gt) {
      const x = arr[i];
      if (x < pivot) {
        const tmp = arr[lt];
        arr[lt] = x;
        arr[i] = tmp;
        lt++;
        i++;
      } else if (x > pivot) {
        const tmp = arr[gt];
        arr[gt] = x;
        arr[i] = tmp;
        gt--;
      } else {
        i++;
      }
    }

    const leftSize = lt - low;
    const rightSize = high - gt;

    // Process the smaller side immediately and defer the larger side.
    if (leftSize > 0 && rightSize > 0) {
      if (leftSize < rightSize) {
        stack[sp++] = gt + 1;
        stack[sp++] = high;
        stack[sp++] = depth;
        high = lt - 1;
      } else {
        stack[sp++] = low;
        stack[sp++] = lt - 1;
        stack[sp++] = depth;
        low = gt + 1;
      }
    } else if (leftSize > 0) {
      high = lt - 1;
    } else if (rightSize > 0) {
      low = gt + 1;
    } else {
      if (sp === 0) break;
      depth = stack[--sp];
      high = stack[--sp];
      low = stack[--sp];
    }
  }

  return arr;
}

function insertionSort(arr: number[], low: number, high: number): void {
  for (let i = low + 1; i <= high; i++) {
    const key = arr[i];
    let j = i - 1;
    while (j >= low && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = key;
  }
}

function sort3(arr: number[], a: number, b: number, c: number): void {
  if (arr[a] > arr[b]) {
    const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
  }
  if (arr[b] > arr[c]) {
    const t = arr[b]; arr[b] = arr[c]; arr[c] = t;
    if (arr[a] > arr[b]) {
      const u = arr[a]; arr[a] = arr[b]; arr[b] = u;
    }
  }
}

function ninther(arr: number[], low: number, high: number): void {
  const t = (high - low) >>> 3;
  sort3(arr, low, low + t, low + (t << 1));
  sort3(arr, low + 3 * t, low + 4 * t, low + 5 * t);
  sort3(arr, low + 6 * t, low + 7 * t, high);
  sort3(arr, low + t, low + 4 * t, low + 7 * t);

  const m = low + 4 * t;
  const tmp = arr[low];
  arr[low] = arr[m];
  arr[m] = tmp;
}

function heapSort(arr: number[], low: number, high: number): void {
  const size = high - low + 1;
  for (let i = (size >> 1) - 1; i >= 0; i--) {
    siftDown(arr, low, i, size);
  }
  for (let i = size - 1; i > 0; i--) {
    const tmp = arr[low];
    arr[low] = arr[low + i];
    arr[low + i] = tmp;
    siftDown(arr, low, 0, i);
  }
}

function siftDown(arr: number[], low: number, start: number, size: number): void {
  let root = start;
  while (true) {
    let child = (root << 1) + 1;
    if (child >= size) break;
    if (child + 1 < size && arr[low + child] < arr[low + child + 1]) {
      child++;
    }
    if (arr[low + root] < arr[low + child]) {
      const tmp = arr[low + root];
      arr[low + root] = arr[low + child];
      arr[low + child] = tmp;
      root = child;
    } else {
      break;
    }
  }
}
