import { TEAM_PROVIDER_IDS } from '../../../../core/dist/team-runtime/provider-contract.js';
import { resolveTeamProviderSelection } from '../../../../core/dist/team-runtime/provider-selection.js';
export function buildTeamRoleSkillPackContract(recipe) {
    const rolePackDefaults = {
        coordinator: {
            skillPackId: 'atm.role-pack.coordinator',
            specialistSkills: ['atm-governance-router', 'atm-next', 'atm-handoff'],
            playbookSlice: 'route-claim-close-commit'
        },
        reader: {
            skillPackId: 'atm.role-pack.reader',
            specialistSkills: ['atm-orient'],
            playbookSlice: 'source-read-discovery'
        },
        scopeGuardian: {
            skillPackId: 'atm.role-pack.scope-guardian',
            specialistSkills: ['atm-lock'],
            playbookSlice: 'scope-preflight-boundary-watch'
        },
        implementer: {
            skillPackId: 'atm.role-pack.implementer',
            specialistSkills: ['atm-task-intent-resolver'],
            playbookSlice: 'scoped-delivery'
        },
        validator: {
            skillPackId: 'atm.role-pack.validator',
            specialistSkills: ['atm-evidence'],
            playbookSlice: 'validator-evidence-pass'
        },
        evidenceCollector: {
            skillPackId: 'atm.role-pack.evidence-collector',
            specialistSkills: ['atm-evidence', 'atm-handoff'],
            playbookSlice: 'evidence-summary-handoff'
        },
        atomizationPlanner: {
            skillPackId: 'atm.role-pack.atomization-planner',
            specialistSkills: ['atm-atom-map-refactor', 'atm-task-card-authoring'],
            playbookSlice: 'atomization-scope-shaping'
        },
        lieutenant: {
            skillPackId: 'atm.role-pack.lieutenant',
            specialistSkills: ['atm-dispatch', 'atm-lock'],
            playbookSlice: 'coordination-boundary-watch'
        },
        reviewAgent: {
            skillPackId: 'atm.role-pack.review-agent',
            specialistSkills: ['atm-evidence'],
            playbookSlice: 'review-signature-advisory'
        },
        knowledgeScout: {
            skillPackId: 'atm.role-pack.knowledge-scout',
            specialistSkills: ['atm-orient'],
            playbookSlice: 'knowledge-query-advisory'
        }
    };
    const coordinatorExclusive = ['task.lifecycle', 'git.write', 'evidence.write'];
    return {
        schemaId: 'atm.teamRoleSkillPackContract.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        roles: recipe.agents.map((agent) => {
            const defaults = rolePackDefaults[agent.role] ?? {
                skillPackId: `atm.role-pack.${agent.role}`,
                specialistSkills: [],
                playbookSlice: 'specialist-advisory'
            };
            return {
                role: agent.role,
                agentId: agent.agentId,
                skillPackId: defaults.skillPackId,
                specialistSkills: defaults.specialistSkills,
                allowedPermissions: [...agent.permissions],
                forbiddenPermissions: agent.role === 'coordinator' ? [] : coordinatorExclusive,
                playbookSlice: defaults.playbookSlice,
                growthContractAttachment: 'shared-team-growth-contract'
            };
        })
    };
}
export function buildProviderNeutralRoleSkillPackManifest(input) {
    const roleSkillPacks = input.roleSkillPacks ?? buildTeamRoleSkillPackContract(input.recipe);
    const selectionConfig = input.selectionConfig ?? {
        repoDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-5-mini',
            runtimeMode: 'broker-only'
        },
        roleOverrides: {}
    };
    const providerIds = uniqueStrings([...(input.providerIds ?? TEAM_PROVIDER_IDS)]);
    return {
        schemaId: 'atm.teamRoleSkillPackManifest.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        discoveryMode: 'capability-driven',
        roleFirstProviderSecond: true,
        sharedVocabulary: {
            brokerConflict: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked']
        },
        roles: roleSkillPacks.roles.map((entry) => {
            const selection = resolveTeamProviderSelection(entry.role, selectionConfig);
            return {
                role: entry.role,
                skillPackId: entry.skillPackId,
                playbookSlice: entry.playbookSlice,
                capabilityTags: capabilityTagsForRole(entry.role),
                permissionLease: {
                    alignment: 'role-first',
                    allowedPermissions: entry.allowedPermissions,
                    forbiddenPermissions: entry.forbiddenPermissions
                },
                selectedProvider: {
                    providerId: selection.providerId,
                    sdkId: selection.sdkId,
                    modelId: selection.modelId,
                    runtimeMode: selection.runtimeMode,
                    source: selection.source
                },
                providerCapabilities: providerIds.map((providerId) => ({
                    providerId,
                    runtimeModes: ['real-agent', 'editor-subagent', 'broker-only'],
                    artifacts: artifactsForRole(entry.role),
                    satisfiesRolePack: true,
                    reason: `${providerId} can satisfy ${entry.skillPackId} through role-first permission leases and ${entry.playbookSlice}.`
                })),
                growthContractAttachment: entry.growthContractAttachment
            };
        })
    };
}
export function buildTeamRoleRoutingMatrix(roleSkillPacks) {
    const hasRole = (role) => roleSkillPacks.roles.some((entry) => entry.role === role);
    const maybe = (role) => hasRole(role) ? [role] : [];
    const route = (input) => ({
        workstream: input.workstream,
        primaryRole: input.primaryRole,
        supportingRoles: input.supportingRoles ?? [],
        advisoryRoles: input.advisoryRoles ?? [],
        roleOrder: input.roleOrder,
        parallelSafeRoles: input.parallelSafeRoles ?? [],
        advisoryOnlyRoles: input.advisoryOnlyRoles ?? input.advisoryRoles ?? [],
        playbookSlice: input.playbookSlice,
        lifecycleOwner: 'coordinator',
        stopConditions: input.stopConditions ?? [
            'broker-conflict-blocked',
            'blocked-active-lease',
            'proposal-submitted'
        ]
    });
    return {
        schemaId: 'atm.teamRoleRoutingMatrix.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        routes: [
            route({
                workstream: 'task-entry-routing',
                primaryRole: 'coordinator',
                supportingRoles: [...maybe('reader'), ...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('evidenceCollector')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
                parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                playbookSlice: 'route-claim-close-commit'
            }),
            route({
                workstream: 'scoped-implementation',
                primaryRole: hasRole('implementer') ? 'implementer' : 'coordinator',
                supportingRoles: [...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('reader')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), hasRole('implementer') ? 'implementer' : 'coordinator', ...maybe('reader')],
                parallelSafeRoles: [...maybe('scopeGuardian'), ...maybe('reader')],
                playbookSlice: 'scoped-delivery'
            }),
            route({
                workstream: 'validation-and-evidence',
                primaryRole: hasRole('validator') ? 'validator' : 'coordinator',
                supportingRoles: [...maybe('evidenceCollector')],
                advisoryRoles: [...maybe('reader')],
                roleOrder: ['coordinator', hasRole('validator') ? 'validator' : 'coordinator', ...maybe('evidenceCollector'), ...maybe('reader')],
                parallelSafeRoles: [...maybe('evidenceCollector'), ...maybe('reader')],
                playbookSlice: 'validator-evidence-pass'
            }),
            route({
                workstream: 'broker-conflict-resolution',
                primaryRole: 'coordinator',
                supportingRoles: [...maybe('scopeGuardian')],
                advisoryRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
                parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
                playbookSlice: 'broker-conflict-resolution',
                stopConditions: [
                    'broker-conflict-blocked',
                    'missing-atm.brokerConflictResolution.v1',
                    'manual-runtime-edit-requested'
                ]
            })
        ]
    };
}
function capabilityTagsForRole(role) {
    const normalized = role.toLowerCase();
    if (normalized === 'coordinator')
        return ['task-routing', 'lifecycle-authority', 'closeout-sequencing'];
    if (normalized.includes('scope'))
        return ['scope-boundary', 'broker-preflight', 'lease-watch'];
    if (normalized.includes('implementer'))
        return ['scoped-delivery', 'bounded-file-write'];
    if (normalized.includes('validator'))
        return ['validator-run', 'failure-interpretation'];
    if (normalized.includes('evidence'))
        return ['evidence-packaging', 'closure-readiness'];
    if (normalized.includes('knowledge'))
        return ['knowledge-query', 'shared-growth-context'];
    if (normalized.includes('steward'))
        return ['broker-authorized-apply', 'bounded-merge-plan'];
    return ['specialist-advisory'];
}
function artifactsForRole(role) {
    const normalized = role.toLowerCase();
    if (normalized === 'coordinator')
        return ['captain-decision', 'team-brief', 'handoff'];
    if (normalized.includes('validator'))
        return ['validator-report'];
    if (normalized.includes('evidence'))
        return ['evidence-summary'];
    if (normalized.includes('implementer'))
        return ['agent-report', 'patch-summary'];
    if (normalized.includes('scope'))
        return ['scope-report'];
    if (normalized.includes('knowledge'))
        return ['knowledge-summary'];
    if (normalized.includes('steward'))
        return ['broker-apply-report'];
    return ['agent-report'];
}
function uniqueStrings(values) {
    return Array.from(new Set(values));
}
