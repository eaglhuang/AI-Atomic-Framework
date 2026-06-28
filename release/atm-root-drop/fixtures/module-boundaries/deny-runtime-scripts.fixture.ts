// NEGATIVE FIXTURE: this file represents the banned import pattern.
// A real package runtime file must never import from scripts/.
// The validate-module-boundaries deny rule uses this to verify detection.
import { runHashPlaceholderAudit } from '../../../../scripts/audit-hash-placeholders.ts';

export function exampleRuntimeThatImportsScripts() {
  return runHashPlaceholderAudit();
}
