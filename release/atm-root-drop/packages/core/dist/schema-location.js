import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Locates a framework schema the way the atomic spec parser does: walk up
 * from the calling module until `schemas/<relativePath>` exists. The source
 * tree, the frozen onefile bundle and the npm runtime layout all place their
 * schemas at a different depth, so a fixed framework root misses the copy
 * that the installed package actually ships.
 */
export function resolveShippedSchemaPath(moduleUrl, relativePath, fallbackRoot) {
    let current = path.dirname(fileURLToPath(moduleUrl));
    while (true) {
        const candidate = path.join(current, 'schemas', relativePath);
        if (existsSync(candidate))
            return candidate;
        const parent = path.dirname(current);
        if (parent === current)
            return path.join(fallbackRoot, 'schemas', relativePath);
        current = parent;
    }
}
