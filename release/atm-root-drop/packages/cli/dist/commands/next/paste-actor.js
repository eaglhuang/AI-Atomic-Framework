import { resolveActorId } from '../actor-registry.js';
const PLACEHOLDER = /<[^>\r\n]+>/;
/** Actor id safe to paste into a claim command. Placeholders and a missing identity are unknown. */
export function resolvePasteActor(explicit, cwd) {
    if (explicit && PLACEHOLDER.test(explicit))
        return null;
    const resolved = resolveActorId(explicit, cwd);
    if (!resolved || PLACEHOLDER.test(resolved.actorId))
        return null;
    return resolved.actorId;
}
