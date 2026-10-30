#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AlphaRevolve } from '../core/AlphaRevolve';
import { EvolutionConfig } from '../core/types';
import { BenchmarkRunner } from '../core/BenchmarkRunner';
import { loadTaskManifest } from '../core/TaskManifest';
import { ManifestEvaluator } from '../core/ManifestEvaluator';
import { writeRunArtifacts } from '../core/RunArtifacts';
import { inspectTask } from '../core/TaskPreflight';
import { ProgramDatabase } from '../core/ProgramDatabase';
import * as process from 'process';
import { randomBytes } from 'crypto';

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

function displayArgs(args: string[]): string {
    const sensitive = /^(?:--?)(?:api[-_]?key|token|secret|password|passwd|authorization|auth)(?:=|$)/i;
    const redactValue = (value: string) => {
        if (/^(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)$/i.test(value)) return '[redacted]';
        return value.replace(/([?&](?:api[-_]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]');
    };
    return JSON.stringify(args.map((argument, index) => {
        const equalsAt = argument.indexOf('=');
        if (equalsAt > 0 && sensitive.test(argument.slice(0, equalsAt))) {
            return `${argument.slice(0, equalsAt + 1)}[redacted]`;
        }
        if (sensitive.test(argument)) return argument;
        if (index > 0 && sensitive.test(args[index - 1])) return '[redacted]';
        return redactValue(argument);
    }));
}

program
    .name('alpharevolve')
    .description('AI-powered evolutionary code optimizer')
    .version('1.0.0');

program
    .command('check')
    .requiredOption('-c, --config <path>', 'Path to an alpharevolve.json optimization manifest')
    .option('--unsandboxed', 'Check trusted commands without requiring an OS sandbox', false)
    .description('Validate an optimization manifest without running commands or calling a model')
    .action((options) => {
        try {
            const loaded = loadTaskManifest(options.config);
            const checks = inspectTask(loaded, options.unsandboxed);
            console.log(`Preflight for: ${loaded.config.goal}`);
            for (const check of checks) {
                console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
            }
            const config = loaded.config;
            console.log('\nRun settings:');
            console.log(`  Project root: ${loaded.projectRoot}`);
            console.log(`  Files: ${config.files.join(', ')}`);
            console.log(`  Iterations: ${config.iterations}; evaluation repeats: ${config.evaluationRepeats}`);
            console.log(`  Timeout: ${config.timeoutMs} ms`);
            console.log(`  Benchmark: ${config.benchmark.warmupRuns} warmup(s), ${config.benchmark.sampleRuns} sample(s)`);
            console.log(`  Score weights: quality ${config.scoreWeights.quality}, efficiency ${config.scoreWeights.efficiency}`);
            console.log(`  Minimum improvement: ${config.minImprovement}; noise multiplier: ${config.noiseToleranceMultiplier}`);
            console.log(`  Network: ${config.allowNetwork ? 'allowed by manifest' : 'denied'}`);
            console.log(`  Correctness command: ${config.correctness.command} ${displayArgs(config.correctness.args)}`);
            console.log(`  Benchmark command: ${config.benchmark.command} ${displayArgs(config.benchmark.args)}`);
            if (checks.some(check => !check.passed)) global.process.exitCode = 1;
        } catch (error) {
            console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
            global.process.exitCode = 1;
        }
    });

program
    .command('optimize')
    .argument('[targetFile]', 'Path to the file containing the code to optimize')
    .option('-c, --config <path>', 'Path to an alpharevolve.json optimization manifest')
    .option('--resume <runFile>', 'Resume a saved manifest run from runs/<runId>.json')
    .option('-t, --test <testFile>', 'Path to the test file for verification')
    .option('-i, --iterations <number>', 'Number of iterations', '10')
    .option('-m, --model <string>', 'LLM Model to use', process.env.OPENAI_MODEL || 'gpt-3.5-turbo')
    .option('--evaluation-repeats <number>', 'Independent fitness evaluations per candidate', '1')
    .option('--min-improvement <number>', 'Minimum absolute score improvement to promote a candidate', '0')
    .option('--noise-tolerance-multiplier <number>', 'Multiplier applied to measured score noise', '1')
    .option('--quality-weight <number>', 'Correctness weight when --benchmark-command is set', '0.7')
    .option('--efficiency-weight <number>', 'Benchmark efficiency weight when --benchmark-command is set', '0.3')
    .option('--evaluation-timeout <ms>', 'Maximum time for a test or benchmark command', '120000')
    .option('--benchmark-command <command>', 'Optional command that emits benchmark samples as JSON')
    .option('--benchmark-arg <arg>', 'Argument for the benchmark command; repeatable', (value, previous: string[] = []) => [...previous, value], [])
    .option('--benchmark-warmup-runs <number>', 'Warmup iterations performed by the benchmark command', '1')
    .option('--benchmark-runs <number>', 'Measured samples returned by the benchmark command', '5')
    .option('--allow-test-network', 'Allow evaluation commands to access the network', false)
    .option('--unsandboxed-tests', 'Run trusted evaluation commands without the OS sandbox', false)
    .option('--skip-syntax-check', 'Skip the TypeScript/JavaScript syntax check for other languages', false)
    .option('--api-key <string>', 'API Key (or set OPENAI_API_KEY env var)')
    .option('--base-url <string>', 'API Base URL (or set OPENAI_BASE_URL env var)')
    .description('Optimize a specific file using a test suite for feedback')
    .action(async (targetFile, options, command) => {
        try {
            if (options.config) {
                if (targetFile) throw new Error('Do not pass a target file together with --config.');
                const loaded = loadTaskManifest(options.config);
                const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
                if (!apiKey) throw new Error('API key is required. Use --api-key or set OPENAI_API_KEY.');
                const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
                let database: ProgramDatabase | undefined;
                let runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
                let runFile: string;
                if (options.resume) {
                    const runsDirectory = fs.realpathSync(path.join(loaded.projectRoot, 'runs'));
                    const requestedRunFile = fs.realpathSync(path.resolve(options.resume));
                    const relativeRunFile = path.relative(runsDirectory, requestedRunFile);
                    if (!relativeRunFile || relativeRunFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRunFile)) {
                        throw new Error(`Resume file must be inside ${runsDirectory}`);
                    }
                    if (!requestedRunFile.endsWith('.json') || !fs.statSync(requestedRunFile).isFile()) {
                        throw new Error('Resume path must name a saved .json run database');
                    }
                    runFile = requestedRunFile;
                    const journalFile = runFile.replace(/\.json$/i, '.jsonl');
                    database = fs.existsSync(journalFile)
                        ? await ProgramDatabase.loadFromJournal(journalFile)
                        : await ProgramDatabase.loadFromFile(runFile);
                    const savedManifestHash = database.getMetadata('manifestHash');
                    if (!savedManifestHash) {
                        throw new Error('This run has no manifest fingerprint and cannot be resumed safely. Start a new run to enable resume.');
                    }
                    if (savedManifestHash !== loaded.manifestHash) {
                        throw new Error('The manifest has changed since this run was saved; resume requires an exact manifest match.');
                    }
                    const savedRunId = database.getMetadata('runId');
                    if (typeof savedRunId !== 'string' || path.basename(runFile) !== `${savedRunId}.json`) {
                        throw new Error('Saved run ID does not match the resume filename.');
                    }
                    runId = savedRunId;
                } else {
                    runFile = path.join(loaded.projectRoot, 'runs', `${runId}.json`);
                }
                const explicitIterations = command.getOptionValueSource('iterations') === 'cli';
                const additionalIterations = options.resume && explicitIterations
                    ? Number(options.iterations)
                    : loaded.config.iterations;
                if (!Number.isInteger(additionalIterations) || additionalIterations < 1) {
                    throw new Error('Resume iteration count must be a positive integer.');
                }
                const savedConfig = database?.getMetadata('config');
                const modelWasProvided = command.getOptionValueSource('model') === 'cli';
                const model = options.resume && !modelWasProvided && typeof savedConfig?.llmModel === 'string'
                    ? savedConfig.llmModel
                    : options.model;
                const primaryFile = loaded.config.files[0];
                const initialSolution = loaded.initialFiles[primaryFile];
                const config: EvolutionConfig = {
                    initialSolution,
                    initialFiles: loaded.initialFiles,
                    primaryFile,
                    evaluator: new ManifestEvaluator(loaded, !options.unsandboxedTests),
                    problemDescription: loaded.config.goal,
                    iterations: additionalIterations,
                    evaluationRepeats: loaded.config.evaluationRepeats,
                    minImprovement: loaded.config.minImprovement,
                    noiseToleranceMultiplier: loaded.config.noiseToleranceMultiplier,
                    scoreWeights: loaded.config.scoreWeights,
                    llmModel: model,
                    temperature: 0.7,
                    promptTemplate: `# Optimization goal\n{PROBLEM_DESCRIPTION}\n\n# Complete current file snapshot\n{CURRENT_SOLUTION}\n\n# Evaluation results\n{PERFORMANCE_INFO}\n\n# Prior feedback\n{PREVIOUS_FEEDBACK}\n\nReturn the complete updated snapshot as one JSON object with a "files" object. Preserve every configured file path.`,
                    feedbackEnabled: true,
                    runMetadata: { manifestHash: loaded.manifestHash },
                    databaseOptions: { saveEnabled: true, savePath: runFile },
                };
                const evolver = new AlphaRevolve(config, baseUrl, apiKey, {
                    verbose: true, saveResults: true, checkSyntaxBeforeEval: false, runId, resume: Boolean(options.resume),
                }, database);
                const result = await evolver.run();
                const baseline = result.allCandidates.find(candidate => candidate.iteration === 0);
                if (!baseline) throw new Error('Run completed without a persisted baseline candidate');
                const artifacts = writeRunArtifacts(loaded, runId, baseline, result.bestCandidate);
                console.log(`Patch: ${artifacts.patchPath}`);
                console.log(`Report: ${artifacts.reportPath}`);
                return;
            }
            if (options.resume) throw new Error('--resume is only supported with --config for manifest-backed runs.');
            if (!targetFile) throw new Error('Provide a target file or use --config alpharevolve.json.');
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

            const scoreWeights = options.benchmarkCommand
                ? {
                    quality: Number(options.qualityWeight),
                    efficiency: Number(options.efficiencyWeight),
                }
                : { quality: 1, efficiency: 0 };
            if (!options.benchmarkCommand) {
                console.warn('No benchmark command configured; passing candidates will tie on fitness and speed cannot be optimized.');
            }
            const runner = new BenchmarkRunner({
                targetFilePath: absoluteTarget,
                testFilePath: absoluteTest,
                qualityWeight: scoreWeights.quality,
                efficiencyWeight: scoreWeights.efficiency,
                timeoutMs: Number(options.evaluationTimeout),
                benchmarkCommand: options.benchmarkCommand,
                benchmarkArgs: options.benchmarkArg,
                benchmarkWarmupRuns: Number(options.benchmarkWarmupRuns),
                benchmarkSampleRuns: Number(options.benchmarkRuns),
                allowNetwork: options.allowTestNetwork,
                sandbox: !options.unsandboxedTests,
            });

            const config: EvolutionConfig = {
                initialSolution,
                evaluator: runner,
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

${options.benchmarkCommand
    ? 'The goal is to lower the measured benchmark median while maintaining correctness.'
    : 'The goal is to maintain correctness. No performance benchmark is configured, so speed improvements cannot be ranked.'}

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

            const evolver = new AlphaRevolve(config, baseUrl, apiKey, {
                verbose: true,
                saveResults: true,
                checkSyntaxBeforeEval: !options.skipSyntaxCheck,
            });
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
