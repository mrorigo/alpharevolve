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
  const relative = path.relative(root, path.resolve(filename));
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

  constructor(
    readonly projectRoot: string,
    targetFilePath: string,
    testFilePath: string
  ) {
    const absoluteProjectRoot = fs.realpathSync(projectRoot);
    const targetRelative = relativeWithin(absoluteProjectRoot, targetFilePath);
    const testRelative = relativeWithin(absoluteProjectRoot, testFilePath);
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

      this.targetFilePath = path.join(this.root, targetRelative);
      this.testFilePath = path.join(this.root, testRelative);
      this.metricsFilePath = path.join(this.root, '.alpha-metrics.json');
      this.homePath = path.join(this.root, '.evaluation-home');
      this.tempPath = path.join(this.root, '.evaluation-tmp');
      fs.mkdirSync(path.dirname(this.targetFilePath), { recursive: true });
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

  cleanup(): void {
    if (this.root && fs.existsSync(this.root)) {
      fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}
