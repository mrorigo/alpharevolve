import { EvolutionResult, EvolutionConfig, CandidateSolution, EvolutionOptions } from './types';
import { ProgramDatabase } from './ProgramDatabase';
import { LlmService } from './LlmService';
import { PromptBuilder } from './PromptBuilder';
import { CodeExtractor } from './CodeExtractor';
import { FeedbackService } from './FeedbackService';
import * as path from 'path';
import * as fs from 'fs';

/**
 * AlphaRevolve orchestrates evolutionary optimization of candidate solutions using LLMs.
 * It intelligently evolves solutions through iterative feedback and fitness evaluation.
 */
export class AlphaRevolve {
  private readonly config: EvolutionConfig;
  private readonly llmService: LlmService;
  private readonly feedbackService: FeedbackService;
  private readonly evaluationDatabase: ProgramDatabase;
  private readonly options: EvolutionOptions;
  private readonly runId: string;

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
    this.config = {
      ...config,
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 4096,
      feedbackEnabled: config.feedbackEnabled !== false,
      feedbackTemperature: config.feedbackTemperature || 0.5,
      feedbackMaxTokens: config.feedbackMaxTokens || 2048
    };

    // Default options merged with user-provided options
    this.options = {
      verbose: options.verbose !== false,
      saveResults: options.saveResults !== false,
      runParallel: options.runParallel || false,
      maxRetries: options.maxRetries || 3,
      checkSyntaxBeforeEval: options.checkSyntaxBeforeEval !== false,
      ...options
    };

    this.runId = options.runId || AlphaRevolve.generateRunId();
    this.llmService = llmService || new LlmService(baseUrl, apiKey);
    this.feedbackService = feedbackService || new FeedbackService(baseUrl, apiKey);
    this.evaluationDatabase = evaluationDatabase || new ProgramDatabase();

