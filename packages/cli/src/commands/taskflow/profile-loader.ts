import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.ts';

export interface TaskflowProfileV1 {
  schemaId: 'taskflow.profile.v1';
  name: string;
  capabilities: {
    supportsDryRun: boolean;
    supportsWrite: boolean;
  };
  delegation: {
    hint: string;
    openerPath?: string;
  };
}

export function loadProfile(profilePath: string): TaskflowProfileV1 {
  const resolvedPath = path.resolve(profilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_NOT_FOUND',
      `Taskflow profile not found at path: ${profilePath}`,
      { exitCode: 1 }
    );
  }

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err: any) {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_PARSE_FAILED',
      `Failed to parse taskflow profile: ${err.message}`,
      { exitCode: 1 }
    );
  }

  if (!raw || typeof raw !== 'object') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Taskflow profile must be a valid JSON object.',
      { exitCode: 1 }
    );
  }

  if (raw.schemaId !== 'taskflow.profile.v1') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID',
      `Taskflow profile has invalid or missing schemaId. Expected "taskflow.profile.v1", got: ${raw.schemaId}`,
      { exitCode: 1 }
    );
  }

  // 驗證必要欄位
  if (!raw.name || typeof raw.name !== 'string') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Missing or invalid "name" field in taskflow profile.',
      { exitCode: 1 }
    );
  }

  if (!raw.capabilities || typeof raw.capabilities !== 'object') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Missing or invalid "capabilities" field in taskflow profile.',
      { exitCode: 1 }
    );
  }

  if (typeof raw.capabilities.supportsDryRun !== 'boolean') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Missing or invalid "capabilities.supportsDryRun" field in taskflow profile.',
      { exitCode: 1 }
    );
  }

  if (typeof raw.capabilities.supportsWrite !== 'boolean') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Missing or invalid "capabilities.supportsWrite" field in taskflow profile.',
      { exitCode: 1 }
    );
  }

  if (!raw.delegation || typeof raw.delegation !== 'object' || typeof raw.delegation.hint !== 'string') {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_SCHEMA_INVALID',
      'Missing or invalid "delegation.hint" field in taskflow profile.',
      { exitCode: 1 }
    );
  }

  // 硬性安全限制：supportsWrite 必須為 false
  if (raw.capabilities.supportsWrite === true) {
    throw new CliError(
      'ATM_TASKFLOW_PROFILE_WRITE_NOT_ALLOWED',
      'Taskflow profile write permission is not allowed in this version. "supportsWrite" must be false.',
      { exitCode: 1 }
    );
  }

  return raw as TaskflowProfileV1;
}
