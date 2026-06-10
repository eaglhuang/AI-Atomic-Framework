import path from 'node:path';

export function publicEntry(input: string): string {
  return path.basename(input);
}

export class MixedService {
  run(): string {
    return publicEntry('demo.txt'); // inline comment with brace }
  }
}

export const quickFormat = (value: number): string => `value: ${value}`;

function privateDetail(): number {
  return 42;
}

void privateDetail();
