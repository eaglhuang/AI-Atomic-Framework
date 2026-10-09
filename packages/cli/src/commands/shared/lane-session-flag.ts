const laneSessionFlags = new Set(['--lane-session', '--lane-session-id']);
// These commands already parse the flag themselves; they still get the env.
const commandsOwningFlag = new Set(['lane', 'write-ticket', 'telemetry']);

/**
 * `--lane-session <id>` is the per-invocation form of ATM_LANE_SESSION_ID.
 * Agents usually run every command in a fresh shell, so an exported lane id
 * from `next --claim` is lost before commit, evidence or close. The flag sets
 * the same environment value for this invocation only; lane capability checks
 * still verify the id against the live claim exactly as for the env var.
 */
export function applyLaneSessionFlagFromArgv(argv: readonly string[]): string[] {
  const [commandName] = argv;
  invocationLane = null;
  const keepFlag = commandsOwningFlag.has(commandName ?? '');
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const inline = arg.match(/^(--lane-session(?:-id)?)=(.+)$/);
    const value = inline ? inline[2] : laneSessionFlags.has(arg) ? argv[index + 1] : undefined;
    if (value === undefined || value.startsWith('-')) {
      result.push(arg);
      continue;
    }
    process.env.ATM_LANE_SESSION_ID = value.trim();
    invocationLane = { laneSessionId: value.trim(), actorId: readActorFromArgv(argv) };
    if (keepFlag) {
      result.push(arg);
      if (!inline) result.push(argv[index + 1]);
    }
    if (!inline) index += 1;
  }
  return result;
}

// The lane id and actor named on this invocation's command line, so commands
// ATM prints back for the same actor can carry the same lane.
let invocationLane: { readonly laneSessionId: string; readonly actorId: string | null } | null = null;

function readActorFromArgv(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const inline = argv[index].match(/^--actor=(.+)$/);
    if (inline) return inline[1].trim();
    if (argv[index] === '--actor' && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1].trim();
  }
  return null;
}

/**
 * Commands ATM prints for the agent to run next (blocker requiredCommand,
 * playbook steps, nextCommand) are often built without the lane. Run as
 * printed in a fresh shell, a mutation then fails with
 * ATM_LANE_BORROWED_ACTOR_BLOCKED. When this invocation named a lane, append
 * it to every printed `node atm.mjs ...` command for the same actor that
 * lacks one. Commands for other actors are left untouched.
 */
export function carryLaneSessionIntoPrintedCommands<T>(value: T): T {
  const lane = invocationLane;
  if (!lane || !lane.actorId) return value;
  const actorPattern = new RegExp(`\\s--actor\\s+(?:"${escapeRegExp(lane.actorId)}"|${escapeRegExp(lane.actorId)})(?=\\s|$)`);
  const rewrite = (text: string): string => {
    if (!text.startsWith('node atm.mjs ') || /--lane-session(?:-id)?[\s=]/.test(text) || !actorPattern.test(text)) return text;
    return / --json$/.test(text)
      ? `${text.slice(0, -' --json'.length)} --lane-session ${lane.laneSessionId} --json`
      : `${text} --lane-session ${lane.laneSessionId}`;
  };
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') return rewrite(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)]));
    }
    return node;
  };
  return visit(value) as T;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
