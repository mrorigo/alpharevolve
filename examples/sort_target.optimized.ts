/**
 * In‑place quick‑sort with an insertion‑sort cutoff.
 * Works on any array of numbers and returns the sorted array.
 *
 * The algorithm:
 *   • Uses an explicit stack to avoid recursion (no call‑stack overhead).
 *   • Chooses the middle element as pivot (median‑of‑three is overkill for
 *     typical test data and keeps the code simple).
 *   • Switches to insertion sort when the sub‑array size is ≤ 10.
 *
 * This gives an average time complexity of O(n log n) and a worst‑case of
 * O(n²) (which is still far better than the original bubble sort).
 */
export function sort(arr: number[]): number[] {
  const n = arr.length;
  if (n < 2) return arr;          // already sorted

  // Stack of sub‑array ranges to sort: { low, high }
  const stack: { low: number; high: number }[] = [];
  stack.push({ low: 0, high: n - 1 });

  while (stack.length) {
    const { low, high } = stack.pop()!;

    // Use insertion sort for tiny ranges
    if (high - low + 1 <= 10) {
      insertionSort(arr, low, high);
      continue;
    }

    const pivotIndex = partition(arr, low, high);

    // Push larger sub‑array first to keep stack depth minimal
    if (pivotIndex - 1 - low > high - (pivotIndex + 1)) {
      stack.push({ low: low, high: pivotIndex - 1 });
      stack.push({ low: pivotIndex + 1, high: high });
    } else {
      stack.push({ low: pivotIndex + 1, high: high });
      stack.push({ low: low, high: pivotIndex - 1 });
    }
  }

  return arr;
}

/**
 * Partition the sub‑array arr[low..high] around a pivot.
 * The pivot chosen is the middle element to avoid worst‑case on sorted data.
 */
function partition(arr: number[], low: number, high: number): number {
  const mid = low + ((high - low) >> 1);
  const pivot = arr[mid];

  // Move pivot to the end for classic Lomuto partition
  swap(arr, mid, high);

  let i = low - 1;
  for (let j = low; j < high; j++) {
    if (arr[j] <= pivot) {
      i++;
      swap(arr, i, j);
    }
  }

  // Place pivot in its final position
  swap(arr, i + 1, high);
  return i + 1;
}

/**
 * Simple insertion sort for a small range.
 */
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

/**
 * Swaps two elements in the array.
 */
function swap(arr: number[], i: number, j: number): void {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}