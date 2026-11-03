/**
 * Locates a framework schema the way the atomic spec parser does: walk up
 * from the calling module until `schemas/<relativePath>` exists. The source
 * tree, the frozen onefile bundle and the npm runtime layout all place their
 * schemas at a different depth, so a fixed framework root misses the copy
 * that the installed package actually ships.
 */
export declare function resolveShippedSchemaPath(moduleUrl: string, relativePath: string, fallbackRoot: string): string;