    // Initialize database with metadata
    this.initializeDatabase();
  }

  /**
   * Sets up the evaluation database with initial metadata
   */
  private initializeDatabase(): void {
    this.evaluationDatabase.setMetadata('problemDescription', this.config.problemDescription);
    this.evaluationDatabase.setMetadata('runId', this.runId);
    this.evaluationDatabase.setMetadata('startTime', new Date().toISOString());
    this.evaluationDatabase.setMetadata('config', {
      iterations: this.config.iterations,
      llmModel: this.config.llmModel,
      feedbackEnabled: this.config.feedbackEnabled,
      feedbackLlmModel: this.config.feedbackLlmModel,
    });
    this.evaluationDatabase.setMetadata('options', this.options);
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
       console.log(`📂 Database directory: ${runsDir}`);
     }

     if (!fs.existsSync(runsDir)) {
       try {
         fs.mkdirSync(runsDir, { recursive: true });
         console.log(`📁 Created database directory: ${runsDir}`);
       } catch (error) {
         console.error(`❌ Failed to create directory ${runsDir}:`, error);
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
       console.log(`Save check - saveEnabled: ${options.saveEnabled !== false}, saveResults: ${this.options.saveResults}`);
     }

     if (options.saveEnabled !== false && this.options.saveResults) {
       try {
         const filePath = this.getDatabasePath();
         console.log(`📝 Attempting to save database to: ${filePath}${label ? ` (${label})` : ''}`);

         // Check if file already exists (for overwrite info)
         const fileExists = fs.existsSync(filePath);

         // Save database
         await this.evaluationDatabase.saveToFile(filePath);

         console.log(`💾 Database ${fileExists ? 'updated' : 'saved'} to ${filePath}${label ? ` (${label})` : ''}`);
       } catch (error) {
         // More detailed error logging
         console.error(`❌ Error saving database: ${error}`);
         if (error instanceof Error) {
           console.error(`Stack trace: ${error.stack}`);
         }

         // Try to check write permissions on directory
         try {
           const dir = path.dirname(this.getDatabasePath());
           const testFile = path.join(dir, '.write-test');
           fs.writeFileSync(testFile, 'test');
           fs.unlinkSync(testFile);
           console.log(`✅ Directory ${dir} is writable`);
         } catch (fsError) {
           console.error(`❌ Directory permission issue: ${fsError}`);
         }
       }
     } else if (this.options.verbose) {
       console.log(`⏭️ Database save skipped (saveEnabled: ${options.saveEnabled}, saveResults: ${this.options.saveResults})`);
     }
   }

  /**
   * Validates a candidate solution's syntax without executing it
   * @param solution Code to validate
   * @returns True if valid, false if invalid
   */
  private checkSyntax(solution: string): boolean {
    try {
      // Using Function constructor to validate syntax without executing
      new Function(solution);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Runs a single iteration of the evolutionary process
   * @param iteration Current iteration number
   * @param parentCandidate The parent solution to evolve from
   * @returns The new candidate solution or null if generation failed
   */
  private async runIteration(
    iteration: number,
    parentCandidate: CandidateSolution
  ): Promise<CandidateSolution | null> {
    if (this.options.verbose) {
      console.log(`\n🔄 Iteration ${iteration + 1}/${this.config.iterations}`);
      console.log(`Parent candidate ID: ${parentCandidate.id}`);
    }

    try {
      // Build prompt for the LLM
      const prompt = PromptBuilder.buildPrompt(this.config, this.evaluationDatabase);

      if (this.options.verbose) {
        // Log a preview of the prompt
        const previewLines = prompt.split('\n').slice(0, 50);
        const preview = previewLines.join('\n') + (prompt.split('\n').length > 10 ? '\n...' : '');
        console.log(`Prompt preview:\n${preview}`);
      }

      // Generate a new solution with the LLM
      if (this.options.verbose) {
        console.log(`🤖 Generating candidate solution using ${this.config.llmModel}...`);
      }

      const generatedText = await this.llmService.generateCode(
        prompt,
        this.config.llmModel,
        this.config.temperature,
        this.config.maxTokens
      );

      // Extract code from the LLM response
      if (this.options.verbose) {
        console.log('📝 Extracting solution...');
      }

      const childSolution = CodeExtractor.extractSolution(generatedText);

      // Validate solution has actual code content
      if (!childSolution || childSolution.trim().length < 10) {
        console.error('Generated solution is empty or too short');
        return null;
      }

      // Check if the solution contains code (has function declarations or expressions)
      if (!CodeExtractor.hasCode(childSolution)) {
        console.error('Generated text does not contain valid code');
        return null;
      }

      // Validate syntax if enabled
      if (this.options.checkSyntaxBeforeEval && !this.checkSyntax(childSolution)) {
        console.error('Generated solution has syntax errors');
        return null;
      }

      // Evaluate the new solution
      if (this.options.verbose) {
        console.log('🧪 Evaluating generated solution...');
      }

      const childFitness = await this.config.fitnessFunction(childSolution);

      if (this.options.verbose) {
        console.log(`📊 Child fitness: ${JSON.stringify(childFitness)}`);

        // Calculate and log improvement metrics
        const improvement = childFitness.finalScore - parentCandidate.fitness.finalScore;
        const denominator = Math.abs(parentCandidate.fitness.finalScore) < 0.001 ? 0.001 : Math.abs(parentCandidate.fitness.finalScore);
        const percentImprovement = (improvement / denominator) * 100;
        console.log(
          `${improvement >= 0 ? '📈' : '📉'} Improvement: ${improvement.toFixed(4)} (${percentImprovement.toFixed(2)}%)`
        );
      }

      // Generate feedback if enabled, and fitness > 0
      let feedback: string | undefined;
      if (this.config.feedbackEnabled && childFitness.finalScore > 0) {
        if (this.options.verbose) {
          console.log(`🤖 Generating candidate solution using ${this.config.feedbackLlmModel || this.config.llmModel}...`);
          console.log('💬 Generating feedback...');
        }

        try {
          // Extract performance metrics if available
          const performanceMetrics = childFitness.performanceMetrics;

          feedback = await this.feedbackService.generateFeedback(
            childSolution,
            childFitness,
            parentCandidate.fitness,
            performanceMetrics,
            this.config.feedbackPromptTemplate,
            this.config.feedbackLlmModel || this.config.llmModel,
            this.config.feedbackTemperature,
            this.config.feedbackMaxTokens
          );

          if (this.options.verbose) {
            console.log('Feedback received.');
          }
        } catch (err: any) {
          console.error('Feedback error:', err);
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
        feedback
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
      if (this.options.verbose) {
        console.log('🚀 Starting AlphaEvolve...');
        console.log('🧪 Evaluating initial solution...');
      }

      // Evaluate the initial solution
      const initialFitness = await this.config.fitnessFunction(this.config.initialSolution);

      // Make a deep copy of initialFitness
      const fitnessCopy = {
        ...initialFitness,
        // Ensure the required properties exist (defensive programming)
        qualityScore: initialFitness.qualityScore,
        efficiencyScore: initialFitness.efficiencyScore,
        finalScore: initialFitness.finalScore
      };

      // Handle performance metrics specifically to ensure proper copying
      if ('performanceMetrics' in initialFitness) {
        fitnessCopy.performanceMetrics = JSON.parse(
          JSON.stringify(initialFitness.performanceMetrics)
        );
      }

      // Add initial solution to the database
      this.evaluationDatabase.addProgram(this.config.initialSolution, fitnessCopy, 0);

      if (this.options.verbose) {
        console.log(`📊 Initial fitness: ${JSON.stringify(initialFitness)}`);
      }

      // Run the evolution for specified iterations
      for (let i = 0; i < this.config.iterations; i++) {
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

          childCandidate = await this.runIteration(i, parentCandidate);
          retries++;
        }

        // Save progress if configured to do so
        if ((this.config.databaseOptions || {}).saveFrequency === 'iteration') {
          if (this.options.verbose) {
            console.log(`🔄 Database save triggered for iteration ${i + 1}`);
          }
          await this.saveDatabaseIfEnabled(`iteration ${i + 1}`);
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

      if (this.options.verbose) {
        console.log(`\n✅ AlphaEvolve finished in ${runtime}ms`);
        console.log(`🏆 Best fitness: ${JSON.stringify(bestCandidate.fitness)}`);
      }

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
