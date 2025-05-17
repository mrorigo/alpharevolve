import { EvolutionResult, EvolutionConfig, CandidateSolution } from './types';
import { ProgramDatabase } from './ProgramDatabase';
import { LlmService } from './LlmService';
import { PromptBuilder } from './PromptBuilder';
import { CodeExtractor } from './CodeExtractor';
import { FeedbackService } from './FeedbackService';

/**
 * Evolver orchestrates the evolutionary optimization of candidate solutions using LLMs.
 * This generic framework supports a broad range of problems beyond code optimization.
 */
export class Evolver {
  private readonly config: EvolutionConfig;
  private readonly llmService: LlmService;
  private readonly feedbackService: FeedbackService;
  private readonly evaluationDatabase: ProgramDatabase; // Still using ProgramDatabase, which stores CandidateSolution objects

  /**
   * Constructs a new Evolver with explicit dependencies for testability and flexibility.
   * @param config Evolution configuration.
   * @param baseUrl LLM API base URL.
   * @param openaiApiKey LLM API key.
   * @param evaluationDatabase Optional injected database.
   * @param llmService Optional injected LLM service.
   * @param feedbackService Optional injected feedback service.
   */
  constructor(
    config: EvolutionConfig,
    baseUrl: string,
    openaiApiKey: string,
    evaluationDatabase?: ProgramDatabase,
    llmService?: LlmService,
    feedbackService?: FeedbackService
  ) {
    this.config = config;
    this.llmService = llmService || new LlmService(baseUrl, openaiApiKey);
    this.feedbackService = feedbackService || new FeedbackService(baseUrl, openaiApiKey);
    this.evaluationDatabase = evaluationDatabase || new ProgramDatabase();
  }

