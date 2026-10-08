/** Tiny oracle-friendly test module (COLD). */
import { slugify, trim } from '../src/utils/strings.ts';

// <region:body>
export function runStringsSelfTest(): boolean {
  return trim('  x  ') === 'x' && slugify('Hello World') === 'hello-world';
}
// </region:body>
