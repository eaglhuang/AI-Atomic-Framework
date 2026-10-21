export interface AtmResultLine {
  readonly step: string;
  readonly status: 'ok' | 'fail';
  readonly code: string;
  readonly log: string;
  readonly hint: string;
}

export function formatAtmResultLine(result: AtmResultLine): string {
  if (!/^[\w-]+$/.test(result.step) || !/^[A-Z][A-Z0-9_]*$/.test(result.code)
    || !['ok', 'fail'].includes(result.status) || /[\r\n]/.test(result.log)) {
    throw new Error('Invalid ATM result fields');
  }
  const log = result.log || '-';
  return `ATM-RESULT step=${result.step} status=${result.status} code=${result.code} log=${log} hint=${JSON.stringify(result.hint)}`;
}

export function parseAtmResultLine(line: string): AtmResultLine | null {
  const match = /^ATM-RESULT step=([\w-]+) status=(ok|fail) code=([A-Z][A-Z0-9_]*) log=(.+?) hint=("(?:[^"\\\r\n]|\\.)*")$/.exec(line);
  if (!match) return null;
  try {
    return { step: match[1], status: match[2] as AtmResultLine['status'], code: match[3], log: match[4], hint: JSON.parse(match[5]) };
  } catch {
    return null;
  }
}
