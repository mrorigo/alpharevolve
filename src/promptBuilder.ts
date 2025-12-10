import { EvolutionConfig, FilterOptions } from './types';
import { ProgramDatabase } from './ProgramDatabase';

/**
 * PromptBuilder constructs LLM prompts from the evolution configuration and evaluation database.
 * It supports generic candidate solutions by using flexible placeholders.
 */
export class PromptBuilder {
  /**
   * Builds a prompt for the LLM using the current best candidate solution and previous feedback.
   * @param config The evolution configuration.
   * @param evaluationDatabase The evaluation database.
   * @param filterOptions Optional FilterOptions to restrict candidate selection.
   * @returns The constructed prompt string.
   */
  static buildPrompt(
    config: EvolutionConfig,
    evaluationDatabase: ProgramDatabase,
    filterOptions?: FilterOptions
  ): string {
    const parentCandidate = evaluationDatabase.sampleProgram(3, filterOptions);

    if (!parentCandidate) {
      // Use the initial solution if no candidate exists.
      return this.formatPromptTemplate(config.promptTemplate, {
        PROBLEM_DESCRIPTION: config.problemDescription,
        CURRENT_SOLUTION: config.initialSolution,
        PERFORMANCE_INFO: "This is the initial solution. No performance data available yet.",
        PREVIOUS_FEEDBACK: "",
      });
    }

    // Format performance information using the candidate's fitness metrics.
    let performanceInfo = `Current performance metrics (baseline = 1.0):
- Quality Score: ${parentCandidate.fitness.qualityScore.toFixed(3)}
- Efficiency Score: ${parentCandidate.fitness.efficiencyScore.toFixed(3)}
- Final Score: ${parentCandidate.fitness.finalScore.toFixed(3)}`;

    // Add detailed performance metrics if available
    if (parentCandidate.fitness.performanceMetrics) {
      try {
        const metrics = parentCandidate.fitness.performanceMetrics;
        const executionTimeMs = metrics.executionTime?.toFixed(2) || 'N/A';
        const heapUsedMB = (metrics.memoryUsage?.delta?.heapUsed / (1024 * 1024)).toFixed(2) || 'N/A';
        const gcTime = metrics.gcStats?.totalTime?.toFixed(2) || 'N/A';
        const gcCount = metrics.gcStats?.count || 'N/A';

        performanceInfo += `\n\nDetailed Performance Metrics:
- Execution Time: ${executionTimeMs} ms
- Heap Usage: ${heapUsedMB} MB
- GC Count: ${gcCount}
- GC Time: ${gcTime} ms`;
      } catch (error) {
        console.log('Error formatting performance metrics for prompt:', error);
      }
    }

    const previousFeedback = parentCandidate.feedback
      ? `Previous Feedback:\n${parentCandidate.feedback}\n\nConsider all previous feedback when proposing improvements.`
      : "";

    return this.formatPromptTemplate(config.promptTemplate, {
      PROBLEM_DESCRIPTION: config.problemDescription,
      CURRENT_SOLUTION: parentCandidate.solution,
      PERFORMANCE_INFO: performanceInfo,
      PREVIOUS_FEEDBACK: previousFeedback,
    });
  }

  /**
   * Replaces template placeholders with provided values.
   * @param template The prompt template string.
   * @param values An object mapping placeholders to substitutions.
   * @returns The formatted prompt string.
   */
  /**
   * Replaces template placeholders with provided values.
   * @param template The prompt template string.
   * @param values An object mapping placeholders to substitutions.
   * @returns The formatted prompt string.
   */
  public static formatPromptTemplate(
    template: string,
    values: { [key: string]: string }
  ): string {
    let result = template;

    // Replace each placeholder with its value
    for (const [key, value] of Object.entries(values)) {
      const placeholder = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(placeholder, value || '');
    }

    // Handle any remaining unmatched placeholders
    result = result.replace(/\{[A-Z_]+\}/g, '');

    return result;
  }

  /**
   * Creates a standardized system prompt to guide LLM behavior
   * @param config Evolution configuration with problem details
   * @returns A system prompt suitable for the LLM
   */
  public static buildSystemPrompt(config: EvolutionConfig): string {
    return `You are an expert algorithm designer and code optimizer specialized in ${config.problemDescription}.
 Your task is to evolve and improve the provided solution according to specific metrics:
 - Quality Score measures correctness and completeness
 - Efficiency Score measures performance and resource usage
 - Final Score combines both metrics, weighted for the specific problem

 Focus on making significant improvements with each iteration. Analyze the previous solution,
 identify bottlenecks, and apply appropriate optimizations. Consider all previous feedback.
 Your response should contain ONLY the complete improved solution, no explanations outside the code.`;
  }
}
