/**
 * Core data structures and configuration for Evolver.
 */

/**
 * Represents a candidate solution evolved during optimization.
 */
 export interface CandidateSolution {
   id: string;
   solution: string;
   fitness: {
     qualityScore: number;
     efficiencyScore: number;
     finalScore: number;
     performanceMetrics?: any;
     [key: string]: any;
   };
   iteration: number;
   parent?: string;
   timestamp: Date;
   feedback?: string;
 }

/**
 * Configuration settings for an evolutionary optimization run.
 */
export interface EvolutionConfig {
  /** The initial candidate solution to optimize (e.g., code, function, parameter set) */
  initialSolution: string;
  /**
   * A fitness function that evaluates a candidate solution.
   * Should return scores like qualityScore, efficiencyScore, and a combined finalScore,
   * along with optional performance metrics.
   */
  fitnessFunction: (solution: string) => Promise<{ 
    qualityScore: number; 
    efficiencyScore: number; 
    finalScore: number; 
    performanceMetrics?: any;
    [key: string]: any 
  }>;
  /** A human-readable description of the problem. */
  problemDescription: string;
  /** Number of iterations for the evolutionary optimization process. */
  iterations: number;
  /** LLM model name for candidate solution generation. */
  llmModel: string;
  /** Template for constructing optimization prompts. */
  promptTemplate: string;
  /** Optional LLM temperature for generation. */
  temperature?: number;
  /** Optional maximum tokens for generation. */
  maxTokens?: number;
  /** Enable or disable LLM feedback after each iteration. */
  feedbackEnabled?: boolean;
  /** LLM model for generating feedback. Defaults to the llmModel if not specified. */
  feedbackLlmModel?: string;
  /** Template for feedback generation. */
  feedbackPromptTemplate?: string;
  /** Temperature setting for feedback generation. */
  feedbackTemperature?: number;
  /** Maximum tokens allowed for feedback responses. */
  feedbackMaxTokens?: number;
  /** Options for persisting the evaluation database. */
  databaseOptions?: {
    saveEnabled?: boolean;
    savePath?: string;
    saveFrequency?: 'iteration' | 'end';
  };
}

/**
 * The result returned by running the Evolver.
 */
export interface EvolutionResult {
  bestCandidate: CandidateSolution;
  allCandidates: CandidateSolution[];
  runtime: number;
}