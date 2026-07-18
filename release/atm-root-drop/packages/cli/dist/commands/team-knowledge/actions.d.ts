import type { KnowledgePermissionDecision } from './permission.ts';
export declare function runKnowledgeBuild(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision): import("../shared.ts").CommandResult;
export declare function runKnowledgeQuery(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision): import("../shared.ts").CommandResult;
export declare function runKnowledgeStats(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision): import("../shared.ts").CommandResult;
export declare function runKnowledgeCompact(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision): import("../shared.ts").CommandResult;
