import {
  CandidateSolution,
  CandidateEvaluator,
  CandidateSnapshotEvaluator,
  EvaluationResult,
  EvolutionConfig,
  EvolutionOptions,
  EvolutionResult,
  FilterOptions,
  FitnessScores,
} from './types';
import { ProgramDatabase } from './ProgramDatabase';
import { LlmService } from './llmService';
import { PromptBuilder } from './promptBuilder';
import { CodeExtractor } from './CodeExtractor';
import { FeedbackService } from './feedbackService';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';
import chalk from 'chalk';
import { ConsoleDisplay } from './ConsoleDisplay';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function aggregateValues(values: any[]): any {
  const present = values.filter(value => value !== undefined && value !== null);
  if (present.length === 0) return undefined;
  if (present.every(value => typeof value === 'number' && Number.isFinite(value))) {
    return median(present);
  }
  if (present.every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    const keys = Array.from(new Set(present.flatMap(value => Object.keys(value))));
    return keys.reduce((result, key) => {
      result[key] = aggregateValues(present.map(value => value[key]));
      return result;
    }, {} as Record<string, any>);
  }
  return present[0];
}

function normalizeEvaluation(result: any): EvaluationResult {
  if (result && result.status === 'invalid') {
    if (typeof result.reason !== 'string' || result.reason.trim() === '') {
      throw new Error('Invalid evaluation results must include a non-empty reason');
    }
    return { status: 'invalid', reason: result.reason };
  }

  const fitness = result && result.status === 'valid' ? result.fitness : result;
  if (!fitness || typeof fitness !== 'object') {
    throw new Error('Fitness function must return scores or an explicit evaluation result');
  }
  for (const key of ['qualityScore', 'efficiencyScore', 'finalScore']) {
    if (typeof fitness[key] !== 'number' || !Number.isFinite(fitness[key])) {
      throw new Error(`Fitness function returned an invalid ${key}: ${String(fitness[key])}`);
    }
  }
  return { status: 'valid', fitness };
}

/**
 * AlphaRevolve orchestrates evolutionary optimization of candidate solutions using LLMs.
 * It intelligently evolves solutions through iterative feedback and fitness evaluation.
 */
export class AlphaRevolve {
  private readonly config: EvolutionConfig;
  private readonly evaluator: CandidateEvaluator | CandidateSnapshotEvaluator;
  private readonly llmService: LlmService;
  private readonly feedbackService: FeedbackService;
  private readonly evaluationDatabase: ProgramDatabase;
  private readonly options: EvolutionOptions;
  private readonly runId: string;
  private readonly display: ConsoleDisplay;

  /**
   * Creates a timestamp-based unique identifier
   * @returns Formatted timestamp string
   */
  private static generateRunId(): string {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace(/T/, '_')
      .slice(0, 19);
    return `run-${timestamp}`;
  }

