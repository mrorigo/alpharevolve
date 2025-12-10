import { AlphaRevolve } from '../src/AlphaRevolve';
import { EvolutionConfig } from '../src/types';
import { safeEval } from '../src/safeEval';
import * as process from 'process';

/**
 * example2.ts demonstrates using the Evolver framework to optimize a candidate implementation
 * of the Prime Sieve algorithm. In this example, the candidate solution is expected to implement
 * a function named "primeSieve" that, given an integer n, returns an array of all prime numbers ≤ n.
 *
 * The fitness function measures:
 *   - Correctness: By comparing the candidate's output with a trusted implementation.
 *   - Efficiency: By measuring the execution time.
 *
 * The final fitness score is a weighted combination of normalized correctness and efficiency.
 */

/**
 * Trusted implementation of the Sieve of Eratosthenes.
 * @param n Upper bound (inclusive).
 * @returns Array of prime numbers ≤ n.
 */
function trustedPrimeSieve(n: number): number[] {
  const sieve = Array(n + 1).fill(true);
  sieve[0] = sieve[1] = false;
  for (let i = 2; i * i <= n; i++) {
    if (sieve[i]) {
      for (let j = i * i; j <= n; j += i) {
        sieve[j] = false;
      }
    }
  }
  const primes: number[] = [];
  for (let i = 2; i <= n; i++) {
    if (sieve[i]) {
      primes.push(i);
    }
  }
  return primes;
}

/**
 * Fitness function for a candidate prime sieve implementation.
 * It evaluates the candidate by running it against several test cases.
 *
 * @param solution The candidate solution code as a string.
 *   The candidate must define a function "primeSieve" that accepts an integer and returns an array of numbers.
 * @returns An object with fitness metrics: qualityScore, efficiencyScore, and finalScore.
 */
const fitnessFunction = async (solution: string): Promise<{
  qualityScore: number;
  efficiencyScore: number;
  finalScore: number;
  performanceMetrics?: any;
}> => {
  type TestCase = { n: number; expected: number[] };
  // Define a series of test cases with increasing input sizes.
  const testCases: TestCase[] = [
    { n: 50, expected: trustedPrimeSieve(50) },
    { n: 100, expected: trustedPrimeSieve(100) },
    { n: 500, expected: trustedPrimeSieve(500) },
    { n: 1000, expected: trustedPrimeSieve(1000) },
    { n: 5000, expected: trustedPrimeSieve(5000) },
  ];

  let correctCount = 0;
  let totalTime = 0;
  let bestPerformanceMetrics = null;
  const trials = 30;

  for (let t = 0; t < trials; t++) {
    // Use the largest test case for detailed performance metrics
    const largestTestCase = testCases[testCases.length - 1];

    for (const testCase of testCases) {
      try {
        // Evaluate the candidate solution in a worker thread.
        // The candidate solution must define a function "primeSieve".
        const { result, executionTime, performanceMetrics } = await safeEval(solution, testCase.n, 3000, "primeSieve");
        totalTime += executionTime;

        // Capture performance metrics from the largest test case on the first trial
        // This provides the most representative metrics for complex inputs
        if (testCase.n === largestTestCase.n && t === 0) {
          bestPerformanceMetrics = performanceMetrics;
        }

        // Check correctness by comparing arrays.
        const candidateOutput: number[] = result;
        const expectedOutput = testCase.expected;
        if (JSON.stringify(candidateOutput) === JSON.stringify(expectedOutput)) {
          correctCount += 1;
        }
      } catch (error: any) {
        console.error(`Test case n=${testCase.n} failed: ${error.message}`);
        totalTime += 3000;
      }
    }
  }
  const totalCases = testCases.length * trials;
  const qualityScore = correctCount / totalCases; // value between 0 and 1
  const averageTime = totalTime / totalCases; // in milliseconds
  // Assume a baseline of 10ms; lower execution time is better.
  const efficiencyScore = Math.max(0, 1 - averageTime / 10 * trials);
  const finalScore = 0.7 * qualityScore + 0.3 * efficiencyScore;

  return {
    qualityScore,
    efficiencyScore,
    finalScore,
    performanceMetrics: bestPerformanceMetrics
  };
};

const initialSolution = `
// Naive prime sieve implementation
function primeSieve(n) {
  const sieve = Array(n + 1).fill(true);
  sieve[0] = sieve[1] = false;
  for (let i = 2; i <= n; i++) {
    if (sieve[i]) {
      for (let j = i * 2; j <= n; j += i) {
        sieve[j] = false;
      }
    }
  }
  const primes = [];
  for (let i = 2; i <= n; i++) {
    if (sieve[i]) {
      primes.push(i);
    }
  }
  return primes;
}
`;

const config: EvolutionConfig = {
  initialSolution,
  fitnessFunction,
  problemDescription: 'Optimize the primeSieve function for generating prime numbers up to n with high correctness and efficiency.',
  iterations: 10,
  llmModel: 'gemma3:12b-it-q8_0',
  /**
   * Optional system prompt for code generation LLM (not set here, uses default).
   * Optional feedbackSystemPrompt for feedback LLM.
   */
  feedbackSystemPrompt: 'You are an expert reviewer of prime number algorithms. Focus on correctness, computational complexity, and practical optimization opportunities. Provide actionable, concise feedback.',
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

Task: Propose an optimized version of the primeSieve function.
Include your reasoning as a comment above the function.
Respond exclusively with the updated primeSieve function.
  `,
  temperature: 0.9,
  maxTokens: 4096,
  feedbackEnabled: true,
  feedbackLlmModel: 'phi4-reasoning:latest',
  databaseOptions: {
    saveEnabled: true,
    saveFrequency: 'iteration'
  },
  feedbackPromptTemplate: `
You are an expert algorithm analyst reviewing candidate solution implementations.

## Candidate Implementation:
{CODE}

## Metrics:
- Quality Score: {QUALITY_SCORE}
- Efficiency Score: {EFFICIENCY_SCORE}
- Final Score: {FINAL_SCORE}

{PARENT_COMPARISON}

{PERFORMANCE_DETAILS}

Task: Provide detailed, actionable feedback on this primeSieve implementation.
Focus on correctness, execution speed, and algorithmic improvements.
  `,
  feedbackTemperature: 0.7,
  feedbackMaxTokens: 2048
};

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

  try {
    const evolver = new AlphaRevolve(config, baseUrl, apiKey);
    const result = await evolver.run();
    console.log('\n=== Evolver Results ===');
    console.log('Best Candidate Solution:');
    console.log(result.bestCandidate.solution);
    console.log('Fitness:', result.bestCandidate.fitness);
    console.log('Runtime (ms):', result.runtime);
  } catch (err) {
    console.error('Error running Evolver:', err);
    process.exit(1);
  }
}

main();
