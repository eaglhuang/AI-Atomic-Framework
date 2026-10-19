import { getCommandSpec } from '../command-specs.ts';

type SpecOption = { readonly flag: string; readonly subcommands?: readonly string[] };

/**
 * Many hand-written parsers reject an unknown flag with only
 * "<command> does not support option <flag>". Enrich that refusal from the
 * command spec so an agent can retry: the matching examples for the
 * subcommand it used, the nearest known flag, and the help command.
 * Details the parser already supplied are kept.
 */
export function withUnsupportedOptionHints(
  commandName: string,
  commandArgs: readonly string[],
  text: string,
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const flag = text.match(/does not support option (--[\w-]+)/)?.[1];
  const spec = flag ? getCommandSpec(commandName) : null;
  if (!flag || !spec) return details;
  const firstFlag = commandArgs.findIndex((arg) => arg.startsWith('-'));
  const path = (firstFlag < 0 ? commandArgs : commandArgs.slice(0, firstFlag)).slice(0, 2);
  const options = (spec.options ?? []) as readonly SpecOption[];
  const flags = options
    .filter((option) => !option.subcommands || option.subcommands.some((name) => path.includes(name)))
    .map((option) => option.flag);
  const prefix = ['node atm.mjs', commandName, ...path].join(' ');
  const examples = ((spec.examples ?? []) as readonly string[]).filter((example) => example.startsWith(`${prefix} `)).slice(0, 3);
  const nearest = flags
    .map((candidate) => ({ candidate, distance: editDistance(flag, candidate) }))
    .sort((left, right) => left.distance - right.distance)[0];
  return {
    unsupportedFlag: flag,
    ...(nearest && nearest.distance === 0
      ? { flagNotAcceptedHere: `${flag} is a known ${commandName} flag but ${path.join(' ') || commandName} does not accept it; follow the examples below.` }
      : nearest && nearest.distance <= 3 ? { didYouMean: nearest.candidate } : {}),
    ...(examples.length > 0 ? { examples } : {}),
    ...(flags.length <= 15 ? { allowedFlags: flags } : {}),
    helpCommand: `node atm.mjs ${commandName} --help --json`,
    ...(details ?? {})
  };
}

export function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}
