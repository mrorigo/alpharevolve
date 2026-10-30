import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoadedTaskManifest, TaskCommand } from './TaskManifest';
import { sandboxCommand } from './ExecutionSandbox';

export interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

function executablePath(command: string, projectRoot: string): string | undefined {
  const hasPath = command.includes(path.sep) || command.startsWith('.');
  const candidates = hasPath
    ? [path.resolve(projectRoot, command)]
    : (process.env.PATH || '').split(path.delimiter).map(directory => path.join(directory, command));
  return candidates.find(candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function checkCommand(spec: TaskCommand, name: string, projectRoot: string): PreflightCheck {
  const resolved = executablePath(spec.command, projectRoot);
  return {
    name,
    passed: Boolean(resolved),
    detail: resolved
      ? `${spec.command} resolves to ${resolved}; ${spec.args.length} argument(s)`
      : `Cannot find executable ${spec.command} from the project directory or PATH`,
  };
}

/** Check manifest commands and the selected sandbox backend without running user commands. */
export function inspectTask(loaded: LoadedTaskManifest): PreflightCheck[] {
  const checks = [
    { name: 'Manifest', passed: true, detail: `Valid version 1 manifest: ${loaded.manifestPath}` },
    {
      name: 'Files',
      passed: true,
      detail: `${loaded.config.files.length} source file(s) exist and are inside the project root`,
    },
    checkCommand(loaded.config.correctness, 'Correctness command', loaded.projectRoot),
    checkCommand(loaded.config.benchmark, 'Benchmark command', loaded.projectRoot),
  ];

  if (!loaded.config.sandbox) {
    checks.push({ name: 'Sandbox', passed: true, detail: 'Disabled by manifest configuration' });
  } else if (process.platform !== 'darwin') {
    checks.push({
      name: 'Sandbox',
      passed: false,
      detail: `No sandbox backend is available on ${process.platform}; set sandbox to false only for trusted commands`,
    });
  } else {
    const sandboxExecutable = executablePath('sandbox-exec', loaded.projectRoot);
    if (!sandboxExecutable) {
      checks.push({ name: 'Sandbox', passed: false, detail: 'macOS sandbox-exec was not found on PATH' });
    } else {
      try {
        sandboxCommand('true', [], {
          workspaceRoot: os.tmpdir(),
          projectRoot: loaded.projectRoot,
          allowNetwork: loaded.config.allowNetwork,
          enabled: loaded.config.sandbox,
        });
        checks.push({ name: 'Sandbox', passed: true, detail: `macOS sandbox backend available: ${sandboxExecutable}` });
      } catch (error) {
        checks.push({ name: 'Sandbox', passed: false, detail: String(error) });
      }
    }
  }

  return checks;
}
