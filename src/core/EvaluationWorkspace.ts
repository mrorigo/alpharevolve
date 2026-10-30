import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

const EXCLUDED_ENTRIES = new Set([
  '.git',
  'node_modules',
  'downstream',
  'runs',
  'coverage',
  '.aws',
  '.ssh',
  '.codex',
  '.agents',
  '.claude',
  '.config',
]);

function excluded(name: string): boolean {
  return EXCLUDED_ENTRIES.has(name) || name.startsWith('.env');
}

function relativeWithin(root: string, filename: string): string {
  const resolvedFilename = fs.realpathSync(path.resolve(filename));
  const relative = path.relative(root, resolvedFilename);
  if (!relative || relative === '.' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Evaluation file must be inside the project root: ${filename}`);
  }
  if (relative.split(path.sep).some(excluded)) {
    throw new Error(`Evaluation file is inside an excluded project path: ${filename}`);
  }
  return relative;
}

/** A disposable project copy for one candidate evaluation. */
export class EvaluationWorkspace {
  readonly root: string;
  readonly targetFilePath: string;
  readonly testFilePath: string;
  readonly metricsFilePath: string;
  readonly homePath: string;
  readonly tempPath: string;
  readonly targetFilePaths: string[];
  readonly targetRelativePaths: string[];

  constructor(
    readonly projectRoot: string,
    targetFilePath: string | string[],
    testFilePath?: string
  ) {
    const absoluteProjectRoot = fs.realpathSync(projectRoot);
    const requestedTargets = Array.isArray(targetFilePath) ? targetFilePath : [targetFilePath];
    if (requestedTargets.length === 0) throw new Error('At least one target file is required');
    this.targetRelativePaths = requestedTargets.map(filename => relativeWithin(absoluteProjectRoot, filename));
    if (new Set(this.targetRelativePaths).size !== this.targetRelativePaths.length) {
      throw new Error('Target file paths must be unique');
    }
    const testRelative = testFilePath ? relativeWithin(absoluteProjectRoot, testFilePath) : undefined;
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpharevolve-evaluation-'));

    try {
      fs.cpSync(absoluteProjectRoot, this.root, {
        recursive: true,
        dereference: true,
        filter: source => {
          const relative = path.relative(absoluteProjectRoot, source);
          if (!relative) return true;
          if (relative.split(path.sep).some(excluded)) return false;
          try {
            if (fs.lstatSync(source).isSymbolicLink()) return false;
          } catch {
            return false;
          }
          return true;
        },
      });

      const originalModules = path.join(absoluteProjectRoot, 'node_modules');
      if (fs.existsSync(originalModules)) {
        fs.symlinkSync(originalModules, path.join(this.root, 'node_modules'), 'dir');
      }

      this.targetFilePaths = this.targetRelativePaths.map(relative => path.join(this.root, relative));
      this.targetFilePath = this.targetFilePaths[0];
      this.testFilePath = testRelative ? path.join(this.root, testRelative) : this.targetFilePath;
      this.metricsFilePath = path.join(this.root, '.alpha-metrics.json');
      this.homePath = path.join(this.root, '.evaluation-home');
      this.tempPath = path.join(this.root, '.evaluation-tmp');
      for (const targetPath of this.targetFilePaths) fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.mkdirSync(this.homePath);
      fs.mkdirSync(this.tempPath);
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  writeCandidate(solution: string): void {
    fs.writeFileSync(this.targetFilePath, solution, 'utf8');
  }

  /** Write a complete snapshot whose keys exactly match the configured target set. */
  writeCandidates(files: Record<string, string>): void {
    const actualPaths = Object.keys(files).sort();
    const expectedPaths = [...this.targetRelativePaths].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      throw new Error('Candidate file paths must exactly match the configured target files');
    }
    for (const relative of this.targetRelativePaths) {
      const absolute = path.resolve(this.root, relative);
      const workspaceRelative = path.relative(this.root, absolute);
      if (workspaceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(workspaceRelative)) {
        throw new Error(`Candidate file escapes the evaluation workspace: ${relative}`);
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, files[relative], 'utf8');
    }
  }

  cleanup(): void {
    if (this.root && fs.existsSync(this.root)) {
      fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
