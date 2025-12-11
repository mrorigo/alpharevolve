# Case Study: Optimizing Bubble Sort with AlphaRevolve

## Overview
This case study analyzes an optimization run where AlphaRevolve was tasked with optimizing a **Bubble Sort** implementation.
The challenge was constrained to **in-place sorting** without using the built-in `Array.prototype.sort()`.

**Run Configuration:**
- **Goal:** Optimize `sort_target.ts`
- **Constraint:** No `Array.prototype.sort`, must be in-place.
- **Workload:** Sorting arrays up to size 25,000, invoked multiple times per test.
- **Iterations:** 4
- **LLM:** openai/gpt-oss-20b

---

## The Journey

### 1. The Baseline (Bubble Sort)
The initial implementation was a standard O(n²) Bubble Sort.
- **Execution Time:** ~6036 ms
- **Efficiency Score:** 0.142
- **Memory Delta:** ~8MB Heap Used

### 2. The Failed Step (Iteration 1)
The LLM immediately proposed a **Quicksort** implementation to move from O(n²) to O(n log n).
However, the generated code (Iterative Quicksort with Insertion Sort fallback) failed the quality checks (`Quality Score: 0`), likely due to an implementation bug in the partitioning logic.
- **Result:** Rejected (Incorrect).

### 3. The Breakthrough (Iteration 2)
The LLM corrected the implementation in the next attempt.
It provided an **Iterative Quicksort** using an explicit object-based stack (`{ low, high }`) and an insertion sort fallback for small partitions.
- **Execution Time:** ~3322 ms (**45% Speedup**)
- **Efficiency Score:** 0.231
- **Status:** **Best Solution Found**

### 4. The Micro-Optimization Trap (Iterations 3 & 4)
Flush with success, the Feedback LLM suggested "low-level" JavaScript optimizations:
- Replacing the object stack with a single `Int32Array` to reduce GC pressure.
- Inlining `swap` functions to avoid call overhead.
- Using Hoare partitioning.

While theoretically sound, these optimizations **did not yield wall-clock improvements** in this specific environment:

| Iteration | Strategy | Execution Time | Notes |
| :--- | :--- | :--- | :--- |
| **0 (Base)** | Bubble Sort | 6036 ms | Baseline |
| **2 (Best)** | Quicksort (Object Stack) | **3322 ms** | **Winner** |
| **3** | Quicksort (Int32Array) | 3349 ms | Slightly slower (+0.8%) |
| **4** | Quicksort (Hoare + Typed) | 3595 ms | Slower (+8.2%) |

### 5. Key Takeaways

1.  **Algorithmic Wins are Dominant:** The shift from O(n²) to O(n log n) provided the massive 45% performance cut.
2.  **JS Engines are Smart:** The V8 engine (used in Node.js) is highly optimized for small object allocations. The overhead of manually managing `Int32Array` stacks and indices often outweighs the "GC savings" for short-lived processes, especially when the algorithm complexity is already good.
3.  **Feedback Loop:** The Feedback LLM correctly identified potential bottlenecks (GC pressure), but empirical testing proved that—for this specific test case—the simpler object-based code was faster.

## The Winning Code (Iteration 2)

```typescript
/**
 * In‑place quick‑sort with an insertion‑sort cutoff.
 * Works on any array of numbers and returns the sorted array.
 */
export function sort(arr: number[]): number[] {
  const n = arr.length;
  if (n < 2) return arr;

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
```
