
/**
 * Standard Bubble Sort implementation.
 * Sorts `arr` in-place (destructive)
 * NOTE: The built-in sort CAN NOT be used to optimize this implementation. It will not be available in the target environment.
 */
export function sort(arr: number[]): number[] {
    const n = arr.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n - 1; j++) {
            if (arr[j] > arr[j + 1]) {
                const temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
    return arr;
}