  /**
   * Constructs a new AlphaEvolve instance with explicit dependencies.
   * @param config Evolution configuration with fitness function, model settings, etc.
   * @param baseUrl API base URL for the LLM service
   * @param apiKey API key for authentication with LLM provider
   * @param options Optional evolution settings overrides
   * @param evaluationDatabase Optional database instance for testing/custom storage
   * @param llmService Optional LLM service for testing/custom implementation
   * @param feedbackService Optional feedback service for testing/custom implementation
   */
  constructor(
    config: EvolutionConfig,
    baseUrl: string,
    apiKey: string,
    options: Partial<EvolutionOptions> = {},
    evaluationDatabase?: ProgramDatabase,
    llmService?: LlmService,
    feedbackService?: FeedbackService
  ) {
    if (Boolean(config.evaluator) === Boolean(config.fitnessFunction)) {
      throw new Error('Configure exactly one of evaluator or fitnessFunction');
    }
    this.evaluator = config.evaluator
      ? config.evaluator as CandidateEvaluator | CandidateSnapshotEvaluator
      : { evaluate: config.fitnessFunction! } as CandidateEvaluator;
    if ('candidateType' in this.evaluator && this.evaluator.candidateType === 'snapshot') {
      if (!config.initialFiles || !config.primaryFile || !Object.prototype.hasOwnProperty.call(config.initialFiles, config.primaryFile)) {
        throw new Error('Snapshot evaluators require initialFiles and a primaryFile in the snapshot');
      }
    }

    this.config = {
      ...config,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      feedbackEnabled: config.feedbackEnabled !== false,
      feedbackTemperature: config.feedbackTemperature ?? 0.5,
      feedbackMaxTokens: config.feedbackMaxTokens ?? 2048,
      higherIsBetter: config.higherIsBetter ?? true,
      evaluationRepeats: config.evaluationRepeats ?? 1,
      minImprovement: config.minImprovement ?? 0,
      noiseToleranceMultiplier: config.noiseToleranceMultiplier ?? 1,
    };

    if (!Number.isInteger(this.config.evaluationRepeats) || this.config.evaluationRepeats! < 1) {
      throw new Error('evaluationRepeats must be a positive integer');
    }
    for (const key of ['minImprovement', 'noiseToleranceMultiplier'] as const) {
      const value = this.config[key]!;
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${key} must be a finite non-negative number`);
      }
    }

    // Default options merged with user-provided options
    this.options = {
      verbose: options.verbose !== false,
      saveResults: options.saveResults !== false,
      runParallel: options.runParallel ?? false,
      maxRetries: options.maxRetries ?? 3,
      checkSyntaxBeforeEval: options.checkSyntaxBeforeEval !== false,
      ...options
    };

    this.runId = options.runId || AlphaRevolve.generateRunId();
    this.llmService = llmService || new LlmService(baseUrl, apiKey);
    this.feedbackService = feedbackService || new FeedbackService(baseUrl, apiKey);
    this.evaluationDatabase = evaluationDatabase || new ProgramDatabase();
    this.evaluationDatabase.configureSelection({
      higherIsBetter: this.config.higherIsBetter!,
      minImprovement: this.config.minImprovement!,
      noiseToleranceMultiplier: this.config.noiseToleranceMultiplier!,
    });

    if (this.options.saveResults && this.config.databaseOptions?.saveEnabled !== false) {
      const snapshotPath = this.getDatabasePath();
      this.evaluationDatabase.configureEventJournal(
        snapshotPath.replace(/\.json$/i, '.jsonl'),
        this.options.resume === true
      );
    }

    // Initialize database with metadata
    this.initializeDatabase();
    this.display = new ConsoleDisplay();
  }

  /**
   * Sets up the evaluation database with initial metadata
   */
  private initializeDatabase(): void {
    this.evaluationDatabase.setMetadata('problemDescription', this.config.problemDescription);
    this.evaluationDatabase.setMetadata('runId', this.runId);
    if (!this.evaluationDatabase.getMetadata('startTime')) {
      this.evaluationDatabase.setMetadata('startTime', new Date().toISOString());
    }
    this.evaluationDatabase.setMetadata('config', {
      iterations: this.config.iterations,
      llmModel: this.config.llmModel,
      scoreWeights: this.config.scoreWeights,
      higherIsBetter: this.config.higherIsBetter,
      evaluationRepeats: this.config.evaluationRepeats,
      minImprovement: this.config.minImprovement,
      noiseToleranceMultiplier: this.config.noiseToleranceMultiplier,
      feedbackEnabled: this.config.feedbackEnabled,
      feedbackLlmModel: this.config.feedbackLlmModel,
    });
    this.evaluationDatabase.setMetadata('options', this.options);
    for (const [key, value] of Object.entries(this.config.runMetadata || {})) {
      this.evaluationDatabase.setMetadata(key, value);
    }
    if (this.options.resume) {
      for (const key of ['runtime', 'endTime', 'error', 'errorTime']) this.evaluationDatabase.deleteMetadata(key);
      const previousResumeCount = Number(this.evaluationDatabase.getMetadata('resumeCount')) || 0;
      this.evaluationDatabase.setMetadata('resumeCount', previousResumeCount + 1);
    }
  }

  private async evaluateSolution(solution: string, files?: Record<string, string>): Promise<{
    fitness: FitnessScores;
    evaluation: NonNullable<CandidateSolution['evaluation']>;
  }> {
    const runs: EvaluationResult[] = [];
    for (let index = 0; index < this.config.evaluationRepeats!; index++) {
      let result;
      if ('candidateType' in this.evaluator && this.evaluator.candidateType === 'snapshot') {
        result = await this.evaluator.evaluate({ files: files ?? {}, primaryFile: this.config.primaryFile! });
      } else {
        result = await (this.evaluator as CandidateEvaluator).evaluate(solution);
      }
      runs.push(normalizeEvaluation(result));
    }

    const validRuns = runs.filter(
      (run): run is { status: 'valid'; fitness: FitnessScores } => run.status === 'valid'
    );
    const values = validRuns.map(run => run.fitness.finalScore);
    const centre = values.length ? median(values) : 0;
    const finalScoreMad = values.length
      ? median(values.map(value => Math.abs(value - centre)))
      : 0;
    const benchmarkScoreMads = validRuns
      .map(run => run.fitness.performanceMetrics?.benchmark?.finalScoreMad ?? 0);
    const measuredFinalScoreMad = benchmarkScoreMads.length ? median(benchmarkScoreMads) : 0;
    const invalidRun = runs.find((run): run is { status: 'invalid'; reason: string } => run.status === 'invalid');
    const fitness = validRuns.length
      ? aggregateValues(validRuns.map(run => run.fitness)) as FitnessScores
      : { qualityScore: 0, efficiencyScore: 0, finalScore: 0 };

    return {
      fitness,
      evaluation: {
        status: invalidRun ? 'invalid' : 'valid',
        reason: invalidRun?.reason,
        runs,
        finalScoreMad: Math.max(finalScoreMad, measuredFinalScoreMad),
      },
    };
  }

  /**
   * Returns the path for saving the evaluation database.
   * @returns File path string
   */
  /**
   * Returns the path for saving the evaluation database.
   * Made public to assist with diagnostics and verification.
   * @returns File path string
   */
  getDatabasePath(): string {
    const options = this.config.databaseOptions || {};
    if (options.savePath) return options.savePath;

    // Create runs directory if it doesn't exist - use absolute path
    const runsDir = path.resolve(process.cwd(), 'runs');

    // Log the directory path for debugging
    if (this.options.verbose) {
      Logger.info(`📂 Database directory: ${runsDir}`);
    }

    if (!fs.existsSync(runsDir)) {
      try {
        fs.mkdirSync(runsDir, { recursive: true });
        Logger.info(`📁 Created database directory: ${runsDir}`);
      } catch (error) {
        Logger.error(`❌ Failed to create directory ${runsDir}:`, error);
      }
    }

    return path.join(runsDir, `${this.runId}.json`);
  }

  /**
   * Saves the evaluation database to disk if enabled.
   * @param label Optional label for the save (e.g., iteration number)
   */
  private async saveDatabaseIfEnabled(label: string = ''): Promise<void> {
    const options = this.config.databaseOptions || {};

    // Log save status for debugging
    if (this.options.verbose) {
      Logger.info(`Save check - saveEnabled: ${options.saveEnabled !== false}, saveResults: ${this.options.saveResults}`);
    }

    if (options.saveEnabled !== false && this.options.saveResults) {
      try {
        const filePath = this.getDatabasePath();
        Logger.info(`📝 Attempting to save database to: ${filePath}${label ? ` (${label})` : ''}`);

        // Check if file already exists (for overwrite info)
        const fileExists = fs.existsSync(filePath);

        // Save database
        await this.evaluationDatabase.saveToFile(filePath);

        Logger.info(`💾 Database ${fileExists ? 'updated' : 'saved'} to ${filePath}${label ? ` (${label})` : ''}`);
      } catch (error) {
        // More detailed error logging
        Logger.error(`❌ Error saving database: ${error}`);
        if (error instanceof Error) {
          Logger.error(`Stack trace: ${error.stack}`);
        }

        // Try to check write permissions on directory
        try {
          const dir = path.dirname(this.getDatabasePath());
          const testFile = path.join(dir, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          Logger.info(`✅ Directory ${dir} is writable`);
        } catch (fsError) {
          Logger.error(`❌ Directory permission issue: ${fsError}`);
        }
      }
    } else if (this.options.verbose) {
      Logger.info(`⏭️ Database save skipped (saveEnabled: ${options.saveEnabled}, saveResults: ${this.options.saveResults})`);
    }
  }

  /**
   * Validates a candidate solution's syntax without executing it
   * @param solution Code to validate
   * @returns True if valid, false if invalid
   */
  private checkSyntax(solution: string, filename = 'temp.ts'): boolean {
    try {
      // Use TypeScript compiler API to check syntax
      // We import it dynamically to avoid hard dependency if possible, 
      // but since we are in a TS environment, it should be available.
      const ts = require('typescript');

      const sourceFile = ts.createSourceFile(
        filename,
        solution,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/i.test(filename) ? ts.ScriptKind.TSX
          : /\.(jsx|mjs|cjs)$/i.test(filename) ? ts.ScriptKind.JSX
            : /\.(js|mts|cts)$/i.test(filename) ? ts.ScriptKind.JS
              : ts.ScriptKind.TS
      );

      // Check for parse diagnostics
      const diagnostics = sourceFile.parseDiagnostics; // checking for syntactic errors

      if (diagnostics && diagnostics.length > 0) {
        if (this.options.verbose) {
          const message = ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: (f: string) => f,
            getCurrentDirectory: () => process.cwd(),
            getNewLine: () => '\n'
          });
          console.log('Syntax Error Details:\n' + message);
        }
        return false;
      }

      return true;
    } catch (error) {
      // Fallback to basic JS check if TS is not available
      try {
        new Function(solution);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  private parseSnapshot(generated: string): Record<string, string> | null {
    if (!this.config.initialFiles || !this.config.primaryFile) return null;
    let text = generated.trim();
    const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
    if (fenced) text = fenced[1].trim();
    try {
      const parsed = JSON.parse(text);
      const files = parsed?.files;
      if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
      const expected = Object.keys(this.config.initialFiles).sort();
      const actual = Object.keys(files).sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual) || actual.some(key => typeof files[key] !== 'string')) return null;
      return files;
    } catch {
      return null;
    }
  }

  /**
   * Runs a single iteration of the evolutionary process
   * @param iteration Current iteration number
   * @param parentCandidate The parent solution to evolve from
   * @param filterOptions Optional FilterOptions to restrict candidate selection for prompt building
   * @returns The new candidate solution or null if generation failed
   */
  private async runIteration(
    iteration: number,
    parentCandidate: CandidateSolution,
    filterOptions?: FilterOptions,
    runIterationIndex = iteration
  ): Promise<CandidateSolution | null> {
    if (this.options.verbose) {
      console.log(`\n🔄 Iteration ${runIterationIndex + 1}/${this.config.iterations}`);
      console.log(`Parent candidate ID: ${parentCandidate.id}`);
    }

    try {
      // Build prompt for the LLM, passing filterOptions if provided
      const prompt = PromptBuilder.buildPrompt(
        this.config,
        this.evaluationDatabase,
        filterOptions,
        parentCandidate
      );

      if (this.options.verbose) {
        this.display.displaySection('Prompt Preview');
        const previewLines = prompt.split('\n').slice(0, 10); // Show the first 10 lines of the prompt
        const preview = previewLines.join('\n') + (prompt.split('\n').length > 10 ? '\n...' : '');
        console.log(preview);
      }

      // Generate a new solution with the LLM
      if (this.options.verbose) {
        console.log(`🤖 Generating candidate solution using ${this.config.llmModel}...`);
      }

      const generatedText = await this.llmService.generateCode(
        prompt,
        this.config.llmModel,
        this.config.temperature,
        this.config.maxTokens,
        this.config.systemPrompt // pass systemPrompt if provided
      );

      // Display a structured preview of the LLM response
      this.display.displaySection('LLM Response Preview');
      const responseLines = generatedText.split('\n');
      const previewLines = responseLines.slice(0, 10); // Show the first 10 lines of the response
      const preview = previewLines.join('\n') + (responseLines.length > 10 ? '\n...' : '');
      console.log(preview);
      console.log(chalk.yellow(`Response Length: ${responseLines.length} lines`));

      // Extract code from the LLM response
      const snapshotMode = Boolean(this.config.initialFiles && this.config.primaryFile);
      const childFiles = snapshotMode ? this.parseSnapshot(generatedText) : undefined;
      const childSolution = childFiles
        ? childFiles[this.config.primaryFile!]
        : snapshotMode ? '' : CodeExtractor.extractSolution(generatedText);

      // Validate solution has actual code content
      if (snapshotMode ? !childSolution.trim() : !childSolution || childSolution.trim().length < 10) {
        console.error('Generated solution is empty or too short');
        return null;
      }

      if (snapshotMode && !childFiles) {
        console.error('Generated snapshot must be JSON with the exact configured file set');
        return null;
      }

      // Check if the solution contains code (has function declarations or expressions)
      if (!snapshotMode && !CodeExtractor.hasCode(childSolution)) {
        console.error('Generated text does not contain valid code');
        return null;
      }

      // Validate syntax if enabled
      if (this.options.checkSyntaxBeforeEval && (childFiles
        ? Object.entries(childFiles).some(([file, source]) => !this.checkSyntax(source, file))
        : !this.checkSyntax(childSolution))) {
        console.error('Generated solution has syntax errors');
        return null;
      }

      // Evaluate the new solution
      if (this.options.verbose) {
        console.log('🧪 Evaluating generated solution...');
      }

      const childResult = await this.evaluateSolution(childSolution, childFiles ?? undefined);
      const childFitness = childResult.fitness;

      if (childResult.evaluation.status === 'invalid') {
        this.display.displayError(`Candidate rejected: ${childResult.evaluation.reason}`);
      }

      this.display.displayComparison(parentCandidate.fitness, childFitness);
      this.display.displayFitnessMetrics(childFitness);

      // Generate feedback if enabled, and fitness > 0
      let feedback: string | undefined;
      let feedbackPrompt = '';
      if (this.config.feedbackEnabled && childResult.evaluation.status === 'valid') {
        if (this.options.verbose) {
          Logger.info(`💬 Generating feedback using ${this.config.feedbackLlmModel || this.config.llmModel}...`);
        }

        try {
          // Extract performance metrics if available
          const performanceMetrics = childFitness.performanceMetrics;

          // Pass the raw template (or empty string) to FeedbackService, which now handles interpolation.
          feedbackPrompt = this.config.feedbackPromptTemplate || '';
          feedback = await this.feedbackService.generateFeedback(
            childFiles ? JSON.stringify({ files: childFiles }) : childSolution,
            childFitness,
            parentCandidate.fitness,
            performanceMetrics,
            feedbackPrompt, // always pass the constructed prompt
            this.config.feedbackLlmModel || this.config.llmModel,
            this.config.feedbackTemperature,
            this.config.feedbackMaxTokens,
            this.config.feedbackSystemPrompt, // pass feedbackSystemPrompt for feedback LLM
            this.config.higherIsBetter
          );

          if (this.options.verbose) {
            Logger.info('Feedback received.');
          }
        } catch (err: any) {
          Logger.error('Feedback error:', err);
        }
      }

      // Copy fitness to ensure deep copy of performance metrics
      const fitnessCopy = {
        ...childFitness,
        qualityScore: childFitness.qualityScore,
        efficiencyScore: childFitness.efficiencyScore,
        finalScore: childFitness.finalScore
      };

      // Remove the performanceMetrics key to avoid duplication
      if ('performanceMetrics' in fitnessCopy && childFitness.performanceMetrics) {
        fitnessCopy.performanceMetrics = JSON.parse(JSON.stringify(childFitness.performanceMetrics));
      }

      // Add the new solution to the database
      return this.evaluationDatabase.addProgram(
        childSolution,
        fitnessCopy,
        iteration + 1,
        parentCandidate.id,
        feedback,
        prompt, // Save the generation prompt
        feedback ? feedbackPrompt : undefined, // Save the feedback prompt if feedback exists
        childResult.evaluation,
        childFiles ?? undefined,
        childFiles ? this.config.primaryFile : undefined
      );
    } catch (error) {
      console.error(`Error in iteration ${iteration + 1}:`, error);
      return null;
    }
  }

  /**
   * Runs the evolutionary optimization process.
   * @returns EvolutionResult with the best candidate, all candidates, and runtime
   */
  async run(): Promise<EvolutionResult> {
    const startTime = Date.now();

    try {
      this.display.displaySection('Starting AlphaEvolve');
      let firstGlobalIteration = 0;
      if (this.options.resume) {
        const candidates = this.evaluationDatabase.getAllPrograms();
        if (candidates.length === 0) throw new Error('Cannot resume a run with no saved candidates');
        const bestCandidate = this.evaluationDatabase.getBestProgram();
        if (!bestCandidate) throw new Error('Cannot resume: saved run has no valid candidate');
        if (this.config.initialFiles) {
          const expectedPaths = Object.keys(this.config.initialFiles).sort();
          const savedPaths = Object.keys(bestCandidate.files || {}).sort();
          if (JSON.stringify(expectedPaths) !== JSON.stringify(savedPaths)) {
            throw new Error('Cannot resume: best saved candidate does not match the manifest file set');
          }
        }
        firstGlobalIteration = Math.max(...candidates.map(candidate => candidate.iteration));
        this.display.displaySuccess(
          `Resuming from candidate iteration ${firstGlobalIteration} for ${this.config.iterations} additional iteration(s)...`
        );
        this.display.displayFitnessMetrics(bestCandidate.fitness);
      } else {
        this.display.displaySuccess('Evaluating initial solution...');

        const initialResult = await this.evaluateSolution(this.config.initialSolution, this.config.initialFiles);
        this.evaluationDatabase.addProgram(
          this.config.initialSolution,
          initialResult.fitness,
          0,
          undefined,
          undefined,
          undefined,
          undefined,
          initialResult.evaluation,
          this.config.initialFiles,
          this.config.primaryFile
        );

        this.display.displayFitnessMetrics(initialResult.fitness);
        if (initialResult.evaluation.status === 'invalid') {
          throw new Error(`Initial solution is invalid: ${initialResult.evaluation.reason}`);
        }
      }

      // Run the evolution for specified iterations
      this.display.initProgressBar(this.config.iterations);
      for (let runIterationIndex = 0; runIterationIndex < this.config.iterations; runIterationIndex++) {
        const globalIteration = firstGlobalIteration + runIterationIndex;
        this.display.updateProgressBar(runIterationIndex + 1);
        const parentCandidate = this.evaluationDatabase.getBestProgram();
        if (!parentCandidate) {
          throw new Error('No candidate solution available');
        }

        // Run the iteration with retry logic
        let childCandidate: CandidateSolution | null = null;
        let retries = 0;

        while (!childCandidate && retries < this.options.maxRetries) {
          if (retries > 0 && this.options.verbose) {
            console.log(`Retry ${retries}/${this.options.maxRetries}...`);
          }

          childCandidate = await this.runIteration(globalIteration, parentCandidate, undefined, runIterationIndex);
          retries++;
        }

        // Save progress if configured to do so
        if ((this.config.databaseOptions || {}).saveFrequency === 'iteration') {
          if (this.options.verbose) {
            console.log(`🔄 Database save triggered for iteration ${globalIteration + 1}`);
          }
          await this.saveDatabaseIfEnabled(`iteration ${globalIteration + 1}`);
        } else if (this.options.verbose) {
          console.log(`⏭️ Iteration save skipped - saveFrequency: ${(this.config.databaseOptions || {}).saveFrequency}`);
        }
      }

      // Finalize the run
      const bestCandidate = this.evaluationDatabase.getBestProgram();
      if (!bestCandidate) {
        throw new Error('No candidate solutions found');
      }

      const runtime = Date.now() - startTime;

      this.display.stopProgressBar();
      this.display.displaySummary(bestCandidate, runtime);

      // Update metadata and save final results
      this.evaluationDatabase.setMetadata('runtime', runtime);
      this.evaluationDatabase.setMetadata('endTime', new Date().toISOString());
      await this.saveDatabaseIfEnabled('final');

      // Return the final evolution results
      return {
        bestCandidate,
        allCandidates: this.evaluationDatabase.getAllPrograms(),
        runtime
      };
    } catch (error) {
      console.error('Error in AlphaEvolve.run:', error);

      // Try to save what we have in case of error
      try {
        this.evaluationDatabase.setMetadata('error', String(error));
        this.evaluationDatabase.setMetadata('errorTime', new Date().toISOString());
        await this.saveDatabaseIfEnabled('error');
      } catch (saveError) {
        console.error('Failed to save database after error:', saveError);
      }

      throw error;
    }
  }

  /**
   * Gets the current database instance
   * @returns The evaluation database
   */
  getDatabase(): ProgramDatabase {
    return this.evaluationDatabase;
  }

  /**
   * Gets the unique run identifier
   * @returns Run ID string
   */
  getRunId(): string {
    return this.runId;
  }
}
