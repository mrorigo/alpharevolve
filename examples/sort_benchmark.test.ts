
import { sort } from './sort_target';

describe('Sorting Algorithm', () => {
    it('should sort an empty array', () => {
        expect(sort([])).toEqual([]);
    });

    it('should sort an array of random numbers', () => {
        const input = [5, 3, 8, 1, 2, 9, 4, 7, 6];
        const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        expect(sort(input)).toEqual(expected);
    });

    it('should handle already sorted arrays', () => {
        const input = [1, 2, 3, 4, 5];
        expect(sort(input)).toEqual(input);
    });

    it('should handle reverse sorted arrays', () => {
        const input = [5, 4, 3, 2, 1];
        const expected = [1, 2, 3, 4, 5];
        expect(sort(input)).toEqual(expected);
    });

    it('should handle duplicates', () => {
        const input = [3, 1, 2, 3, 1];
        const expected = [1, 1, 2, 3, 3];
        expect(sort(input)).toEqual(expected);
    });

    // Performance benchmark (soft check)
    it('should sort a larger array reasonably fast', () => {
        for (let size = 100; size <= 25000; size *= 2) {
            const input = Array.from({ length: size }, () => Math.floor(Math.random() * size));
            const start = process.hrtime();
            const output = sort([...input]);
            const output2 = sort([...input]);
            const output3 = sort([...input]);
            const end = process.hrtime(start);
            const timeMs = (end[0] * 1000 + end[1] / 1e6);

            // Verification
            const expected = input.sort((a, b) => a - b);
            expect(output).toEqual(expected);
            expect(output2).toEqual(expected);
            expect(output3).toEqual(expected);

            console.log(`Execution time for size ${size}: ${timeMs.toFixed(2)}ms`);
        }
        // We don't fail here based on speed, but the evolver will pick it up via overall suite time
    });
});
