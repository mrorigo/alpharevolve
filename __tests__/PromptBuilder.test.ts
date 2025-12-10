import { PromptBuilder } from '../src/promptBuilder';
import { ProgramDatabase } from '../src/ProgramDatabase';

const config = {
  problemDescription: 'Test problem',
  initialSolution: 'function foo() {}',
  promptTemplate: 'Desc: {PROBLEM_DESCRIPTION}\nCode: {CURRENT_SOLUTION}\nPerf: {PERFORMANCE_INFO}\n{PREVIOUS_FEEDBACK}',
};

describe('PromptBuilder', () => {
  it('should build prompt with initial solution if no candidates', () => {
    const db = new ProgramDatabase();
    const prompt = PromptBuilder.buildPrompt(config as any, db);
    expect(prompt).toContain('Test problem');
    expect(prompt).toContain('function foo');
    expect(prompt).toContain('No performance data');
  });

  it('should build prompt with candidate solution and feedback', () => {
    const db = new ProgramDatabase();
    db.addProgram('function bar() {}', { qualityScore: 1, efficiencyScore: 1, finalScore: 1 }, 1, undefined, 'Nice!');
    const prompt = PromptBuilder.buildPrompt(config as any, db);
    expect(prompt).toContain('function bar');
    expect(prompt).toContain('Nice!');
  });
});