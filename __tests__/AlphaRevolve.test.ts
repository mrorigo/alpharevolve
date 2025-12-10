
import { AlphaRevolve } from '../src/AlphaRevolve';
import { LlmService } from '../src/llmService';
import { FeedbackService } from '../src/feedbackService';
import { ProgramDatabase } from '../src/ProgramDatabase';
import { EvolutionConfig } from '../src/types';

// Mock dependencies
jest.mock('../src/ConsoleDisplay', () => {
    return {
        ConsoleDisplay: jest.fn().mockImplementation(() => ({
            displaySection: jest.fn(),
            displaySuccess: jest.fn(),
            displayFitnessMetrics: jest.fn(),
            initProgressBar: jest.fn(),
            updateProgressBar: jest.fn(),
            stopProgressBar: jest.fn(),
            displaySummary: jest.fn(),
            displayComparison: jest.fn(),
            displayPerformanceMetrics: jest.fn(),
            displayError: jest.fn()
        }))
    };
});

jest.mock('../src/llmService');
jest.mock('../src/feedbackService');
jest.mock('../src/ProgramDatabase');
jest.mock('../src/logger');

describe('AlphaRevolve', () => {
    let mockLlmService: jest.Mocked<LlmService>;
    let mockFeedbackService: jest.Mocked<FeedbackService>;
    let mockDatabase: jest.Mocked<ProgramDatabase>;
    let config: EvolutionConfig;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock implementations
        mockLlmService = new LlmService('url', 'key') as jest.Mocked<LlmService>;
        mockFeedbackService = new FeedbackService('url', 'key') as jest.Mocked<FeedbackService>;
        mockDatabase = new ProgramDatabase() as jest.Mocked<ProgramDatabase>;

        // Specific return values for mocks
        mockLlmService.generateCode.mockResolvedValue('function evolved() {}');
        mockFeedbackService.generateFeedback.mockResolvedValue('Good job');

        const initialSolution = {
            id: '1',
            solution: 'initial',
            fitness: { qualityScore: 0.5, efficiencyScore: 0.5, finalScore: 0.5 },
            iteration: 0,
            timestamp: new Date()
        };

        mockDatabase.getBestProgram.mockReturnValue(initialSolution);
        mockDatabase.addProgram.mockReturnValue({
            ...initialSolution,
            id: '2',
            solution: 'evolved',
            iteration: 1
        });
        mockDatabase.getAllPrograms.mockReturnValue([initialSolution]);

        config = {
            initialSolution: 'initial solution',
            fitnessFunction: jest.fn().mockResolvedValue({
                qualityScore: 1,
                efficiencyScore: 1,
                finalScore: 1,
                performanceMetrics: {} as any
            }),
            problemDescription: 'test problem',
            iterations: 1,
            llmModel: 'test-model',
            promptTemplate: 'Prompt',
            feedbackEnabled: true,
            feedbackLlmModel: 'feedback-model'
        };
    });

    it('should initialize correctly', () => {
        const ar = new AlphaRevolve(config, 'http://localhost', 'key', {}, mockDatabase, mockLlmService, mockFeedbackService);
        expect(ar.getRunId()).toBeDefined();
        expect(mockDatabase.setMetadata).toHaveBeenCalledTimes(5); // Initial metadata setup
    });

    it('should run evolution loop successfully', async () => {
        const ar = new AlphaRevolve(config, 'http://localhost', 'key', { verbose: false }, mockDatabase, mockLlmService, mockFeedbackService);

        const result = await ar.run();

        expect(mockDatabase.addProgram).toHaveBeenCalledTimes(2); // Initial + 1 iteration
        expect(mockLlmService.generateCode).toHaveBeenCalled();
        expect(mockFeedbackService.generateFeedback).toHaveBeenCalled();
        expect(result.bestCandidate).toBeDefined();
    });

    it('should retry on null generation', async () => {
        // First attempt returns null (empty/invalid), second returns valid code
        const ar = new AlphaRevolve(config, 'http://localhost', 'key', { verbose: false, maxRetries: 2 }, mockDatabase, mockLlmService, mockFeedbackService);

        // We mock generateCode to fail validity checks initially
        // AlphaRevolve checks validation logic: empty string or too short
        mockLlmService.generateCode
            .mockResolvedValueOnce('') // Fail 1
            .mockResolvedValueOnce('function good() {}'); // Success 2

        await ar.run();

        expect(mockLlmService.generateCode).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully during run', async () => {
        const ar = new AlphaRevolve(config, 'http://localhost', 'key', { verbose: false }, mockDatabase, mockLlmService, mockFeedbackService);

        mockLlmService.generateCode.mockRejectedValue(new Error('LLM Error'));

        // config.iterations is 1, so it will try to run iteration 0, fail (retry?), fail again...
        // Actually valid logic: runIteration catches error and returns null.
        // Loop sees null, repeats "retries" times.
        // If all retries fail, it finishes iteration loop for that index? 
        // Looking at AlphaRevolve.ts: 
        // while (!childCandidate && retries < maxRetries) ...
        // If we exhaust retries, it just goes to next iteration (or loop finishes if i == max iterations).
        // Wait, the loop is `for (let i = 0...`. If childCandidate is null after retries, it just logs logic but loop continues.
        // However, promptBuilder relies on parentCandidate. 

        // Let's verify it doesn't crash on LLM error.
        await expect(ar.run()).resolves.not.toThrow();
    });
});
