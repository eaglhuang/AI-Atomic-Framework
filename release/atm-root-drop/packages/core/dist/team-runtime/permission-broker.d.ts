export type TeamPermissionPolicy = {
    readonly schemaId: 'atm.teamPermissionPolicy.v1';
    readonly repoPolicyId: string;
    readonly allowedPermissions: readonly string[];
    readonly vendorPermissions: Readonly<Record<string, readonly string[]>>;
    readonly defaultDecision: 'deny' | 'allow';
};
export type TeamPermissionRequest = {
    readonly permission: string;
    readonly providerId: string;
    readonly scopedPaths: readonly string[];
};
export type TeamPermissionDecision = {
    readonly ok: boolean;
    readonly reason: string;
    readonly permission: string;
    readonly providerId: string;
};
export declare function createDefaultTeamPermissionPolicy(): TeamPermissionPolicy;
export declare function decideTeamPermission(policy: TeamPermissionPolicy, request: TeamPermissionRequest): TeamPermissionDecision;
