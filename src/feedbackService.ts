import OpenAI from 'openai';

/**
 * FeedbackService generates detailed evaluation feedback on candidate solutions using LLMs.
 */
export class FeedbackService {
  private openai: OpenAI;
  private defaultTemplate = `
You are an expert code reviewer analyzing candidate solution performance, identifying potential optimizations, and suggesting improvements.

Candidate Implementation:
\`\`\`javascript
{CODE}
\`\`\`

Performance Metrics:
- Quality Score: {QUALITY_SCORE}
- Efficiency Score: {EFFICIENCY_SCORE}
- Final Score: {FINAL_SCORE}

{PARENT_COMPARISON}

{PERFORMANCE_DETAILS}

Task: Provide concise and actionable feedback focused on quality, efficiency, and potential optimizations.
Use the detailed performance metrics to identify specific bottlenecks or inefficiencies in the code.
Use markdown formatting.
`;

  /**
   * Constructs a new FeedbackService.
   * @param baseURL OpenAI API base URL.
   * @param apiKey OpenAI API key.
   */
  constructor(baseURL: string, apiKey: string) {
    this.openai = new OpenAI({
      baseURL,
      apiKey,
    });
  }

  /**
   * Generates feedback for the provided candidate solution.
   * @param code The candidate solution to review.
   * @param score Performance metrics (qualityScore, efficiencyScore, finalScore).
   * @param parentScore Optional parent candidate metrics.
   * @param performanceMetrics Detailed performance metrics from execution.
   * @param promptTemplate Optional custom prompt template.
   * @param model LLM model name.
   * @param temperature Temperature setting for generation.
   * @param maxTokens Maximum token count for response.
   * @returns A string containing the generated feedback.
   */
  async generateFeedback(
    code: string,
    score: { qualityScore: number; efficiencyScore: number; finalScore: number },
    parentScore?: { qualityScore: number; efficiencyScore: number; finalScore: number },
    performanceMetrics?: any,
    promptTemplate?: string,
    model: string = 'gpt-3.5-turbo',
    temperature: number = 0.7,
    maxTokens: number = 1024
  ): Promise<string> {
    try {
      let parentComparison = '';
      if (parentScore) {
        const finalScoreDiff = score.finalScore - parentScore.finalScore;
        const percentChange = (finalScoreDiff / parentScore.finalScore) * 100;
        parentComparison = `
Comparison with Parent:
- Quality Change: ${(score.qualityScore - parentScore.qualityScore).toFixed(4)}
- Efficiency Change: ${(score.efficiencyScore - parentScore.efficiencyScore).toFixed(4)}
- Final Score Change: ${finalScoreDiff.toFixed(4)} (${percentChange.toFixed(2)}%)
`;
      }
      const template = promptTemplate || this.defaultTemplate;

      // Format performance metrics if available
      let performanceDetails = '';
      if (performanceMetrics) {
        try {
          const heapUsedMB = (performanceMetrics.memoryUsage?.delta?.heapUsed / (1024 * 1024)).toFixed(2);
          const heapTotalMB = (performanceMetrics.memoryUsage?.delta?.heapTotal / (1024 * 1024)).toFixed(2);
          const rssMB = (performanceMetrics.memoryUsage?.delta?.rss / (1024 * 1024)).toFixed(2);
          const userCPUms = (performanceMetrics.cpuUsage?.user / 1000).toFixed(2);
          const systemCPUms = (performanceMetrics.cpuUsage?.system / 1000).toFixed(2);
          const gcTime = performanceMetrics.gcStats?.totalTime?.toFixed(2) || 'N/A';
          const executionTimeMs = performanceMetrics.executionTime?.toFixed(2) || 'N/A';

          performanceDetails = `
## Detailed Performance Metrics:
- Execution Time: ${executionTimeMs} ms
- Memory Usage:
  - Heap Used: ${heapUsedMB} MB Δ
  - Heap Total: ${heapTotalMB} MB Δ
  - RSS: ${rssMB} MB Δ
- CPU Usage:
  - User CPU time: ${userCPUms} ms
  - System CPU time: ${systemCPUms} ms
- Garbage Collection:
  - Count: ${performanceMetrics.gcStats?.count || 'N/A'}
  - Total Time: ${gcTime} ms
`;
        } catch (error) {
          console.error('Error formatting performance metrics:', error);
          performanceDetails = `
## Detailed Performance Metrics:
Error formatting metrics: ${error}
Raw metrics: ${JSON.stringify(performanceMetrics, null, 2)}
`;
        }
      }

      const prompt = template
        .replace('{CODE}', code)
        .replace('{QUALITY_SCORE}', score.qualityScore.toFixed(4))
        .replace('{EFFICIENCY_SCORE}', score.efficiencyScore.toFixed(4))
        .replace('{FINAL_SCORE}', score.finalScore.toFixed(4))
        .replace('{PARENT_COMPARISON}', parentComparison)
        .replace('{PERFORMANCE_DETAILS}', performanceDetails);
      const fullPrompt = prompt + "\nRespond exclusively with the evaluation.";
      console.log(`Feedback prompt:\n${fullPrompt}`);

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are an expert code reviewer specializing in candidate solution optimization.' },
          { role: 'user', content: fullPrompt }
        ],
        temperature,
        max_tokens: maxTokens
      } as any);
      let generatedText = response.choices[0]?.message?.content || 'No feedback generated.';
      generatedText = generatedText.replace(/<think>[\s\S]*?<\/think>/g, '');
      if (generatedText.trim().length < 3) {
        console.error(`Feedback too short: ${generatedText}`);
        throw new Error("Generated feedback too short!");
      }
      return generatedText;
    } catch (error) {
      console.error('Error generating feedback:', error);
      return `Error generating feedback: ${error}`;
    }
  }
}
