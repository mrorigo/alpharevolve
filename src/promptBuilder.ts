import { EvolutionConfig } from './types';
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
   * @returns The constructed prompt string.
   */
  static buildPrompt(config: EvolutionConfig, evaluationDatabase: ProgramDatabase): string {
    const parentCandidate = evaluationDatabase.sampleProgram();

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
  private static formatPromptTemplate(
    template: string,
    values: { [key: string]: string }
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return result;
  }
}
