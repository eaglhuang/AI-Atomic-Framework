import { CliError } from '../shared.ts';

/** Adoption is an explicit exact-task operation, never a prompt or scope override. */
export function extractUnownedWipAdoption(argv: readonly string[]): { argv: string[]; enabled: boolean } {
  const flag = '--adopt-unowned-wip';
  const names = argv.map(value => value.split('=', 1)[0]);
  const enabled = names.includes(flag);
  if (!enabled) return { argv: [...argv], enabled: false };
  const count = (option: string) => names.filter(value => value === option).length;
  const taskIndex = argv.indexOf('--task');
  const task = taskIndex < 0 ? undefined : argv[taskIndex + 1];
  const conflicting = ['--files', '--tasks', '--prompt', '--intent'].filter(option => names.includes(option));
  if (!argv.includes(flag) || !argv.includes('--claim') || count(flag) !== 1 || count('--claim') !== 1 || count('--task') !== 1
    || !task || task.startsWith('-') || task.includes(',') || conflicting.length > 0) {
    throw new CliError('ATM_CLI_USAGE',
      '--adopt-unowned-wip requires --claim and one explicit --task, with no --files, --tasks, --prompt, --intent or duplicate selectors.',
      { exitCode: 2 });
  }
  return { argv: argv.filter(value => value !== flag), enabled: true };
}
