import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ValidatorFixtureEntry {
  readonly source: string;
  readonly target?: string;
}

export interface ValidatorFixtureRuntimeIdentity {
  readonly actorId: string;
  readonly gitName: string;
  readonly gitEmail: string;
  readonly editor?: string | null;
  readonly provider?: string | null;
}

export interface ValidatorFixturePlanningCard {
  readonly taskId: string;
  readonly title: string;
  readonly owner?: string;
  readonly priority?: string;
  readonly scopePaths?: readonly string[];
  readonly deliverables?: readonly string[];
  readonly validators?: readonly string[];
}

export interface ValidatorFixtureDocument {
  readonly schemaId: 'atm.validatorFixture.v1';
  readonly specVersion: string;
  readonly fixtureId: string;
  readonly description?: string;
  readonly copyEntries: readonly ValidatorFixtureEntry[];
  readonly runtimeIdentities?: readonly ValidatorFixtureRuntimeIdentity[];
  readonly planningCards?: readonly ValidatorFixturePlanningCard[];
}

export function loadValidatorFixture(repoRoot: string, relativePath: string): ValidatorFixtureDocument {
  const absolutePath = path.join(repoRoot, relativePath);
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Partial<ValidatorFixtureDocument>;
  assertValidatorFixture(parsed, relativePath);
  return parsed;
}

export function materializeValidatorFixture(sourceRoot: string, targetRoot: string, fixture: ValidatorFixtureDocument) {
  mkdirSync(targetRoot, { recursive: true });
  for (const entry of fixture.copyEntries) {
    const sourcePath = path.join(sourceRoot, entry.source);
    if (!existsSync(sourcePath)) {
      throw new Error(`validator fixture "${fixture.fixtureId}" missing source entry: ${entry.source}`);
    }
    const targetPath = path.join(targetRoot, entry.target ?? entry.source);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
  for (const identity of fixture.runtimeIdentities ?? []) {
    const identityPath = path.join(targetRoot, '.atm', 'runtime', 'identity', 'actors', `${identity.actorId}.json`);
    mkdirSync(path.dirname(identityPath), { recursive: true });
    writeFileSync(identityPath, `${JSON.stringify({
      schemaId: 'atm.identityDefault.v1',
      specVersion: '0.1.0',
      actorId: identity.actorId,
      gitName: identity.gitName,
      gitEmail: identity.gitEmail,
      editor: identity.editor ?? null,
      provider: identity.provider ?? null,
      activeSessionId: null,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');
  }
  if ((fixture.planningCards ?? []).length > 0) {
    const planningRoot = path.join(path.dirname(targetRoot), `${fixture.fixtureId}-planning`);
    const taskRoot = path.join(planningRoot, 'docs', 'tasks');
    mkdirSync(taskRoot, { recursive: true });
    for (const card of fixture.planningCards ?? []) {
      const cardPath = path.join(taskRoot, `${card.taskId}-fixture.task.md`);
      writeFileSync(cardPath, renderPlanningCard(card), 'utf8');
    }
  }
}

function assertValidatorFixture(value: Partial<ValidatorFixtureDocument>, relativePath: string): asserts value is ValidatorFixtureDocument {
  if (value.schemaId !== 'atm.validatorFixture.v1') {
    throw new Error(`validator fixture ${relativePath} must declare schemaId "atm.validatorFixture.v1"`);
  }
  if (typeof value.specVersion !== 'string' || value.specVersion.length === 0) {
    throw new Error(`validator fixture ${relativePath} must declare specVersion`);
  }
  if (typeof value.fixtureId !== 'string' || value.fixtureId.length === 0) {
    throw new Error(`validator fixture ${relativePath} must declare fixtureId`);
  }
  if (!Array.isArray(value.copyEntries) || value.copyEntries.length === 0) {
    throw new Error(`validator fixture ${relativePath} must declare at least one copyEntries item`);
  }
  for (const [index, entry] of value.copyEntries.entries()) {
    if (!entry || typeof entry !== 'object' || typeof entry.source !== 'string' || entry.source.length === 0) {
      throw new Error(`validator fixture ${relativePath} has invalid copyEntries[${index}]`);
    }
    if (entry.target !== undefined && (typeof entry.target !== 'string' || entry.target.length === 0)) {
      throw new Error(`validator fixture ${relativePath} has invalid copyEntries[${index}].target`);
    }
  }
  if (value.runtimeIdentities !== undefined) {
    if (!Array.isArray(value.runtimeIdentities)) {
      throw new Error(`validator fixture ${relativePath} has invalid runtimeIdentities`);
    }
    for (const [index, identity] of value.runtimeIdentities.entries()) {
      if (!identity || typeof identity !== 'object') {
        throw new Error(`validator fixture ${relativePath} has invalid runtimeIdentities[${index}]`);
      }
      if (typeof identity.actorId !== 'string' || identity.actorId.length === 0) {
        throw new Error(`validator fixture ${relativePath} has invalid runtimeIdentities[${index}].actorId`);
      }
      if (typeof identity.gitName !== 'string' || identity.gitName.length === 0) {
        throw new Error(`validator fixture ${relativePath} has invalid runtimeIdentities[${index}].gitName`);
      }
      if (typeof identity.gitEmail !== 'string' || identity.gitEmail.length === 0) {
        throw new Error(`validator fixture ${relativePath} has invalid runtimeIdentities[${index}].gitEmail`);
      }
    }
  }
  if (value.planningCards !== undefined) {
    if (!Array.isArray(value.planningCards)) {
      throw new Error(`validator fixture ${relativePath} has invalid planningCards`);
    }
    for (const [index, card] of value.planningCards.entries()) {
      if (!card || typeof card !== 'object') {
        throw new Error(`validator fixture ${relativePath} has invalid planningCards[${index}]`);
      }
      if (typeof card.taskId !== 'string' || card.taskId.length === 0) {
        throw new Error(`validator fixture ${relativePath} has invalid planningCards[${index}].taskId`);
      }
      if (typeof card.title !== 'string' || card.title.length === 0) {
        throw new Error(`validator fixture ${relativePath} has invalid planningCards[${index}].title`);
      }
    }
  }
}

function renderPlanningCard(card: ValidatorFixturePlanningCard): string {
  const owner = card.owner ?? 'fixture-agent';
  const priority = card.priority ?? 'P2';
  const scopePaths = card.scopePaths && card.scopePaths.length > 0 ? card.scopePaths : ['docs/fixture.md'];
  const deliverables = card.deliverables && card.deliverables.length > 0 ? card.deliverables : scopePaths;
  const validators = card.validators && card.validators.length > 0 ? card.validators : ['git diff --check'];
  return [
    '---',
    `task_id: ${card.taskId}`,
    `title: ${quoteYamlScalar(card.title)}`,
    'status: planned',
    `owner: ${owner}`,
    `priority: ${priority}`,
    'planning_repo: fixture-planning',
    'target_repo: AI-Atomic-Framework',
    'closure_authority: target_repo',
    'scopePaths:',
    ...scopePaths.map((entry) => `  - ${quoteYamlScalar(entry)}`),
    'deliverables:',
    ...deliverables.map((entry) => `  - ${quoteYamlScalar(entry)}`),
    'validators:',
    ...validators.map((entry) => `  - ${quoteYamlScalar(entry)}`),
    'evidence:',
    '  required: command-backed',
    'rollback:',
    '  strategy: revert-commit',
    '---',
    '',
    `# ${card.taskId}: ${card.title}`,
    '',
    'Fixture planning card generated by atm.validatorFixture.v1.',
    ''
  ].join('\n');
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(String(value));
}
