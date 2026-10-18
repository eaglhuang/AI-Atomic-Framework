/** Formatting only: these are the caller-supplied options consumed by open.
 * Do not forward close/recovery authority, output controls or ambient defaults.
 */
const OPEN_VALUE_FLAGS = new Set([
  '--cwd', '--profile', '--actor', '--task-id', '--output', '--template',
  '--goal', '--scope-path', '--validator', '--title', '--roster-index'
]);

// Avoid adding a second copy of recognizable credentials to a recovery hint.
// Suppress the whole command rather than render a silently changed command.
const CREDENTIAL_PATTERNS = [
  /\b(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*\S/i,
  /--?(?:token|secret|password|passwd|api[-_]key|access[-_]key|private[-_]key)(?:=|\s+)\S/i,
  /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{20,})\b/,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i
];

export interface TaskflowOpenCommand {
  readonly command: string | null;
  readonly shell: 'posix-sh';
  readonly reason: 'unrepresentable-value' | 'credential-bearing-value' | null;
}

/** Accept already validated taskflow argv. POSIX sh only, not cmd/PowerShell.
 * This function never evaluates arguments, reads environment values or runs a
 * command. Repeated caller flags stay in order, preserving parser semantics.
 */
export function buildTaskflowOpenCommand(argv: readonly string[]): TaskflowOpenCommand {
  const parts = ['node atm.mjs taskflow open --write'];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!OPEN_VALUE_FLAGS.has(flag)) continue;
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--') || value.includes('\0')) {
      return { command: null, shell: 'posix-sh', reason: 'unrepresentable-value' };
    }
    if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(value))) {
      return { command: null, shell: 'posix-sh', reason: 'credential-bearing-value' };
    }
    parts.push(flag, `'${value.replace(/'/g, "'\\''")}'`);
    index += 1;
  }
  parts.push('--json');
  return { command: parts.join(' '), shell: 'posix-sh', reason: null };
}
