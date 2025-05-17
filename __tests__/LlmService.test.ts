jest.mock('openai', () => {
  return function () {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'Mocked LLM response' } }]
          })
        }
      }
    };
  };
});

import { LlmService } from '../src/LlmService';

describe('LlmService', () => {
  it('should generate code using the LLM', async () => {
    const service = new LlmService('mock', 'mock', { maxRetries: 1 });
    const code = await service.generateCode('Prompt', 'gpt-3.5-turbo', 0.7, 100);
    expect(code).toContain('Mocked LLM');
  });
});