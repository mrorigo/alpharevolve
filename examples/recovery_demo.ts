import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AlphaRevolve } from '../src/core/AlphaRevolve';
import { LlmService } from '../src/core/llmService';
import { FeedbackService } from '../src/core/feedbackService';
import { ProgramDatabase } from '../src/core/ProgramDatabase';
import { EvolutionConfig } from '../src/core/types';

async function main(): Promise<void> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpharevolve-recovery-demo-'));
  const snapshotPath = path.join(outputDir, 'run.json');
  const journalPath = path.join(outputDir, 'run.jsonl');
  const initialSolution = 'function answer() { return 1; }';
  const improvedSolution = 'function answer() { return 2; }';

  const config: EvolutionConfig = {
    initialSolution,
    problemDescription: 'Return the improved deterministic example value.',
    iterations: 1,
    llmModel: 'demo',
    promptTemplate: '{CURRENT_SOLUTION}\n{PERFORMANCE_INFO}\n{PREVIOUS_FEEDBACK}',
    feedbackEnabled: false,
    fitnessFunction: async solution => {
      const score = solution.includes('return 2') ? 1 : 0.5;
      return { qualityScore: score, efficiencyScore: score, finalScore: score };
    },
    databaseOptions: { saveEnabled: true, saveFrequency: 'end', savePath: snapshotPath },
  };
  const llm = {
    generateCode: async () => improvedSolution,
  } as unknown as LlmService;
  const feedback = {} as FeedbackService;
  const runId = `recovery-demo-${Date.now()}`;
  const evolver = new AlphaRevolve(config, 'https://example.invalid/v1', 'demo-key', {
    verbose: false,
    saveResults: true,
    runId,
  }, undefined, llm, feedback);

  const result = await evolver.run();
  const snapshot = await ProgramDatabase.loadFromFile(snapshotPath);
  const replayed = await ProgramDatabase.loadFromJournal(journalPath);

  assert.equal(result.allCandidates.length, 2);
  assert.equal(snapshot.count, 2);
  assert.equal(replayed.count, 2);
  assert.equal(snapshot.getBestProgram()?.solution, improvedSolution);
  assert.equal(replayed.getBestProgram()?.solution, improvedSolution);

  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Journal:  ${journalPath}`);
  console.log(`Recovered ${replayed.count} candidates; best score ${replayed.getBestProgram()?.fitness.finalScore}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
