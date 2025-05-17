import OpenAI from 'openai';
import { PerformanceMetrics } from './safeEval';

/**
 * Interface for score metrics used throughout the system
 */
export interface ScoreMetrics {
  qualityScore: number;
  efficiencyScore: number;
  finalScore: number;
  [key: string]: any;
}

/**
 * FeedbackService generates detailed evaluation feedback on candidate solutions using LLMs.
 * It analyzes performance metrics, compares solutions, and provides actionable improvement suggestions.
 */
export class FeedbackService {
  private readonly openai: OpenAI;
  private readonly defaultTemplate = `
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
   * @param baseURL API base URL for the LLM provider
   * @param apiKey Authentication key for the LLM provider
   */
  constructor(baseURL: string, apiKey: string) {
    this.openai = new OpenAI({
      baseURL,
      apiKey,
    });
  }

  /**
   * Formats performance metrics into a human-readable string
   * @param metrics Performance metrics from code execution
   * @returns A formatted markdown string with metrics
   */
  private formatPerformanceMetrics(metrics: PerformanceMetrics): string {
    try {
      const heapUsedMB = (metrics.memoryUsage?.delta?.heapUsed / (1024 * 1024)).toFixed(2);
      const heapTotalMB = (metrics.memoryUsage?.delta?.heapTotal / (1024 * 1024)).toFixed(2);
      const rssMB = (metrics.memoryUsage?.delta?.rss / (1024 * 1024)).toFixed(2);
      const userCPUms = (metrics.cpuUsage?.user / 1000).toFixed(2);
      const systemCPUms = (metrics.cpuUsage?.system / 1000).toFixed(2);
      const gcTime = metrics.gcStats?.totalTime?.toFixed(2) || 'N/A';
      const executionTimeMs = metrics.executionTime?.toFixed(2) || 'N/A';

      return `
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
  - Count: ${metrics.gcStats?.count || 'N/A'}
  - Total Time: ${gcTime} ms
`;
    } catch (error) {
      console.error('Error formatting performance metrics:', error);
      return `
## Detailed Performance Metrics:
Error formatting metrics: ${error}
Raw metrics: ${JSON.stringify(metrics, null, 2)}
`;
    }
  }

  /**
   * Creates a comparison string between current and parent solution metrics
   * @param current Current solution scores
   * @param parent Parent solution scores
   * @returns A markdown-formatted comparison string
   */
  private createParentComparison(current: ScoreMetrics, parent: ScoreMetrics): string {
    const finalScoreDiff = current.finalScore - parent.finalScore;
    // Avoid division by zero
    const denominator = Math.abs(parent.finalScore) < 0.0001 ? 0.0001 : parent.finalScore;
    const percentChange = (finalScoreDiff / denominator) * 100;

    const qualityChange = current.qualityScore - parent.qualityScore;
    const qualityArrow = qualityChange > 0 ? '↑' : qualityChange < 0 ? '↓' : '→';

    const efficiencyChange = current.efficiencyScore - parent.efficiencyScore;
    const efficiencyArrow = efficiencyChange > 0 ? '↑' : efficiencyChange < 0 ? '↓' : '→';

    const finalScoreArrow = finalScoreDiff > 0 ? '↑' : finalScoreDiff < 0 ? '↓' : '→';

    return `
## Comparison with Parent Solution:
- Quality: ${parent.qualityScore.toFixed(4)} → ${current.qualityScore.toFixed(4)} ${qualityArrow} (${qualityChange.toFixed(4)})
- Efficiency: ${parent.efficiencyScore.toFixed(4)} → ${current.efficiencyScore.toFixed(4)} ${efficiencyArrow} (${efficiencyChange.toFixed(4)})
- Final Score: ${parent.finalScore.toFixed(4)} → ${current.finalScore.toFixed(4)} ${finalScoreArrow} (${finalScoreDiff.toFixed(4)}, ${percentChange.toFixed(2)}%)
`;
  }

  /**
   * Generates feedback for the provided candidate solution.
   * @param code The candidate solution code
   * @param score Current solution's performance metrics
   * @param parentScore Previous solution's performance metrics (optional)
   * @param performanceMetrics Detailed runtime metrics from execution
   * @param promptTemplate Optional custom prompt template
   * @param model LLM model identifier
   * @param temperature Creativity setting (0.0-1.0)
   * @param maxTokens Maximum response length
   * @returns Detailed feedback on the solution's performance and suggestions for improvement
   */
  async generateFeedback(
    code: string,
    score: ScoreMetrics,
    parentScore?: ScoreMetrics,
    performanceMetrics?: PerformanceMetrics,
    promptTemplate?: string,
    model: string = 'gpt-3.5-turbo',
    temperature: number = 0.7,
    maxTokens: number = 1024
  ): Promise<string> {
    try {
      const parentComparison = parentScore
        ? this.createParentComparison(score, parentScore)
        : '';

      const performanceDetails = performanceMetrics
        ? this.formatPerformanceMetrics(performanceMetrics)
        : '';

      const template = promptTemplate || this.defaultTemplate;

      // Safely replace template placeholders
      const prompt = template
        .replace(/\{CODE\}/g, code)
        .replace(/\{QUALITY_SCORE\}/g, score.qualityScore.toFixed(4))
        .replace(/\{EFFICIENCY_SCORE\}/g, score.efficiencyScore.toFixed(4))
        .replace(/\{FINAL_SCORE\}/g, score.finalScore.toFixed(4))
        .replace(/\{PARENT_COMPARISON\}/g, parentComparison)
        .replace(/\{PERFORMANCE_DETAILS\}/g, performanceDetails);

      const fullPrompt = prompt + "\nRespond exclusively with the evaluation.";

      // Log truncated prompt for debugging (avoid excessive console output)
      const truncatedPrompt = fullPrompt.length > 500
        ? `${fullPrompt.substring(0, 500)}... (truncated, total length: ${fullPrompt.length})`
        : fullPrompt;
      console.log(`Feedback prompt: ${truncatedPrompt}`);

      // Request feedback from the LLM
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert code reviewer specializing in algorithm optimization and performance analysis.'
          },
          { role: 'user', content: fullPrompt }
        ],
        temperature,
        max_tokens: maxTokens
      } as any);

      let generatedText = response.choices[0]?.message?.content || '';

      // Clean up the response
      generatedText = generatedText
        .replace(/<think>[\s\S]*?<\/think>/g, '')  // Remove thinking sections
        .trim();

      if (generatedText.length < 10) {
        console.error(`Feedback too short: "${generatedText}"`);
        throw new Error("Generated feedback is too short or empty");
      }

      return generatedText;
    } catch (error: any) {
      console.error('Error generating feedback:', error);

      // Return a graceful error message that won't break the evolution process
      return `**Feedback Generation Error**: The system encountered an issue while analyzing this solution. This does not affect the solution's evaluation scores. Details: ${error.message || 'Unknown error'}`;
    }
  }
}
