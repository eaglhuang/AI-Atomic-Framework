export const experimentalApiSchemaVersion = 'atm.experimentalApi.v0.1' as const;

export type ExperimentalApiId = 'agent-pack-preview';

export interface ExperimentalApiDescriptor {
  readonly id: ExperimentalApiId;
  readonly stability: 'experimental';
  readonly since: string;
  readonly summary: string;
  readonly graduationCriteria: readonly string[];
}

export interface ExperimentalApiInvocationInput {
  readonly apiId: ExperimentalApiId | string;
  readonly allowExperimental?: boolean;
  readonly caller?: string;
}

export interface ExperimentalApiInvocationResult {
  readonly schemaVersion: typeof experimentalApiSchemaVersion;
  readonly apiId: ExperimentalApiId;
  readonly stability: 'experimental';
  readonly accepted: true;
  readonly caller: string | null;
  readonly warning: string;
}

export class ExperimentalApiError extends Error {
  readonly code: 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN' | 'ATM_EXPERIMENTAL_API_UNKNOWN';
  readonly details: Record<string, unknown>;

  constructor(code: ExperimentalApiError['code'], message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ExperimentalApiError';
    this.code = code;
    this.details = details;
  }
}

/** @experimental */
export const experimentalApis: readonly ExperimentalApiDescriptor[] = Object.freeze([
  {
    id: 'agent-pack-preview',
    stability: 'experimental',
    since: '0.0.0',
    summary: 'Preview agent-pack SDK behavior before it graduates into the stable adapter contract.',
    graduationCriteria: [
      'Documented consumer contract in docs/EXPERIMENTAL_API.md',
      'No default-enabled CLI route depends on it',
      'At least one bridge minor release can read old and new schema contracts'
    ]
  }
]);

/** @experimental */
export function listExperimentalApis(): readonly ExperimentalApiDescriptor[] {
  return experimentalApis;
}

/** @experimental */
export function invokeExperimentalApi(input: ExperimentalApiInvocationInput): ExperimentalApiInvocationResult {
  const descriptor = experimentalApis.find((api) => api.id === input.apiId);
  if (!descriptor) {
    throw new ExperimentalApiError('ATM_EXPERIMENTAL_API_UNKNOWN', `Unknown experimental API: ${input.apiId}`, {
      apiId: input.apiId,
      availableApis: experimentalApis.map((api) => api.id)
    });
  }

  if (input.allowExperimental !== true) {
    throw new ExperimentalApiError('ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN', `Experimental API ${descriptor.id} requires --allow-experimental.`, {
      apiId: descriptor.id,
      requiredFlag: '--allow-experimental',
      docs: 'docs/EXPERIMENTAL_API.md'
    });
  }

  return {
    schemaVersion: experimentalApiSchemaVersion,
    apiId: descriptor.id,
    stability: 'experimental',
    accepted: true,
    caller: input.caller ?? null,
    warning: 'Experimental APIs may change or be removed before graduation; do not depend on them without an explicit bridge minor plan.'
  };
}
