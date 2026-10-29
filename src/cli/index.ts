#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AlphaRevolve } from '../core/AlphaRevolve';
import { EvolutionConfig } from '../core/types';
import { BenchmarkRunner } from '../core/BenchmarkRunner';
import * as process from 'process';

function loadLocalEnvFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || process.env[match[1]] !== undefined) continue;

        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            const quote = value[0];
            value = value.slice(1, -1);
            if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        } else {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        process.env[match[1]] = value;
    }
}

loadLocalEnvFile(path.resolve(process.cwd(), '.env'));

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
    .option('-m, --model <string>', 'LLM Model to use', process.env.OPENAI_MODEL || 'gpt-3.5-turbo')
    .option('--evaluation-repeats <number>', 'Independent fitness evaluations per candidate', '1')
    .option('--min-improvement <number>', 'Minimum absolute score improvement to promote a candidate', '0')
    .option('--noise-tolerance-multiplier <number>', 'Multiplier applied to measured score noise', '1')
    .option('--quality-weight <number>', 'Correctness contribution to the CLI score', '0.7')
    .option('--efficiency-weight <number>', 'Execution efficiency contribution to the CLI score', '0.3')
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

            if (!absoluteTest) {
                throw new Error('A test file is required; AlphaRevolve will not assign fitness without evaluation.');
            }

            const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.error('Error: API key is required. Use --api-key or set OPENAI_API_KEY.');
                process.exit(1);
            }

            const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

            // Read initial solution
            const initialSolution = fs.readFileSync(absoluteTarget, 'utf-8');

            const scoreWeights = {
                quality: Number(options.qualityWeight),
                efficiency: Number(options.efficiencyWeight),
            };
            const runner = new BenchmarkRunner({
                targetFilePath: absoluteTarget,
                testFilePath: absoluteTest,
                qualityWeight: scoreWeights.quality,
                efficiencyWeight: scoreWeights.efficiency,
            });
            const fitnessFunction = (solution: string) => runner.evaluate(solution);

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
                feedbackEnabled: true,
                evaluationRepeats: Number(options.evaluationRepeats),
                minImprovement: Number(options.minImprovement),
                noiseToleranceMultiplier: Number(options.noiseToleranceMultiplier),
                higherIsBetter: true,
                scoreWeights,
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
