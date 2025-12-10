import { AlphaRevolve } from '../src/AlphaRevolve';
import { EvolutionConfig } from '../src/types';
import { safeEval } from '../src/safeEval';
import * as process from 'process';

/**
 * Entry point for the Evolver CLI application.
 * Reads configuration from environment variables and launches the evolutionary optimizer.
 */
async function main(): Promise<void> {
  // Validate required environment variables.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    process.exit(1);
  }
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!baseUrl) {
    console.error('Error: OPENAI_BASE_URL environment variable is required.');
    process.exit(1);
  }

  // Define initial solution: a basic bubble sort implementation.
  const initialSolution = `
  // Naive bubble sort implementation
  function sort(arr) {
    // EVOLVE-BLOCK-START
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - 1; j++) {
        if (arr[j] > arr[j + 1]) {
          const temp = arr[j];
          arr[j] = arr[j + 1];
          arr[j + 1] = temp;
        }
      }
    }
    return arr;
    // EVOLVE-BLOCK-END
  }
  `;

  /**
   * Evaluation function for candidate solutions.
   * It executes the sort function with various test cases to compute fitness scores.
   */
  const evaluationFunction = async (solution: string): Promise<{
    qualityScore: number;
    efficiencyScore: number;
    finalScore: number;
    performanceMetrics?: any;
  }> => {
    type TestCase = { input: number[]; expected?: number[] };
    const testCases: TestCase[] = [
      { input: Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)) },
      { input: Array.from({ length: 25 }, () => Math.floor(Math.random() * 25)) },
      { input: Array.from({ length: 100 }, () => Math.floor(Math.random() * 100)) },
      { input: Array.from({ length: 1000 }, () => Math.floor(Math.random() * 1000)) },
      { input: Array.from({ length: 5000 }, () => Math.floor(Math.random() * 5000)) },
      { input: Array.from({ length: 10000 }, () => Math.floor(Math.random() * 10000)) },
      { input: Array.from({ length: 20000 }, () => Math.floor(Math.random() * 20000)) }
    ];

    // Add nearly sorted test cases.
    const nearlySorted1 = [1, 2, 3, 5, 4, 6, 7, 8, 10, 9];
    testCases.push({ input: nearlySorted1 });
    const nearlySorted2 = Array.from({ length: 100 }, (_, i) => i);
    [nearlySorted2[10], nearlySorted2[50]] = [nearlySorted2[50], nearlySorted2[10]];
    [nearlySorted2[30], nearlySorted2[70]] = [nearlySorted2[70], nearlySorted2[30]];
    [nearlySorted2[20], nearlySorted2[90]] = [nearlySorted2[90], nearlySorted2[20]];
    testCases.push({ input: nearlySorted2 });
    const nearlySorted3 = Array.from({ length: 1000 }, (_, i) => i);
    for (let i = 0; i < 50; i++) {
      const pos = Math.floor(Math.random() * 990);
      [nearlySorted3[pos], nearlySorted3[pos + 10]] = [nearlySorted3[pos + 10], nearlySorted3[pos]];
    }
    testCases.push({ input: nearlySorted3 });

    // Add reverse sorted test cases.
    const reverseSorted = Array.from({ length: 1000 }, (_, i) => 999 - i);
    testCases.push({ input: reverseSorted });
    const reverseSorted2 = Array.from({ length: 10000 }, (_, i) => 9999 - i);
    testCases.push({ input: reverseSorted2 });

    testCases.forEach(tc => {
      tc.expected = [...tc.input].sort((a, b) => a - b);
    });

    const { performance } = require('perf_hooks');
    let qualityScore = 0;
    let totalExecutionTime = 0;
    let aggregatePerformanceMetrics = null;
    const trials = 5;

    for (let i = 0; i < trials && totalExecutionTime < 10000; i++) {
      // Use the most complex test case for detailed performance metrics to avoid noise from small inputs
      const complexTestCase = testCases[testCases.length - 1];
      let detailedMetrics = null;

      for (const { input, expected } of testCases) {
        try {
          // Get both result and performance metrics
          const { result, executionTime, performanceMetrics } = await safeEval(solution, input, 3000, "sort");
          totalExecutionTime += executionTime;

          // Save detailed metrics from the most complex test case
          if (input === complexTestCase.input && !detailedMetrics) {
            detailedMetrics = performanceMetrics;
          }

          if (JSON.stringify(result) === JSON.stringify(expected)) {
            qualityScore += 1;
          }
        } catch (e: any) {
          console.error(`Evaluation error: ${e.message}`);
          totalExecutionTime += 3000;
        }
      }

      // Store detailed metrics from the most representative run
      if (detailedMetrics && !aggregatePerformanceMetrics) {
        aggregatePerformanceMetrics = detailedMetrics;
      }
    }

    const totalItems = testCases.reduce((a, x) => x.input.length + a, 0);
    const averageExecutionTime = totalExecutionTime / (testCases.length * trials);
    console.log('example1: averageExecutionTime=' + averageExecutionTime);
    const efficiencyScore = Math.max(0, 1 - averageExecutionTime / 5); // 5ms baseline execution time per testcase
    const normalizedQuality = qualityScore / (testCases.length * trials);
    const finalScore = qualityScore > 0 ? 0.7 * normalizedQuality + 0.3 * efficiencyScore : 0;

    return {
      qualityScore: normalizedQuality,
      efficiencyScore,
      finalScore,
      performanceMetrics: aggregatePerformanceMetrics
    };
  };

  const config: EvolutionConfig = {
    initialSolution,
    fitnessFunction: evaluationFunction,
    problemDescription: 'Optimize the sort function for maximum performance.',
    iterations: 10,
    llmModel: 'gemma3:12b-it-q8_0',
    /**
     * Optional system prompt for code generation LLM (not set here, uses default).
     * Optional feedbackSystemPrompt for feedback LLM.
     */
    feedbackSystemPrompt: 'You are an expert algorithm reviewer. Focus on analyzing sorting algorithm efficiency, correctness, and suggest concrete improvements. Be concise and actionable.',
    promptTemplate: `
 # Problem Description:
 {PROBLEM_DESCRIPTION}

# Current Solution:
\`\`\`javascript
{CURRENT_SOLUTION}
\`\`\`

# Performance Information:
{PERFORMANCE_INFO}

## Metrics:
- Quality Score: Higher is better.
- Efficiency Score: Higher is better.

{PREVIOUS_FEEDBACK}

Task: Propose an optimized version of the sort function. The goal is to find new better algorithms.
Do not use the built-in sort function, that's cheating. Do not add parameters to the function.
Include your reasoning as a comment above the function.
Respond exclusively with the new sort function.
    `,
    temperature: 0.8,
    maxTokens: 4096,
    feedbackEnabled: true,
    // feedbackLlmModel: 'phi4-reasoning:latest',
    databaseOptions: {
      saveEnabled: true,
      saveFrequency: 'iteration'
    },
    feedbackPromptTemplate: `
You are an expert algorithm analyst reviewing code.

## Code Implementation:
{CODE}

## Performance Metrics:
- Quality Score: {QUALITY_SCORE}
- Efficiency Score: {EFFICIENCY_SCORE}
- Final Score: {FINAL_SCORE}

{PARENT_COMPARISON}

Task: Provide detailed, concise and actionable feedback on this sorting implementation.
Focus on computational complexity and optimization opportunities, and suggest new angles of approach.
Comments are not the focus. Algorithmic efficiency is the primary goal.`,
    feedbackTemperature: 0.7,
    feedbackMaxTokens: 2048
  };

  try {
    // Explicitly enable verbose mode and saveResults
    const options = {
      verbose: true,
      saveResults: true,
      maxRetries: 3
    };

    console.log('Starting AlphaRevolve with options:', options);
    const evolver = new AlphaRevolve(config, baseUrl, apiKey, options);
    const result = await evolver.run();

    console.log('\n=== Evolver Results ===');
    console.log('Best Candidate Solution:');
    console.log(result.bestCandidate.solution);
    console.log('Fitness:', result.bestCandidate.fitness);
    console.log('Runtime (ms):', result.runtime);

    // Print database save location
    console.log(`Database saved to: ${evolver.getDatabasePath()}`);
  } catch (err) {
    console.error('Error running Evolver:', err);
    process.exit(1);
  }
}

main();
