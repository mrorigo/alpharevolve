/**
 * Core data structures and configuration types for AlphaEvolve.
 */

import { PerformanceMetrics } from './safeEval';

/**
 * Fitness scores for candidate solutions
 */
export interface FitnessScores {
  /** Correctness/accuracy score (0.0-1.0) */
  qualityScore: number;
  /** Performance/resource usage score (0.0-1.0) */
  efficiencyScore: number;
  /** Combined/weighted overall score */
  finalScore: number;
  /** Detailed metrics from execution */
  performanceMetrics?: PerformanceMetrics;
  /** Any other domain-specific metrics */
  [key: string]: any;
}

/** A candidate that the evaluator ran successfully but rejected. */
export interface InvalidEvaluation {
  status: 'invalid';
  reason: string;
}

/** Explicit result form for evaluators; plain FitnessScores remain supported. */
export type EvaluationResult =
  | { status: 'valid'; fitness: FitnessScores }
  | InvalidEvaluation;

export type FitnessFunctionResult = FitnessScores | EvaluationResult;

/** Persisted evaluation status and the raw scores used to form the median. */
export interface CandidateEvaluation {
  status: 'valid' | 'invalid';
  reason?: string;
  runs: EvaluationResult[];
  /** Median absolute deviation of finalScore across valid runs. */
  finalScoreMad: number;
}

/**
 * Represents a candidate solution evolved during optimization.
 */
export interface CandidateSolution {
  /** Unique identifier */
  id: string;
  /** Actual solution content (code, configuration, etc.) */
  solution: string;
  /** Evaluation fitness metrics */
  fitness: FitnessScores;
  /** Missing on older database records; those records are treated as valid. */
  evaluation?: CandidateEvaluation;
  /** Evolution iteration number */
  iteration: number;
  /** ID of parent solution (undefined for initial solutions) */
  parent?: string;
  /** When this solution was created */
  timestamp: Date;
  /** Feedback from analysis (if enabled) */
  feedback?: string;
  /** Prompt used for generating the solution */
  generationPrompt?: string;
  /** Prompt used for generating feedback */
  feedbackPrompt?: string;
}

/**
 * Options for filtering candidate solutions
 */
export interface FilterOptions {
  minQualityScore?: number;
  minEfficiencyScore?: number;
  minFinalScore?: number;
  iterationRange?: [number, number];
  hasParent?: boolean;
  hasFeedback?: boolean;
}
/**
 * Database persistence options
 */
export interface DatabaseOptions {
  /** Whether to save the database to disk */
  saveEnabled?: boolean;
  /** Custom path to save the database */
  savePath?: string;
  /** How frequently to save: either per iteration or only at the end */
  saveFrequency?: 'iteration' | 'end';
}

/**
 * Runtime options for evolution execution
 */
export interface EvolutionOptions {
  /** Whether to log detailed progress */
  verbose: boolean;
  /** Whether to save results to disk */
  saveResults: boolean;
  /** Whether to run evaluations in parallel */
  runParallel: boolean;
  /** Number of retries for failed iterations */
  maxRetries: number;
  /** Whether to check syntax before evaluation */
  checkSyntaxBeforeEval: boolean;
  /** Custom run ID for tracking/persistence */
  runId?: string;
}

/**
 * Configuration settings for an evolutionary optimization run.
 */
export interface EvolutionConfig {
  /** The initial candidate solution to optimize (e.g., code, function, parameter set) */
  initialSolution: string;

  /**
   * Optional system prompt for LLM behavior customization during code generation.
   * This prompt is used as the system message for the code-generation LLM.
   */
  systemPrompt?: string;

  /**
   * Optional system prompt for LLM behavior customization during feedback generation.
   * This prompt is used as the system message for the feedback LLM.
   * If not set, a default feedback reviewer prompt will be used.
   */
  feedbackSystemPrompt?: string;

  /**
   * A fitness function that evaluates a candidate solution. It may return
   * finite scores directly (legacy form), an explicit valid result, or an
   * invalid result with a reason. Throw only when the evaluator itself failed.
   */
  fitnessFunction: (solution: string) => Promise<FitnessFunctionResult>;

  /** A human-readable description of the problem */
  problemDescription: string;

  /** Number of iterations for the evolutionary optimization process */
  iterations: number;

  /** Whether larger finalScore values are better. Defaults to true. */
  higherIsBetter?: boolean;

  /** Number of independent fitness evaluations per candidate. Defaults to 1. */
  evaluationRepeats?: number;

  /** Absolute improvement floor before replacing the current best candidate. */
  minImprovement?: number;

  /** Multiplier for the larger of incumbent/challenger score MADs. Defaults to 1. */
  noiseToleranceMultiplier?: number;

  /** Weights used by the built-in CLI benchmark scorer. */
  scoreWeights?: { quality: number; efficiency: number };

  /** LLM model name for candidate solution generation */
  llmModel: string;

  /** Template for constructing optimization prompts */
  promptTemplate: string;

  /** LLM temperature for generation (0.0-1.0) */
  temperature?: number;

  /** Maximum tokens for generation */
  maxTokens?: number;

  /** Enable or disable LLM feedback after each iteration */
  feedbackEnabled?: boolean;

  /** LLM model for generating feedback (defaults to llmModel if not specified) */
  feedbackLlmModel?: string;

  /** Template for feedback generation */
  feedbackPromptTemplate?: string;

  /** Temperature setting for feedback generation (0.0-1.0) */
  feedbackTemperature?: number;

  /** Maximum tokens allowed for feedback responses */
  feedbackMaxTokens?: number;

  /** Options for persisting the evaluation database */
  databaseOptions?: DatabaseOptions;
}

/**
 * The result returned by running the evolution process
 */
export interface EvolutionResult {
  /** The highest-scoring candidate solution */
  bestCandidate: CandidateSolution;

  /** All evaluated candidate solutions */
  allCandidates: CandidateSolution[];

  /** Total runtime in milliseconds */
  runtime: number;
}
