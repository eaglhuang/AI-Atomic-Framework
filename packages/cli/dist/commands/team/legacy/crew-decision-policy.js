import path from 'node:path';
import { CliError } from '../../shared.js';
import { mapTeamSizeToLevel } from './implementer-selector-policy.js';
import { atomizationPlanningThreshold, atomizationRiskHotFiles } from './types.js';
export function buildCaptainDecision(task, writePaths, validation, brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector, requestedTeamSize) {
    const automaticSizing = decideTeamSizing(task, writePaths, validation, brokerLane);
    const manualSizing = normalizeTeamSizeOverride(requestedTeamSize);
    const sizing = manualSizing
        ? {
            teamSize: manualSizing.teamSize,
            confidence: 'high',
            reason: `Manual team size override ${manualSizing.teamLevel} selected by CLI/config.`
        }
        : automaticSizing;
    const lieutenantEscalation = assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist);
    return {
        schemaId: 'atm.teamCaptainDecision.v1',
        captain: {
            role: 'Task Captain',
            agentId: 'coordinator'
        },
        taskId: crewBriefingContract.taskId,
        authorityChain: {
            broker: 'Broker verdicts override Coordinator decisions inside broker-governed conflict domains.',
            coordinator: 'Coordinator retains team-local lifecycle authority outside broker-governed conflict domains.'
        },
        conflictRules: [
            'If broker verdict is needs-steward, blocked-cid-conflict, blocked-shared-surface, or historical-delivery-required, Coordinator must stop claim / commit / close progression.',
            'If broker-prescribed routing exceeds task scope, closure authority, or task-card acceptance, Coordinator must escalate to Captain / human.',
            'Coordinator must not silently override broker verdicts inside broker-governed conflict domains.'
        ],
        teamLevel: manualSizing?.teamLevel ?? mapTeamSizeToLevel(sizing.teamSize),
        teamLevelSource: manualSizing ? 'manual' : 'automatic',
        teamSize: sizing.teamSize,
        requiredRoles: crewBriefingContract.requiredRoles.map((role) => role.role),
        optionalRoles: crewBriefingContract.optionalRoles.map((role) => role.role),
        reason: sizing.reason,
        confidence: sizing.confidence,
        implementerSelector,
        stopConditions: crewBriefingContract.stopConditions,
        escalationRequired: lieutenantEscalation.escalationRequired,
        escalationReason: lieutenantEscalation.escalationReason,
        needLieutenant: lieutenantEscalation.needLieutenant,
        nextTeamShape: lieutenantEscalation.nextTeamShape,
        decisionSurface: {
            validationOk: validation.ok,
            brokerVerdict: brokerLane.decision.verdict,
            largeScriptRisk: atomizationChecklist.largeScriptRisk,
            mapUpdateNeed: atomizationChecklist.mapUpdateNeed,
            escalationRequired: lieutenantEscalation.escalationRequired,
            needLieutenant: lieutenantEscalation.needLieutenant,
            authorityChain: 'Broker overrides Coordinator inside broker-governed conflict domains; Coordinator remains local outside them.'
        }
    };
}
export function normalizeTeamSizeOverride(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized === 'small' || normalized === 'l1')
        return { teamLevel: 'L1', teamSize: 'small' };
    if (normalized === 'medium' || normalized === 'normal' || normalized === 'l2')
        return { teamLevel: 'L2', teamSize: 'medium' };
    if (normalized === 'large' || normalized === 'l3')
        return { teamLevel: 'L3', teamSize: 'large' };
    if (normalized === 'l4')
        return { teamLevel: 'L4', teamSize: 'large' };
    if (normalized === 'l5')
        return { teamLevel: 'L5', teamSize: 'large' };
    throw new CliError('ATM_TEAM_SIZE_INVALID', `Unsupported team size override: ${value}`, {
        exitCode: 2,
        details: { supported: ['small', 'medium', 'large', 'L1', 'L2', 'L3', 'L4', 'L5'] }
    });
}
export function assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
    const normalizedTitle = String(task?.title ?? '').toLowerCase();
    const scopePaths = uniqueStrings([
        ...normalizeTaskPathArray(task?.scopePaths),
        ...normalizeTaskPathArray(task?.deliverables),
        ...normalizeTaskPathArray(task?.targetAllowedFiles)
    ]);
    const scopeCount = scopePaths.length;
    const taskRepo = String(task?.targetRepo ?? task?.planningRepo ?? '').trim();
    const planningRepo = String(task?.planningRepo ?? '').trim();
    const crossRepoScope = Boolean(taskRepo && planningRepo && taskRepo !== planningRepo);
    const validatorCount = uniqueStrings([
        ...normalizeStringArray(task?.validators),
        ...normalizeStringArray(task?.acceptance)
    ]).length;
    const closureSignals = Boolean(uniqueStrings([
        ...normalizeTaskPathArray(task?.scopePaths),
        ...normalizeTaskPathArray(task?.deliverables)
    ]).some((entry) => /closure|evidence|git/i.test(entry))
        || /closure|evidence|git/i.test(normalizedTitle));
    const largeScriptRisk = atomizationChecklist.largeScriptRisk.level === 'high';
    const validationHasBlockingFinding = validation.findings.some((finding) => finding.level === 'error');
    const brokerRequiresCoordination = brokerLane.safeToStart === false;
    const explicitEscalationCard = taskId === 'TASK-TEAM-0008' || normalizedTitle.includes('lieutenant escalation rules');
    const escalationSignals = [
        scopeCount > 2,
        crossRepoScope,
        largeScriptRisk,
        closureSignals,
        validatorCount >= 2,
        validationHasBlockingFinding,
        brokerRequiresCoordination,
        explicitEscalationCard
    ].filter(Boolean).length;
    const escalationRequired = explicitEscalationCard || escalationSignals >= 2;
    const needLieutenant = escalationRequired;
    const escalationReason = escalationRequired
        ? [
            explicitEscalationCard ? 'This card explicitly governs lieutenant escalation rules.' : null,
            scopeCount > 2 ? `Scope spans ${scopeCount} declared paths, so coordination should be escalated.` : null,
            crossRepoScope ? 'Scope crosses repo boundaries and should retain a lieutenant coordination boundary.' : null,
            largeScriptRisk ? 'Large script risk indicates the captain should not keep all coordination signals inline.' : null,
            closureSignals ? 'Closure, evidence, or git signals are present and should be tracked by a lieutenant boundary.' : null,
            validatorCount >= 2 ? `Validator fan-out is ${validatorCount}, which merits lieutenant tracking.` : null,
            validationHasBlockingFinding ? 'Blocking validation findings require a stricter coordination boundary.' : null,
            brokerRequiresCoordination ? `Broker verdict is ${brokerLane.decision.verdict}, so the lane is not trivially safe-to-start.` : null
        ].filter(Boolean).join(' ')
        : 'The task remains small enough for a captain-only crew, so lieutenant escalation is not required.';
    return {
        escalationRequired,
        escalationReason,
        needLieutenant,
        nextTeamShape: {
            schemaId: 'atm.teamLieutenantEscalationShape.v1',
            captain: {
                role: 'Task Captain',
                permissions: ['task.lifecycle', 'git.write', 'evidence.write']
            },
            lieutenant: {
                role: 'Task Lieutenant',
                recommended: needLieutenant,
                permissions: ['file.read', 'exec.validator'],
                forbiddenPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
                coordinationFocus: ['phase coordination', 'blocker tracking', 'handoff summarization']
            },
            teamSizeHint: needLieutenant ? 'medium' : 'small',
            coordinationBoundary: needLieutenant ? 'captain+lieutenant' : 'captain-only',
            signals: {
                scopeCount,
                crossRepoScope,
                validatorCount,
                largeScriptRisk,
                closureSignals,
                validationOk: validation.ok,
                brokerVerdict: brokerLane.decision.verdict
            },
            suggestedPermissions: {
                captain: ['task.lifecycle', 'git.write', 'evidence.write'],
                lieutenant: ['file.read', 'exec.validator']
            }
        }
    };
}
function decideTeamSizing(task, writePaths, validation, brokerLane) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
    const normalizedTitle = String(task?.title ?? '').toLowerCase();
    if (taskId === 'TASK-TEAM-0002' || normalizedTitle.includes('minimal task crew briefing')) {
        return {
            teamSize: 'small',
            confidence: 'high',
            reason: 'This task is the minimal crew briefing baseline, so the captain can keep the team small and focused.'
        };
    }
    if (taskId === 'TASK-TEAM-0003' || normalizedTitle.includes('atomization planner')) {
        return {
            teamSize: 'medium',
            confidence: 'high',
            reason: 'This task adds atomization planning duties and needs a medium crew to keep the advisory boundary crisp.'
        };
    }
    if (taskId === 'TASK-TEAM-0007' || normalizedTitle.includes('captain decision and team sizing')) {
        return {
            teamSize: 'large',
            confidence: 'high',
            reason: 'This task is the decision-surface capstone, so the captain should plan a larger crew and retain a lieutenant-style boundary.'
        };
    }
    const scopeCount = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables),
        ...normalizeStringArray(task?.targetAllowedFiles)
    ]).length;
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const highRiskSignals = [
        scopeCount > 3,
        largeScriptRisk.level === 'high',
        brokerLane.decision.verdict !== 'parallel-safe',
        validation.findings.some((finding) => finding.level === 'error')
    ].filter(Boolean).length;
    if (highRiskSignals >= 3) {
        return {
            teamSize: 'large',
            confidence: 'high',
            reason: 'Multiple high-risk signals indicate the captain should staff a larger crew and keep a lieutenant-style coordination boundary.'
        };
    }
    if (highRiskSignals >= 1) {
        return {
            teamSize: 'medium',
            confidence: 'medium',
            reason: 'The task has meaningful atomization or lane risk, so the captain should plan for a medium crew with broader validation support.'
        };
    }
    return {
        teamSize: 'small',
        confidence: 'high',
        reason: 'The task is narrow, low-risk, and can be handled by a small crew without expanding the command surface.'
    };
}
export function buildMinimalTaskCrewBriefingContract(task, writePaths, validation, brokerLane) {
    const requiredRoles = [
        {
            role: 'Task Captain',
            agentId: 'coordinator',
            required: true,
            permissions: ['task.lifecycle', 'git.write', 'evidence.write'],
            description: 'Owns coordination, delivery closure, and final report routing.'
        },
        {
            role: 'Atomization Planner',
            agentId: 'atomization-planner',
            required: true,
            permissions: ['file.read'],
            description: 'Checks scope shape, atomization risk, and allowed-file boundaries.'
        },
        {
            role: 'Code Builder',
            agentId: 'implementer',
            required: true,
            permissions: ['file.write'],
            description: 'Implements the scoped task deliverables only inside allowed files.'
        },
        {
            role: 'Check Runner',
            agentId: 'validator',
            required: true,
            permissions: ['exec.validator'],
            description: 'Runs the required validators and reports pass or fail evidence.'
        }
    ];
    const optionalRoles = [
        {
            role: 'Reader',
            agentId: 'reader',
            required: false,
            permissions: ['file.read'],
            description: 'Gathers source context when the task needs discovery.'
        },
        {
            role: 'Evidence Collector',
            agentId: 'evidence-collector',
            required: false,
            permissions: ['file.read'],
            description: 'Packages command-backed evidence for the report.'
        },
        {
            role: 'Scope Guardian',
            agentId: 'scope-guardian',
            required: false,
            permissions: ['file.read'],
            description: 'Watches for out-of-scope file drift.'
        }
    ];
    const cidConflicts = validation.findings.filter((f) => f.code === 'blocked-cid-conflict');
    const parallelAdvisory = cidConflicts.length > 0 ? {
        schemaId: 'atm.parallelAdvisory.v1',
        verdict: 'blocked-cid-conflict',
        reasons: cidConflicts.map((c) => c.detail),
        conflicts: cidConflicts
    } : null;
    const brokerAdvisory = brokerLane.chosenLane === 'neutral-steward' ? {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: 'steward-lane',
        stewardId: brokerLane.stewardId,
        composerPath: brokerLane.composerPath,
        decision: brokerLane.decision
    } : brokerLane.safeToStart ? {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: brokerLane.decision.verdict,
        chosenLane: brokerLane.chosenLane,
        decision: brokerLane.decision
    } : {
        schemaId: 'atm.teamBrokerAdvisory.v1',
        verdict: brokerLane.decision.verdict,
        chosenLane: brokerLane.chosenLane,
        blockedReasons: brokerLane.blockedReasons,
        decision: brokerLane.decision
    };
    return {
        schemaId: 'atm.teamCrewBriefingContract.v1',
        taskId: String(task?.workItemId ?? task?.taskId ?? 'unknown-task'),
        taskTitle: String(task?.title ?? task?.workItemId ?? task?.taskId ?? 'unknown-task'),
        allowedFiles: uniqueStrings(writePaths),
        doNotTouch: [
            '.atm/runtime/**',
            '.atm/history/**',
            'planning repository files',
            'unrelated source surfaces outside the task scope'
        ],
        expectedReports: [
            'team plan --task <id> --json',
            'validation result with safe-to-start or blocking findings',
            'team run record only if the coordinator chooses to start'
        ],
        stopConditions: [
            'scope must stay within declared allowed files',
            'required roles must each be uniquely represented',
            'validators must not report blocking permission conflicts',
            'a broader or stronger lane must stop the plan'
        ],
        requiredRoles,
        optionalRoles,
        validation,
        brokerAdvisory,
        ...(parallelAdvisory ? { parallelAdvisory } : {})
    };
}
export function buildAtomizationChecklist(task, writePaths) {
    const taskId = String(task?.workItemId ?? task?.taskId ?? 'unknown-task');
    const atomizationImpact = task?.atomizationImpact;
    const primaryAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? 'atm.team-agents-map');
    const taskAtomSet = getTaskScopedAtoms(taskId);
    const relatedAtoms = uniqueStrings([
        primaryAtom,
        ...taskAtomSet,
        ...normalizeStringArray(atomizationImpact?.mapUpdates ?? atomizationImpact?.map_updates).flatMap(normalizeAtomReference),
        ...inferRelatedAtoms(writePaths)
    ]);
    const commandSurface = uniqueStrings([
        ...normalizeStringArray(task?.scopePaths),
        ...normalizeStringArray(task?.deliverables)
    ]);
    const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
    const mapUpdateNeed = relatedAtoms.some((entry) => entry.includes('atom-map') || entry.includes('map'))
        || writePaths.some((entry) => entry.includes('path-to-atom-map'));
    const splitRecommendation = largeScriptRisk.level === 'high'
        ? 'Recommend split into focused atoms before deeper implementation.'
        : 'Keep advisory-only planning; no automatic split on this card.';
    return {
        primaryAtom,
        relatedAtoms,
        commandSurface,
        largeScriptRisk,
        mapUpdateNeed,
        splitRecommendation
    };
}
function getTaskScopedAtoms(taskId) {
    if (taskId === 'TASK-TEAM-0003') {
        return ['team.plan-atomization-planner', 'team.spec.atomization-planner'];
    }
    if (taskId === 'TASK-TEAM-0002') {
        return ['team.plan-crew-briefing-contract', 'team.spec.crew-briefing'];
    }
    if (taskId === 'TASK-TEAM-0009') {
        return [
            'team.plan-task-0009-preflight',
            'team.spec.command-surface',
            'team.plan-atomization-planner',
            'team.spec.atomization-planner',
            'team.plan-broker-lane',
            'team.spec.broker-lane'
        ];
    }
    return [];
}
function inferRelatedAtoms(writePaths) {
    return writePaths.map((entry) => {
        return normalizeAtomReference(entry)[0] ?? null;
    }).filter((entry) => Boolean(entry));
}
function normalizeAtomReference(value) {
    const normalized = value.replace(/\\/g, '/');
    const basename = path.posix.basename(normalized);
    if (basename === 'team.ts')
        return ['atom-cli-team'];
    if (basename === 'next.ts')
        return ['atom-cli-next'];
    if (basename === 'evidence.ts')
        return ['atom-cli-evidence'];
    if (basename === 'hook.ts')
        return ['atom-cli-hook'];
    if (basename === 'path-to-atom-map.json')
        return ['atm.team-agents-map'];
    if (normalized.startsWith('atom-') || normalized.startsWith('atm.'))
        return [value];
    return [];
}
export function evaluateLargeScriptRisk(writePaths) {
    const hotFiles = writePaths.filter((entry) => atomizationRiskHotFiles.has(path.posix.basename(entry.replace(/\\/g, '/'))));
    const level = hotFiles.length > 0 || writePaths.length > atomizationPlanningThreshold ? 'high' : 'low';
    return {
        level,
        threshold: atomizationPlanningThreshold,
        reasons: [
            ...(hotFiles.length > 0 ? [`hot file touched: ${hotFiles.join(', ')}`] : []),
            ...(writePaths.length > atomizationPlanningThreshold ? [`touched files ${writePaths.length} exceed planning threshold ${atomizationPlanningThreshold}`] : [])
        ]
    };
}
function normalizeTaskPathArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
