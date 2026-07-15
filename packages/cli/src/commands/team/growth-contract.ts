import { type TeamRoleSkillPackContract } from './role-skill-packs.ts';

export type TeamGrowthContract = {
  schemaId: 'atm.teamGrowthContract.v1';
  sharedAcrossRolePacks: true;
  taxonomy: string[];
  captureTemplate: string[];
  promotionPolicy: {
    stableRuleTarget: string;
    rawCaseTarget: string;
  };
};

export type TeamRoleGrowthObservabilityContract = {
  schemaId: 'atm.teamRoleGrowthObservabilityContract.v1';
  sharedAcrossRolePacks: true;
  referenceFirst: true;
  sourceGrowthContract: 'atm.teamGrowthContract.v1';
  sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1';
  learningEventProjection: {
    eventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    eventType: 'artifact.output';
    artifactType: 'atm.teamRoleGrowthLearningItem.v1';
    queryKeys: string[];
    artifactFields: string[];
  };
  frictionClassification: {
    sharedAtmRoutingFriction: string[];
    roleSpecificFriction: string[];
  };
  roleMappings: Array<{
    role: string;
    agentId: string;
    skillPackId: string;
    playbookSlice: string;
    growthAttachmentPoint: string;
    learningReference: string;
    taxonomy: string[];
    observableEventSelector: {
      role: string;
      eventType: 'artifact.output';
      artifactType: 'atm.teamRoleGrowthLearningItem.v1';
    };
  }>;
  metrics: Array<{
    metricId: string;
    description: string;
    numerator: Record<string, string>;
    denominator: Record<string, string>;
    groupedBy: string[];
  }>;
  brokerConflictVocabulary: {
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    blockedCode: 'broker-conflict-blocked';
  };
};

export function buildTeamGrowthContract(): TeamGrowthContract {
  return {
    schemaId: 'atm.teamGrowthContract.v1',
    sharedAcrossRolePacks: true,
    taxonomy: [
      'entry-friction',
      'route-confusion',
      'boundary-confusion',
      'fallback-misuse',
      'validator-gap',
      'tooling-mismatch',
      'overloaded-context',
      'shared-atm-routing-friction',
      'role-specific-friction'
    ],
    captureTemplate: [
      'Trigger',
      'Symptom',
      'Correct route',
      'Durable rule',
      'Promotion target',
      'Reuse scope'
    ],
    promotionPolicy: {
      stableRuleTarget: 'SKILL.md',
      rawCaseTarget: 'docs/governance/team-agents/role-pack-learning-loop.md'
    }
  };
}

export function buildTeamRoleGrowthObservabilityContract(input: {
  roleSkillPacks: TeamRoleSkillPackContract;
  growthContract?: TeamGrowthContract;
}): TeamRoleGrowthObservabilityContract {
  const growthContract = input.growthContract ?? buildTeamGrowthContract();
  const learningReference = growthContract.promotionPolicy.rawCaseTarget;
  return {
    schemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
    sharedAcrossRolePacks: true,
    referenceFirst: true,
    sourceGrowthContract: 'atm.teamGrowthContract.v1',
    sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1',
    learningEventProjection: {
      eventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
      eventType: 'artifact.output',
      artifactType: 'atm.teamRoleGrowthLearningItem.v1',
      queryKeys: ['taskId', 'teamRunId', 'providerId', 'role', 'artifactType', 'eventType'],
      artifactFields: [
        'Category',
        'Trigger',
        'Symptom',
        'Correct route',
        'Durable rule',
        'Promotion target',
        'Confidence',
        'Reuse scope'
      ]
    },
    frictionClassification: {
      sharedAtmRoutingFriction: [
        'entry-friction',
        'route-confusion',
        'fallback-misuse',
        'tooling-mismatch',
        'shared-atm-routing-friction'
      ],
      roleSpecificFriction: [
        'boundary-confusion',
        'validator-gap',
        'overloaded-context',
        'role-specific-friction'
      ]
    },
    roleMappings: input.roleSkillPacks.roles.map((entry) => ({
      role: entry.role,
      agentId: entry.agentId,
      skillPackId: entry.skillPackId,
      playbookSlice: entry.playbookSlice,
      growthAttachmentPoint: entry.growthContractAttachment,
      learningReference,
      taxonomy: growthContract.taxonomy,
      observableEventSelector: {
        role: entry.role,
        eventType: 'artifact.output',
        artifactType: 'atm.teamRoleGrowthLearningItem.v1'
      }
    })),
    metrics: [
      {
        metricId: 'role-growth.learning-events.by-role',
        description: 'Counts reference-first role learning artifacts by role and skill pack.',
        numerator: {
          eventType: 'artifact.output',
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        denominator: {
          eventType: 'artifact.output',
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        groupedBy: ['role', 'skillPackId', 'playbookSlice']
      },
      {
        metricId: 'role-growth.role-specific-friction.rate',
        description: 'Separates role-boundary friction from shared ATM routing friction.',
        numerator: {
          category: 'role-specific-friction'
        },
        denominator: {
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        groupedBy: ['role', 'skillPackId']
      },
      {
        metricId: 'broker-conflict-blocked.hit-rate',
        description: 'Tracks how often Team role growth observes the M8E broker-conflict-blocked state.',
        numerator: {
          violationStatus: 'broker-conflict-blocked'
        },
        denominator: {
          eventType: 'broker.conflict.blocked'
        },
        groupedBy: ['role', 'taskId', 'decisionClass']
      }
    ],
    brokerConflictVocabulary: {
      decisionClass: 'decisionClass',
      decisionReason: 'decisionReason',
      violationStatus: 'violationStatus',
      blockedCode: 'broker-conflict-blocked'
    }
  };
}
