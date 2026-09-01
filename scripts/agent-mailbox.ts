import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type MailboxRegistration = {
  root: string;
  host: string;
  editor: string;
  session: string;
  address: string;
  inboxPath: string;
  acknowledgementsPath: string;
};

export type MailMessage = {
  id: string;
  path: string;
  raw: string;
};

export type MailDelivery = {
  path: string;
  id: string;
};

export function registerMailbox(input: {
  root: string;
  host: string;
  editor: string;
  session?: string;
}): MailboxRegistration {
  const root = path.resolve(input.root);
  const host = requireSegment(input.host, 'host');
  const editor = requireSegment(input.editor, 'editor');
  const session = requireSegment(input.session || randomUUID(), 'session');
  const mailboxPath = path.join(root, 'mailboxes', encodeSegment(host), encodeSegment(editor), encodeSegment(session));
  const inboxPath = path.join(mailboxPath, 'inbox');
  const acknowledgementsPath = path.join(mailboxPath, 'acknowledgements');
  mkdirSync(inboxPath, { recursive: true });
  mkdirSync(acknowledgementsPath, { recursive: true });

  return {
    root,
    host,
    editor,
    session,
    address: `atm-mail://${encodeSegment(host)}/${encodeSegment(editor)}/${encodeSegment(session)}`,
    inboxPath,
    acknowledgementsPath
  };
}

export function resolveMailbox(root: string, address: string): MailboxRegistration {
  const match = /^atm-mail:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(address);
  if (!match) {
    throw new Error(`Invalid mailbox address: ${address}`);
  }

  return registerMailbox({
    root,
    host: decodeURIComponent(match[1]),
    editor: decodeURIComponent(match[2]),
    session: decodeURIComponent(match[3])
  });
}

export function deliverMessage(input: {
  from: string;
  to: MailboxRegistration;
  body: string;
  id?: string;
  taskId?: string;
  scope?: string[];
  evidence?: string[];
  inReplyTo?: string;
  command?: never;
}): MailDelivery {
  const id = requireMessageId(input.id || randomUUID());
  const finalPath = messagePath(input.to, id);
  if (existsSync(finalPath)) {
    return { path: finalPath, id };
  }

  const temporaryPath = path.join(input.to.inboxPath, `.partial-${id}-${randomUUID()}.md`);
  writeFileSync(temporaryPath, renderMessage({ ...input, id }), 'utf8');
  renameSync(temporaryPath, finalPath);
  return { path: finalPath, id };
}

export function listInbox(mailbox: MailboxRegistration): MailMessage[] {
  if (!existsSync(mailbox.inboxPath)) {
    return [];
  }

  return readdirSync(mailbox.inboxPath)
    .map((name) => ({ name, id: readMessageId(name) }))
    .filter((entry): entry is { name: string; id: string } => entry.id !== null)
    .filter((entry) => !existsSync(acknowledgementPath(mailbox, entry.id)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const filePath = path.join(mailbox.inboxPath, entry.name);
      return { id: entry.id, path: filePath, raw: readFileSync(filePath, 'utf8') };
    });
}

export function acknowledgeMessage(mailbox: MailboxRegistration, messageId: string): { status: 'acknowledged' | 'already-acknowledged' } {
  const id = requireMessageId(messageId);
  if (!existsSync(messagePath(mailbox, id))) {
    throw new Error(`Cannot acknowledge missing mailbox message: ${id}`);
  }

  const finalPath = acknowledgementPath(mailbox, id);
  if (existsSync(finalPath)) {
    return { status: 'already-acknowledged' };
  }

  const temporaryPath = `${finalPath}.${randomUUID()}.partial`;
  writeFileSync(temporaryPath, `${id}\n`, 'utf8');
  if (existsSync(finalPath)) {
    rmSync(temporaryPath, { force: true });
    return { status: 'already-acknowledged' };
  }
  renameSync(temporaryPath, finalPath);
  return { status: 'acknowledged' };
}

function renderMessage(input: {
  from: string;
  to: MailboxRegistration;
  body: string;
  id: string;
  taskId?: string;
  scope?: string[];
  evidence?: string[];
  inReplyTo?: string;
}): string {
  const lines = [
    '---',
    `id: ${JSON.stringify(input.id)}`,
    `from: ${JSON.stringify(input.from)}`,
    `to: ${JSON.stringify(input.to.address)}`
  ];
  if (input.taskId) lines.push(`taskId: ${JSON.stringify(input.taskId)}`);
  if (input.scope?.length) lines.push(`scope: ${JSON.stringify(input.scope)}`);
  if (input.evidence?.length) lines.push(`evidence: ${JSON.stringify(input.evidence)}`);
  if (input.inReplyTo) lines.push(`inReplyTo: ${JSON.stringify(input.inReplyTo)}`);
  lines.push('---', '', input.body);
  return `${lines.join('\n')}\n`;
}

function messagePath(mailbox: MailboxRegistration, id: string): string {
  return path.join(mailbox.inboxPath, `message-${id}.md`);
}

function acknowledgementPath(mailbox: MailboxRegistration, id: string): string {
  return path.join(mailbox.acknowledgementsPath, `message-${id}.ack`);
}

function readMessageId(fileName: string): string | null {
  const match = /^message-([A-Za-z0-9._-]+)\.md$/.exec(fileName);
  return match ? match[1] : null;
}

function requireMessageId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error('Mailbox message id must contain only letters, digits, dot, underscore, or hyphen.');
  }
  return value;
}

function requireSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error(`Mailbox ${label} must be a non-empty path-safe segment.`);
  }
  return value;
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function runMailboxCli(argv: string[]): void {
  const action = argv[0];
  const root = readOption(argv, '--root');
  if (action === 'register') {
    writeResult(registerMailbox({
      root,
      host: readOption(argv, '--host'),
      editor: readOption(argv, '--editor'),
      session: optionalOption(argv, '--session')
    }));
    return;
  }

  const mailbox = resolveMailbox(root, readOption(argv, '--address'));
  if (action === 'inbox') {
    writeResult(listInbox(mailbox));
    return;
  }
  if (action === 'ack') {
    writeResult(acknowledgeMessage(mailbox, readOption(argv, '--message')));
    return;
  }
  if (action === 'send') {
    writeResult(deliverMessage({
      from: readOption(argv, '--from'),
      to: mailbox,
      body: readOption(argv, '--body'),
      id: optionalOption(argv, '--id'),
      taskId: optionalOption(argv, '--task-id'),
      scope: splitOption(optionalOption(argv, '--scope')),
      evidence: splitOption(optionalOption(argv, '--evidence')),
      inReplyTo: optionalOption(argv, '--in-reply-to')
    }));
    return;
  }

  throw new Error('Usage: agent-mailbox <register|send|inbox|ack> --root <path> ...');
}

function readOption(argv: string[], name: string): string {
  const value = optionalOption(argv, name);
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}

function optionalOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function splitOption(value: string | undefined): string[] | undefined {
  return value ? value.split(',').filter(Boolean) : undefined;
}

function writeResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/agent-mailbox.ts')) {
  try {
    runMailboxCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
