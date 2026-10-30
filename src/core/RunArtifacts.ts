import * as fs from 'fs';
import * as path from 'path';
import { CandidateSolution } from './types';
import { LoadedTaskManifest } from './TaskManifest';

const { createTwoFilesPatch } = require('diff') as {
  createTwoFilesPatch(oldName: string, newName: string, oldText: string, newText: string): string;
};

export function writeRunArtifacts(
  loaded: LoadedTaskManifest,
  runId: string,
  baseline: CandidateSolution,
  winner: CandidateSolution,
  outputDirectory = path.join(loaded.projectRoot, 'runs')
): { patchPath: string; reportPath: string } {
  if (!winner.files) throw new Error('Winning candidate has no file snapshot');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const patches = loaded.config.files
    .filter(file => baseline.files?.[file] !== winner.files![file])
    .map(file => createTwoFilesPatch(`a/${file}`, `b/${file}`, baseline.files?.[file] ?? '', winner.files![file]))
    .join('');
  const patchPath = path.join(outputDirectory, `${runId}.patch`);
  const reportPath = path.join(outputDirectory, `${runId}.report.md`);
  fs.writeFileSync(patchPath, patches, 'utf8');

  const benchmark = (candidate: CandidateSolution) => candidate.fitness.performanceMetrics?.benchmark;
  const baselineBenchmark = benchmark(baseline);
  const winnerBenchmark = benchmark(winner);
  const sampleText = winnerBenchmark?.samplesMs?.join(', ') ?? 'unavailable';
  const report = [
    `# Optimization run ${runId}`,
    '',
    loaded.config.goal,
    '',
    `Manifest SHA-256: \`${loaded.manifestHash}\``,
    `Files: ${loaded.config.files.map(file => `\`${file}\``).join(', ')}`,
    '',
    '| Candidate | Score | Quality | Efficiency | Benchmark median | MAD |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    `| Baseline | ${baseline.fitness.finalScore.toFixed(6)} | ${baseline.fitness.qualityScore.toFixed(4)} | ${baseline.fitness.efficiencyScore.toFixed(4)} | ${baselineBenchmark?.medianMs?.toFixed(3) ?? 'n/a'} ms | ${baselineBenchmark?.madMs?.toFixed(3) ?? 'n/a'} ms |`,
    `| Winner | ${winner.fitness.finalScore.toFixed(6)} | ${winner.fitness.qualityScore.toFixed(4)} | ${winner.fitness.efficiencyScore.toFixed(4)} | ${winnerBenchmark?.medianMs?.toFixed(3) ?? 'n/a'} ms | ${winnerBenchmark?.madMs?.toFixed(3) ?? 'n/a'} ms |`,
    '',
    `Correctness: ${winner.evaluation?.status ?? 'unknown'}${winner.evaluation?.reason ? ` — ${winner.evaluation.reason}` : ''}`,
    `Benchmark samples (ms): ${sampleText}`,
    '',
    'Review the patch, then apply it from the project root:',
    '',
    `\`\`\`sh`,
    `git apply --check '${path.relative(loaded.projectRoot, patchPath)}'`,
    `git apply '${path.relative(loaded.projectRoot, patchPath)}'`,
    `\`\`\``,
  ].join('\n');
  fs.writeFileSync(reportPath, report, 'utf8');
  return { patchPath, reportPath };
}
