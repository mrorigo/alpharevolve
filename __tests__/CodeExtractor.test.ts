import { CodeExtractor } from '../src/core/CodeExtractor';

describe('CodeExtractor', () => {
  it('should extract code from markdown block', () => {
    const input = "Here is code:\n```javascript\nfunction foo() { return 1; }\n```";
    const code = CodeExtractor.extractSolution(input);
    expect(code).toContain('function foo');
  });

  it('should extract code from xml-like code tag', () => {
    const input = "<code>function bar() { return 2; }</code>";
    const code = CodeExtractor.extractSolution(input);
    expect(code).toContain('function bar');
  });

  it('should remove <think> sections', () => {
    const input = "<think>ignore this</think>\n```js\nfunction baz() { return 3; }\n```";
    const code = CodeExtractor.extractSolution(input);
    expect(code).toContain('function baz');
    expect(code).not.toContain('think');
  });

  it('should detect code presence', () => {
    expect(CodeExtractor.hasCode('function x() {}')).toBe(true);
    expect(CodeExtractor.hasCode('no code here')).toBe(false);
  });
});