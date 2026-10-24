#!/usr/bin/env node
/**
 * 以工作樹擁有者的身份聽一個 Unix socket。
 * session 只送 file 與 patch。這個行程再呼叫 atm-write.mjs，由它走公開 CLI 0.1.22 的 apply-live。
 * 不接受任意指令。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    process.stderr.write(`steward-daemon: 缺少 ${name}\n`);
    process.exit(2);
  }
  return process.argv[index + 1];
}

const sockPath = arg('--sock');
const cwd = path.resolve(arg('--cwd'));
const script = path.resolve(arg('--script'));
const inbound = path.join(cwd, '.prereg-smoke', 'inbound');
mkdirSync(inbound, { recursive: true });
try {
  unlinkSync(sockPath);
} catch {
  // 第一次啟動沒有舊 socket。
}

function reply(socket, payload) {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(payload)}\n`);
}

function safeToken(value, fallback) {
  const text = typeof value === 'string' && value && !value.startsWith('-') ? value : fallback;
  return text;
}

function safeFile(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('-') || value.includes('..')) {
    return null;
  }
  if (!/^[\w./-]+$/.test(value)) return null;
  return value;
}

const server = net.createServer({ allowHalfOpen: true }, (socket) => {
  let buf = '';
  let handled = false;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    if (handled) return;
    buf += chunk;
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    handled = true;
    socket.pause();
    let req;
    try {
      req = JSON.parse(buf.slice(0, nl));
    } catch (error) {
      reply(socket, { exitCode: 1, stdout: '', stderr: `bad request: ${error.message}\n` });
      return;
    }
    const file = safeFile(req.file);
    if (!file || typeof req.patch !== 'string') {
      reply(socket, { exitCode: 1, stdout: '', stderr: '拒絕這個寫入請求\n' });
      return;
    }
    if (req.sessionSlot != null && (typeof req.sessionSlot !== 'string' || !/^[A-Za-z0-9_-]+$/.test(req.sessionSlot))) {
      reply(socket, { exitCode: 1, stdout: '', stderr: 'Invalid session slot\n' });
      return;
    }
    if (req.sessionBaseCommit != null && (typeof req.sessionBaseCommit !== 'string' || !/^[0-9a-f]{40,64}$/.test(req.sessionBaseCommit))) {
      reply(socket, { exitCode: 1, stdout: '', stderr: 'Invalid session base commit\n' });
      return;
    }
    const id = randomBytes(8).toString('hex');
    const patchPath = path.join(inbound, `${id}.patch`);
    writeFileSync(patchPath, req.patch);
    const args = [
      script,
      file,
      patchPath,
      '--cwd', cwd,
      '--actor', safeToken(req.actor, 'prereg-session'),
      '--task', safeToken(req.task, 'prereg'),
      '--message', safeToken(req.message, 'prereg-v3-smoke'),
      '--attempt', String(Number.isInteger(req.attempt) && req.attempt > 0 ? req.attempt : 1)
    ];
    if (req.sessionSlot != null) args.push('--session-slot', req.sessionSlot);
    if (req.sessionBaseCommit != null) args.push('--session-base-commit', req.sessionBaseCommit);
    if (req.baseText != null) {
      const basePath = path.join(inbound, `${id}.base`);
      writeFileSync(basePath, String(req.baseText));
      args.push('--base-file', basePath);
    }
    const env = { ...process.env };
    delete env.PREREG_STEWARD_SOCK;
    delete env.PREREG_SESSION_SLOT;
    delete env.PREREG_SESSION_BASE_COMMIT;
    const child = spawn(process.execPath, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    child.on('error', (error) => {
      reply(socket, { exitCode: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('close', (code) => {
      reply(socket, { exitCode: code ?? 1, stdout, stderr });
    });
  });
});

function shutdown() {
  server.close();
  try {
    unlinkSync(sockPath);
  } catch {
    // socket 可能已經不在。
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(sockPath, () => {
  chmodSync(sockPath, 0o666);
  writeFileSync(path.join(cwd, '.prereg-smoke', 'daemon.pid'), `${process.pid}\n`);
  process.stdout.write(`steward listening ${sockPath} pid=${process.pid}\n`);
});
