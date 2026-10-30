import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SandboxOptions {
  workspaceRoot: string;
  projectRoot?: string;
  allowNetwork?: boolean;
  enabled?: boolean;
}

function realPath(value: string): string {
  return fs.realpathSync(value);
}

function quoteProfile(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function addHomePathMetadataAncestors(paths: Set<string>, value: string, home: string): void {
  let current = path.resolve(value);
  while (current === home || current.startsWith(`${home}${path.sep}`)) {
    paths.add(current);
    if (current === home) break;
    current = path.dirname(current);
  }
}

function macProfile(options: SandboxOptions): string {
  const workspace = realPath(options.workspaceRoot);
  const project = options.projectRoot && fs.existsSync(options.projectRoot)
    ? realPath(options.projectRoot)
    : undefined;
  const home = realPath(os.homedir());
  const nodePath = realPath(process.execPath);
  const nodeBin = path.dirname(nodePath);
  const nodeRoot = path.basename(nodeBin) === 'bin' ? path.dirname(nodeBin) : nodeBin;
  const nodeModules = path.join(options.projectRoot || process.cwd(), 'node_modules');
  const resolvedNodeModules = fs.existsSync(nodeModules) ? realPath(nodeModules) : undefined;
  const readable = new Set([workspace, nodeRoot]);
  if (resolvedNodeModules) readable.add(resolvedNodeModules);
  const homeMetadataPaths = new Set<string>();
  for (const allowedPath of [nodePath, nodeRoot, resolvedNodeModules, project].filter(Boolean) as string[]) {
    addHomePathMetadataAncestors(homeMetadataPaths, allowedPath, home);
  }

  const rules = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${quoteProfile(workspace)}))`,
    `(deny file-read* (subpath ${quoteProfile(home)}))`,
  ];
  for (const directory of homeMetadataPaths) {
    rules.push(`(allow file-read-metadata (literal ${quoteProfile(directory)}))`);
  }
  if (resolvedNodeModules) rules.push(`(deny file-write* (subpath ${quoteProfile(resolvedNodeModules)}))`);
  if (project) rules.push(`(deny file-read* (subpath ${quoteProfile(project)}))`);
  for (const directory of readable) {
    rules.push(`(allow file-read* (subpath ${quoteProfile(directory)}))`);
  }
  if (!options.allowNetwork) rules.push('(deny network-outbound)');
  rules.push('(deny signal)', '(allow signal (target same-sandbox))');
  return rules.join('');
}

/** Wrap a command in an OS sandbox. Unsupported or unavailable backends fail closed. */
export function sandboxCommand(
  command: string,
  args: string[],
  options: SandboxOptions
): { command: string; args: string[] } {
  if (options.enabled === false) return { command, args };

  if (process.platform === 'darwin') {
    const profile = macProfile(options);
    return { command: 'sandbox-exec', args: ['-p', profile, command, ...args] };
  }

  throw new Error(
    `No execution sandbox backend is implemented for ${process.platform}. ` +
    'Use the explicit unsandboxed option only for trusted evaluation code.'
  );
}
