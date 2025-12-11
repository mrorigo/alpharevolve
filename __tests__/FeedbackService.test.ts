jest.mock('openai', () => {
  return function () {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'Mocked feedback response' } }]
          })
        }
      }
    };
  };
});

import { FeedbackService } from '../src/core/feedbackService';

describe('FeedbackService', () => {
  it('should generate feedback using the LLM', async () => {
    const service = new FeedbackService('mock', 'mock');
    const feedback = await service.generateFeedback(
      'function foo() {}',
      { qualityScore: 1, efficiencyScore: 1, finalScore: 1 },
      { qualityScore: 0.5, efficiencyScore: 0.5, finalScore: 0.5 },
      {
        executionTime: 1,
        memoryUsage: {
          before: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1, arrayBuffers: 1 },
          after: { rss: 2, heapTotal: 2, heapUsed: 2, external: 2, arrayBuffers: 2 },
          delta: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1, arrayBuffers: 1 }
        },
        cpuUsage: { user: 1, system: 1 }
      },
      'Prompt',
      'gpt-3.5-turbo',
      0.7,
      1024
    );
    expect(feedback).toContain('Mocked feedback');
  });
});