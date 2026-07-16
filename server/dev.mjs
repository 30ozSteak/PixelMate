import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const portIsOpen = (port) => new Promise((resolve) => { const socket = createConnection({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.setTimeout(400, () => { socket.destroy(); resolve(false); }); });
const children = [];

if (await portIsOpen(8787)) console.info('[pixelmate] reusing the bridge already listening on http://127.0.0.1:8787');
else children.push(spawn(npm, ['run', 'bridge'], { stdio: 'inherit', env: process.env }));
children.push(spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1'], { stdio: 'inherit', env: process.env }));

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }

  setTimeout(() => process.exit(exitCode), 250);
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('[pixelmate] failed to start a development process', error);
    stop(1);
  });

  child.on('exit', (code, signal) => {
    if (stopping || signal === 'SIGTERM') return;
    console.error(`[pixelmate] a development process stopped (${code ?? signal})`);
    stop(code || 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
