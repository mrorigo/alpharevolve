import { safeEval } from '../src/core/safeEval';

describe('safeEval', () => {
  it('should evaluate a simple function', async () => {
    const code = 'function foo(x) { return x + 1; }';
    const { result, executionTime, performanceMetrics } = await safeEval(code, 2, 1000, 'foo');
    expect(result).toBe(3);
    expect(typeof executionTime).toBe('number');
    expect(performanceMetrics).toBeDefined();
  });

  it('should timeout for long-running code', async () => {
    const code = 'function foo(x) { while(true){} }';
    await expect(safeEval(code, 1, 200, 'foo')).rejects.toThrow(/timed out/i);
  });

  it('should throw for code with errors', async () => {
    const code = 'function foo(x) { throw new Error("fail"); }';
    await expect(safeEval(code, 1, 1000, 'foo')).rejects.toThrow(/fail/);
  });
});