  /**
   * Returns a default file path for saving the evaluation database.
   */
  private getDefaultDatabasePath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
    return `./runs/evolver-${timestamp}.json`;
  }

  /**
   * Saves the evaluation database to disk if enabled in the configuration.
   * @param label Optional label for the save (e.g., iteration number).
   */
  private async saveDatabaseIfEnabled(label: string = ''): Promise<void> {
    const options = this.config.databaseOptions || {};
    if (options.saveEnabled !== false) {
      try {
        const filePath = options.savePath || this.getDefaultDatabasePath();
        await this.evaluationDatabase.saveToFile(filePath);
        console.log(`💾 Database saved to ${filePath}${label ? ` (${label})` : ''}`);
      } catch (error) {
        console.error(`Error saving database: ${error}`);
      }
    }
  }

  /**
   * Runs the evolutionary optimization process.
   * @returns EvolutionResult containing the best candidate, all candidates, and runtime.
   */
  async run(): Promise<EvolutionResult> {
    const startTime = Date.now();
    this.evaluationDatabase.setMetadata('problemDescription', this.config.problemDescription);
    this.evaluationDatabase.setMetadata('startTime', new Date().toISOString());
    this.evaluationDatabase.setMetadata('config', {
      iterations: this.config.iterations,
      llmModel: this.config.llmModel,
      feedbackEnabled: this.config.feedbackEnabled,
      feedbackLlmModel: this.config.feedbackLlmModel,
    });

    try {
      console.log('🚀 Starting Evolver...');
      console.log('🧪 Evaluating initial solution...');
      const initialFitness = await this.config.fitnessFunction(this.config.initialSolution);
      
      // Make a copy of initialFitness to ensure performanceMetrics are properly stored
      const fitnessCopy = {
        qualityScore: initialFitness.qualityScore,
        efficiencyScore: initialFitness.efficiencyScore,
        finalScore: initialFitness.finalScore,
        // Explicitly include performance metrics if available
        ...initialFitness.performanceMetrics && { performanceMetrics: initialFitness.performanceMetrics }
      };
      
      this.evaluationDatabase.addProgram(this.config.initialSolution, fitnessCopy, 0);
      console.log(`📊 Initial fitness: ${JSON.stringify(initialFitness)}`);

      for (let i = 0; i < this.config.iterations; i++) {
        console.log(`\n🔄 Iteration ${i + 1}/${this.config.iterations}`);
        const parentCandidate = this.evaluationDatabase.getBestProgram();
        if (!parentCandidate) {
          throw new Error('No candidate solution available');
        }
        console.log(`Parent candidate ID: ${parentCandidate.id}`);

        const prompt = PromptBuilder.buildPrompt(this.config, this.evaluationDatabase);
        console.log(`Prompt:\n${prompt}`);

        console.log(`🤖 Generating candidate solution using ${this.config.llmModel}...`);
        const generatedText = await this.llmService.generateCode(
          prompt,
          this.config.llmModel,
          this.config.temperature || 0.7,
          this.config.maxTokens || 2048
        );

        console.log('📝 Extracting solution...');
        // Reuse CodeModifier to modify solutions – this can be adapted if the problem is not code.
        const childSolution = CodeExtractor.extractSolution(generatedText);

        console.log('🧪 Evaluating generated solution...');
        const childFitness = await this.config.fitnessFunction(childSolution);
        console.log(`📊 Child fitness: ${JSON.stringify(childFitness)}`);

        const improvement = childFitness.finalScore - parentCandidate.fitness.finalScore;
        const percentImprovement = (improvement / Math.abs(parentCandidate.fitness.finalScore || 1)) * 100;
        console.log(`${improvement >= 0 ? '📈' : '📉'} Improvement: ${improvement.toFixed(4)} (${percentImprovement.toFixed(2)}%)`);

        let feedback: string | undefined;
        if (this.config.feedbackEnabled) {
          console.log('💬 Generating feedback...');
          try {
            // Extract performance metrics if available
            const performanceMetrics = childFitness.performanceMetrics || undefined;
            
            feedback = await this.feedbackService.generateFeedback(
            childSolution,
            childFitness,
            parentCandidate.fitness,
            performanceMetrics,
            this.config.feedbackPromptTemplate,
            this.config.feedbackLlmModel || this.config.llmModel,
            this.config.feedbackTemperature || 0.7,
            this.config.feedbackMaxTokens || 1024
          );
            console.log('Feedback received.');
          } catch (err: any) {
            console.error('Feedback error:', err);
          }
        }

        // Make a copy of childFitness to ensure performanceMetrics are properly stored
        const fitnessCopy = {
          qualityScore: childFitness.qualityScore,
          efficiencyScore: childFitness.efficiencyScore,
          finalScore: childFitness.finalScore,
          // Explicitly include performance metrics if available
          ...childFitness.performanceMetrics && { performanceMetrics: childFitness.performanceMetrics }
        };
        
        this.evaluationDatabase.addProgram(
          childSolution,
          fitnessCopy,
          i + 1,
          parentCandidate.id,
          feedback
        );
        if ((this.config.databaseOptions || {}).saveFrequency === 'iteration') {
          await this.saveDatabaseIfEnabled(`iteration ${i + 1}`);
        }
      }

      const bestCandidate = this.evaluationDatabase.getBestProgram();
      if (!bestCandidate) {
        throw new Error('No candidate solutions found');
      }
      const runtime = Date.now() - startTime;
      console.log(`\n✅ Evolver finished in ${runtime}ms`);
      console.log(`🏆 Best fitness: ${JSON.stringify(bestCandidate.fitness)}`);

      this.evaluationDatabase.setMetadata('runtime', runtime);
      this.evaluationDatabase.setMetadata('endTime', new Date().toISOString());
      await this.saveDatabaseIfEnabled('final');

      const allCandidates = this.evaluationDatabase.getAllPrograms();

      return {
        bestCandidate,
        allCandidates,
        runtime
      };
    } catch (error) {
      console.error('Error in Evolver.run:', error);
      throw error;
    }
  }
}
