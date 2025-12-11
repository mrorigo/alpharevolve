#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AlphaRevolve } from '../core/AlphaRevolve';
import { EvolutionConfig } from '../core/types';
import { BenchmarkRunner } from '../core/BenchmarkRunner';
import * as process from 'process';

const program = new Command();

program
    .name('alpharevolve')
    .description('AI-powered evolutionary code optimizer')
    .version('1.0.0');

program
    .command('optimize')
    .argument('<targetFile>', 'Path to the file containing the code to optimize')
    .option('-t, --test <testFile>', 'Path to the test file for verification')
    .option('-i, --iterations <number>', 'Number of iterations', '10')
    .option('-m, --model <string>', 'LLM Model to use', 'gpt-3.5-turbo')
    .option('--api-key <string>', 'API Key (or set OPENAI_API_KEY env var)')
    .option('--base-url <string>', 'API Base URL (or set OPENAI_BASE_URL env var)')
    .description('Optimize a specific file using a test suite for feedback')
    .action(async (targetFile, options) => {
        try {
            const absoluteTarget = path.resolve(targetFile);
            if (!fs.existsSync(absoluteTarget)) {
                console.error(`Error: Target file not found: ${absoluteTarget}`);
                process.exit(1);
            }

            const absoluteTest = options.test ? path.resolve(options.test) : null;
            if (options.test && !fs.existsSync(absoluteTest!)) {
                console.error(`Error: Test file not found: ${absoluteTest}`);
                process.exit(1);
            }

            const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.error('Error: API key is required. Use --api-key or set OPENAI_API_KEY.');
                process.exit(1);
            }

            const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

            // Read initial solution
            const initialSolution = fs.readFileSync(absoluteTarget, 'utf-8');

            // Fitness function setup
            let fitnessFunction;
            if (absoluteTest) {
                const runner = new BenchmarkRunner({
                    targetFilePath: absoluteTarget,
                    testFilePath: absoluteTest
                });
                fitnessFunction = (sol: string) => runner.evaluate(sol);
            } else {
                console.warn('Warning: No test file provided. Using dummy fitness function (always succeeds).');
                fitnessFunction = async () => ({
                    qualityScore: 1,
                    efficiencyScore: 1,
                    finalScore: 1
                });
            }

            const config: EvolutionConfig = {
                initialSolution,
                fitnessFunction,
                problemDescription: `Optimize the code in ${path.basename(targetFile)}`,
                iterations: parseInt(options.iterations),
                llmModel: options.model,
                temperature: 0.7,
                promptTemplate: `
# Optimization Task
We are optimizing the following code:
\`\`\`typescript
{CURRENT_SOLUTION}
\`\`\`

The goal is to improve performance while maintaining correctness as verified by the test suite.

# Feedback
{PERFORMANCE_INFO}

{PREVIOUS_FEEDBACK}

Please provide an improved version of the code.
        `,
                feedbackEnabled: true // Default to true
            };

            const evolver = new AlphaRevolve(config, baseUrl, apiKey, { verbose: true, saveResults: true });
            const result = await evolver.run();

            console.log('\nOptimization Complete!');
            console.log('Best Solution Fitness:', result.bestCandidate.fitness);

            // Optionally write best solution back?
            // For now, let's just log it or maybe save to a .optimized.ts file
            const loadPath = absoluteTarget.replace(/\.ts$/, '.optimized.ts');
            fs.writeFileSync(loadPath, result.bestCandidate.solution);
            console.log(`Best solution written to ${loadPath}`);

        } catch (error) {
            console.error('Optimization failed:', error);
            process.exit(1);
        }
    });

program.parse(process.argv);
