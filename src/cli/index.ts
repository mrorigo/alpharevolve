#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AlphaRevolve } from '../core/AlphaRevolve';
import { EvolutionConfig } from '../core/types';
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
    .description('Validate an optimization manifest without running commands or calling a model')
    .action((options) => {
        try {
            const loaded = loadTaskManifest(options.config);
            const checks = inspectTask(loaded);
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
            console.log(`  Sandbox: ${config.sandbox ? 'enabled' : 'disabled by manifest'}`);
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
    .requiredOption('-c, --config <path>', 'Path to an alpharevolve.json optimization manifest')
    .option('--resume <runFile>', 'Resume a saved manifest run from runs/<runId>.json')
    .option('--additional-iterations <number>', 'Additional iterations when resuming (defaults to manifest iterations)')
    .option('-m, --model <string>', 'LLM Model to use', process.env.OPENAI_MODEL || 'gpt-3.5-turbo')
    .option('--api-key <string>', 'API Key (or set OPENAI_API_KEY env var)')
    .option('--base-url <string>', 'API Base URL (or set OPENAI_BASE_URL env var)')
    .description('Optimize the source files and task defined by a manifest')
    .action(async (options, command) => {
        try {
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
                if (options.additionalIterations) {
                    throw new Error('--additional-iterations can only be used together with --resume.');
                }
                runFile = path.join(loaded.projectRoot, 'runs', `${runId}.json`);
            }
            const additionalIterations = options.resume && options.additionalIterations
                ? Number(options.additionalIterations)
                : loaded.config.iterations;
            if (!Number.isInteger(additionalIterations) || additionalIterations < 1) {
                throw new Error('Iteration count must be a positive integer.');
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
                evaluator: new ManifestEvaluator(loaded),
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
                verbose: true, saveResults: true, checkSyntaxBeforeEval: true, runId, resume: Boolean(options.resume),
            }, database);
            const result = await evolver.run();
            const baseline = result.allCandidates.find(candidate => candidate.iteration === 0);
            if (!baseline) throw new Error('Run completed without a persisted baseline candidate');
            const artifacts = writeRunArtifacts(loaded, runId, baseline, result.bestCandidate);
            console.log(`Patch: ${artifacts.patchPath}`);
            console.log(`Report: ${artifacts.reportPath}`);

        } catch (error) {
            console.error('Optimization failed:', error);
            process.exit(1);
        }
    });

program.parse(process.argv);
