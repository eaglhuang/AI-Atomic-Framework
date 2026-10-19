import { resolveActorId } from '../actor-registry.ts';

const PLACEHOLDER = /<[^>\r\n]+>/;

/** Actor id safe to paste into a claim command. Placeholders and a missing identity are unknown. */
export function resolvePasteActor(explicit: string | null | undefined, cwd?: string | null): string | null {
  if (explicit && PLACEHOLDER.test(explicit)) return null;
  const resolved = resolveActorId(explicit, cwd);
  if (!resolved || PLACEHOLDER.test(resolved.actorId)) return null;
  return resolved.actorId;
}
