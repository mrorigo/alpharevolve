import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { sandboxCommand } from '../src/core/ExecutionSandbox';
import { runProcess } from '../src/core/ProcessRunner';

const probeSource = String.raw`
const fs = require('fs');
const net = require('net');
const [mode, target, portText] = process.argv.slice(2);
function denied(operation) {
  try { operation(); process.exit(41); }
  catch (error) {
    if (error && ['EACCES', 'EPERM'].includes(error.code)) process.exit(0);
    console.error(error);
    process.exit(42);
  }
}
if (mode === 'workspace') {
  fs.writeFileSync(target, 'workspace-write-ok');
  if (fs.readFileSync(target, 'utf8') !== 'workspace-write-ok') process.exit(42);
  process.exit(0);
}
if (mode === 'read-allowed') {
  if (!fs.readFileSync(target, 'utf8')) process.exit(42);
  process.exit(0);
}
if (mode === 'read-denied') return denied(() => fs.readFileSync(target, 'utf8'));
if (mode === 'write-allowed') {
  fs.writeFileSync(target, 'project-write-ok');
  process.exit(0);
}
if (mode === 'write-denied') return denied(() => fs.writeFileSync(target, 'sandbox-escaped'));
if (mode === 'network-allowed' || mode === 'network-denied') {
  const shouldConnect = mode === 'network-allowed';
  const socket = net.connect(Number(portText), '127.0.0.1');
  socket.once('connect', () => {
    if (!shouldConnect) {
      socket.destroy();
      process.exit(41);
    }
    socket.resume();
    socket.end();
    socket.once('close', () => process.exit(0));
  });
  socket.once('error', error => {
    const permissionError = error && ['EACCES', 'EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code);
    process.exit(!shouldConnect && permissionError ? 0 : 42);
  });
  setTimeout(() => process.exit(42), 2500);
  return;
}
console.error('Unknown probe mode:', mode);
process.exit(43);
`;

interface ProbeOptions {
  mode: string;
  target?: string;
  port?: number;
  sandboxed: boolean;
  workspace: string;
  projectRoot: string;
  runnerPath: string;
}

async function runProbe(options: ProbeOptions): Promise<void> {
  const targetModes = new Set(['workspace', 'read-allowed', 'read-denied', 'write-allowed', 'write-denied']);
  const networkModes = new Set(['network-allowed', 'network-denied']);
  if (targetModes.has(options.mode) && !options.target) {
    throw new Error(`Probe ${options.mode} requires a target path`);
  }
  if (networkModes.has(options.mode) && options.port === undefined) {
    throw new Error(`Probe ${options.mode} requires a loopback listener port`);
  }
  // Keep argv positions stable when probes do not need a file target.
  const args = [options.runnerPath, options.mode, options.target || '', String(options.port ?? 0)];
  const wrapped = sandboxCommand(process.execPath, args, {
    workspaceRoot: options.workspace,
    projectRoot: options.projectRoot,
    allowNetwork: false,
    enabled: options.sandboxed,
  });
  const result = await runProcess(wrapped.command, wrapped.args, {
    cwd: options.workspace,
    env: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: options.workspace,
      TMPDIR: options.workspace,
      TMP: options.workspace,
      TEMP: options.workspace,
    },
    timeoutMs: 5000,
    stdio: 'pipe',
  });

  if (/sandbox_(?:apply|init)|operation not permitted/i.test(result.stderr)) {
    throw new Error(
      `macOS refused to apply the sandbox profile (${result.stderr.trim()}). ` +
      'Run this acceptance check in a session that is permitted to invoke sandbox-exec.'
    );
  }
  assert.equal(
    result.timedOut ? 'timeout' : result.exitCode,
    0,
    `${options.sandboxed ? 'Sandboxed' : 'Unsandboxed'} probe ${options.mode} failed` +
      `${result.stderr ? `: ${result.stderr.trim()}` : ''}`
  );
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', error => reject(new Error(`Cannot start the loopback network probe: ${error.message}`)));
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback listener did not bind to a TCP port');
  return address.port;
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(`This acceptance check targets macOS sandbox-exec; current platform is ${process.platform}.`);
  }

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alpharevolve-sandbox-project-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'alpharevolve-sandbox-workspace-'));
  const projectCanary = path.join(projectRoot, 'project-canary.txt');
  const homeCanary = path.join(os.homedir(), `.alpharevolve-sandbox-canary-${randomUUID()}`);
  const workspaceCanary = path.join(workspace, 'workspace-canary.txt');
  const runnerPath = path.join(workspace, 'probe.cjs');
  const listener = net.createServer(socket => {
    socket.on('error', () => undefined);
    socket.end('connected');
  });

  try {
    fs.writeFileSync(projectCanary, 'project-canary');
    try {
      fs.writeFileSync(homeCanary, 'home-canary', { mode: 0o600 });
    } catch (error) {
      throw new Error(`Cannot create the temporary home canary at ${homeCanary}: ${String(error)}`);
    }
    fs.writeFileSync(runnerPath, probeSource, { mode: 0o600 });
    const port = await listen(listener);
    const probe = (mode: string, target?: string, sandboxed = false) => runProbe({
      mode, target, port, sandboxed, workspace, projectRoot, runnerPath,
    });

    // Establish that each canary operation works without the sandbox.
    await probe('workspace', workspaceCanary);
    await probe('read-allowed', projectCanary);
    await probe('write-allowed', projectCanary);
    await probe('read-allowed', homeCanary);
    await probe('network-allowed');

    // Confirm intended access inside the workspace and denials outside it.
    await probe('workspace', workspaceCanary, true);
    await probe('read-denied', projectCanary, true);
    await probe('write-denied', projectCanary, true);
    await probe('read-denied', homeCanary, true);
    await probe('network-denied', undefined, true);

    assert.equal(fs.readFileSync(projectCanary, 'utf8'), 'project-write-ok');
    console.log('PASS: workspace access allowed; project/home access and outbound network blocked.');
  } finally {
    if (listener.listening) {
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(homeCanary, { force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
