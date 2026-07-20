import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'packages/plugin-sdk/src/capability.ts',
  'packages/plugin-sdk/src/effect-node.ts',
  'packages/plugin-sdk/src/governance/index.ts',
  'packages/plugin-sdk/src/governance/layout.ts',
  'packages/plugin-sdk/src/governance/stores.ts',
  'packages/plugin-sdk/src/detector/index.ts',
  'packages/plugin-sdk/src/detector/evidence-pattern-detector.ts',
  'packages/plugin-sdk/src/injector-plugin.ts',
  'packages/plugin-sdk/src/language-adapter.ts',
  'packages/plugin-sdk/src/lifecycle.ts',
  'packages/plugin-sdk/src/police.ts',
  'packages/plugin-sdk/src/test-runner.ts',
  'packages/core/src/police/family.ts',
  'packages/plugin-sdk/src/project-adapter.ts',
  'docs/ADAPTER_GUIDE.md',
  'docs/LIFECYCLE.md',
  'docs/HOST_GOVERNANCE_INTEGRATION.md'
];

function fail(message: any) {
  console.error(`[plugin-sdk:${mode}] ${message}`);
  process.exitCode = 1;
}

function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: any) {
  return JSON.parse(readText(relativePath));
}

for (const relativePath of requiredFiles) {
  if (!existsSync(path.join(root, relativePath))) {
    fail(`missing Plugin SDK contract file: ${relativePath}`);
  }
}

if (!process.exitCode) {
  const indexSource = readText('packages/plugin-sdk/src/index.ts');
  for (const exportName of [
    'ProjectAdapter',
    'LanguageAdapter',
    'CapabilityDescriptor',
    'InjectorPlugin',
    'AtomLifecycleMode',
    'EffectNode',
    'EffectNodeContext',
    'EffectNodeMode',
    'ExecuteAgentTaskEffectNode',
    'VersionResolver',
    'QualityMetricsComparator',
    'UpgradeProposalAdapter',
      'GovernanceAdapter',
      'GovernanceLayout',
      'defaultGovernanceLayout',
    'ContextBudgetGuard',
    'TaskStore',
    'LockStore',
    'DocumentIndex',
    'ShardStore',
    'ArtifactStore',
    'LogStore',
      'RunReportStore',
    'MarkdownJsonStateStore',
    'RuleGuard',
    'EvidenceStore',
    'PoliceFinding',
    'PoliceFamilyGateReport',
    'EvidenceRef',
    'TestRunnerPlugin',
    'AtomicTestRunnerConfig',
    'AtomicHealthGateId'
  ]) {
    if (!indexSource.includes(exportName)) {
      fail(`packages/plugin-sdk/src/index.ts must export ${exportName}`);
    }
  }

  const detectorSource = readText('packages/plugin-sdk/src/detector/evidence-pattern-detector.ts');
  for (const phrase of [
    'interface EvidencePatternDetectorReport',
    'detectEvidencePatterns',
    'defaultEvidencePatternDetectorThresholds',
    'minUsageCount',
    'minFrictionEvidence',
    'minConfidence',
    'proposal-candidate',
    'observation-only'
  ]) {
    if (!detectorSource.includes(phrase)) {
      fail(`detector/evidence-pattern-detector.ts missing ${phrase}`);
    }
  }

  const detectorIndexSource = readText('packages/plugin-sdk/src/detector/index.ts');
  for (const exportName of ['detectEvidencePatterns', 'EvidencePatternDetectorReport', 'EvidencePatternGroup']) {
    if (!detectorIndexSource.includes(exportName)) {
      fail(`detector/index.ts must export ${exportName}`);
    }
  }

  const layoutSource = readText('packages/plugin-sdk/src/governance/layout.ts');
  for (const phrase of ['GovernanceLayout', 'GovernanceAdapter', 'defaultGovernanceLayout', '.atm/history/tasks', '.atm/history/reports', '.atm/runtime/budget']) {
      if (!layoutSource.includes(phrase)) {
        fail(`governance/layout.ts missing ${phrase}`);
      }
    }

  const lifecycleSource = readText('packages/plugin-sdk/src/lifecycle.ts');
  if (!lifecycleSource.includes('export enum AtomLifecycleMode')) {
    fail('lifecycle.ts must define AtomLifecycleMode enum');
  }
  for (const value of [`Birth = 'birth'`, `Evolution = 'evolution'`]) {
    if (!lifecycleSource.includes(value)) {
      fail(`AtomLifecycleMode missing ${value}`);
    }
  }
  for (const interfaceName of ['VersionResolver', 'QualityMetricsComparator', 'UpgradeProposalAdapter']) {
    if (!lifecycleSource.includes(`interface ${interfaceName}`)) {
      fail(`lifecycle.ts missing ${interfaceName}`);
    }
  }

  const effectNodeSource = readText('packages/plugin-sdk/src/effect-node.ts');
  for (const phrase of ['interface EffectNode', 'defaultMode', "'dry-run'", "'--apply'", 'ExecuteAgentTaskEffectNode']) {
    if (!effectNodeSource.includes(phrase)) {
      fail(`effect-node.ts missing ${phrase}`);
    }
  }

  const policeSource = readText('packages/plugin-sdk/src/police.ts');
  for (const phrase of [
    'PoliceCheckKind',
    'dependency-graph',
    'PoliceFinding',
    'PoliceFamilyGateReport',
    'EvidenceRef'
  ]) {
    if (!policeSource.includes(phrase)) {
      fail(`police.ts missing ${phrase}`);
    }
  }

  const policeFamilySource = [
    readText('packages/core/src/police/family.ts'),
    readText('packages/core/src/police/types.ts'),
    readText('packages/core/src/police/shared.ts')
  ].join('\n');
  for (const phrase of [
    'interface PoliceFinding',
    'interface PoliceFamilyGateReport',
    'runDedupPolice',
    'runDemandPolice',
    'runQualityPolice',
    'runMapIntegrationPolice',
    'runAtomizationPolice',
    'runPoliceFamilyGate',
    'metadata: {',
    'policeFinding'
  ]) {
    if (!policeFamilySource.includes(phrase)) {
      fail(`core police family contract missing ${phrase}`);
    }
  }

  const storesSource = readText('packages/plugin-sdk/src/governance/stores.ts');
    for (const storeName of ['TaskStore', 'LockStore', 'DocumentIndex', 'ShardStore', 'ArtifactStore', 'LogStore', 'RunReportStore', 'MarkdownJsonStateStore', 'RuleGuard', 'EvidenceStore', 'ContextBudgetGuard']) {
    if (!storesSource.includes(`interface ${storeName}`)) {
      fail(`governance/stores.ts missing ${storeName}`);
    }
  }

  const schema = readJson('schemas/atomic-spec.schema.json');
  const lifecycleMode = schema.$defs?.compatibility?.properties?.lifecycleMode;
  if (!Array.isArray(lifecycleMode?.enum) || !lifecycleMode.enum.includes('birth') || !lifecycleMode.enum.includes('evolution')) {
    fail('atomic-spec compatibility.lifecycleMode must support birth and evolution');
  }
  if (schema.properties?.lifecycleMode) {
    fail('atomic-spec must not define a top-level lifecycleMode');
  }

  const adapterGuide = readText('docs/ADAPTER_GUIDE.md');
  for (const phrase of ['ProjectAdapter', 'LanguageAdapter', 'InjectorPlugin', 'VersionResolver', 'compatibility.lifecycleMode', 'ContextBudgetGuard', 'getFastStaticCheck', 'getDefaultStaticCheck', 'getAllStaticCheck']) {
    if (!adapterGuide.includes(phrase)) {
      fail(`docs/ADAPTER_GUIDE.md missing ${phrase}`);
    }
  }

  const localGitSource = readText('packages/adapter-local-git/src/index.ts');
  if (!localGitSource.includes('ProjectAdapter as SdkProjectAdapter') || !localGitSource.includes('extends SdkProjectAdapter')) {
    fail('adapter-local-git must align its ProjectAdapter interface with Plugin SDK ProjectAdapter');
  }

  const languageJsSource = readText('packages/language-js/src/index.ts');
  if (!languageJsSource.includes('LanguageAdapter as SdkLanguageAdapter') || !languageJsSource.includes('SdkLanguageAdapter<Profile, Request, Report>')) {
    fail('language-js must align its LanguageAdapter interface with Plugin SDK LanguageAdapter');
  }
  const languageCSharpSource = readText('packages/language-csharp/src/index.ts');
  if (!languageCSharpSource.includes('LanguageAdapter as SdkLanguageAdapter') || !languageCSharpSource.includes('SdkLanguageAdapter<Profile, Request, Report>')) {
    fail('language-csharp must align its LanguageAdapter interface with Plugin SDK LanguageAdapter');
  }

  const languageAdapterSource = readText('packages/plugin-sdk/src/language-adapter.ts');
  for (const phrase of [
    'type LanguageAdapterStaticCheckTier',
    'interface LanguageAdapterStaticCheckPlan',
    'getFastStaticCheck(profile: Profile)',
    'getDefaultStaticCheck(profile: Profile)',
    'getAllStaticCheck(profile: Profile)'
  ]) {
    if (!languageAdapterSource.includes(phrase)) {
      fail(`language-adapter.ts missing ${phrase}`);
    }
  }

  const lifecycleGuide = readText('docs/LIFECYCLE.md');
  for (const phrase of ['Breaking Change Policy', 'stable adapter contract', 'compatibility.lifecycleMode', 'getFastStaticCheck(profile)', 'getDefaultStaticCheck(profile)', 'getAllStaticCheck(profile)']) {
    if (!lifecycleGuide.includes(phrase)) {
      fail(`docs/LIFECYCLE.md missing ${phrase}`);
    }
  }

  const hostGovernanceGuide = readText('docs/HOST_GOVERNANCE_INTEGRATION.md');
  for (const phrase of ['adapter-aware static gate', 'fast/default/all static-check selectors', 'getFastStaticCheck(profile)', 'getDefaultStaticCheck(profile)', 'getAllStaticCheck(profile)']) {
    if (!hostGovernanceGuide.includes(phrase)) {
      fail(`docs/HOST_GOVERNANCE_INTEGRATION.md missing ${phrase}`);
    }
  }

  const testRunnerSource = readText('packages/plugin-sdk/src/test-runner.ts');
  for (const phrase of [
    'type AtomicHealthGateId',
    'interface TestRunnerPlugin',
    'interface TestRunnerPluginContext',
    'interface TestRunnerPluginPlan',
    'interface AtomicTestRunnerConfig',
    'interface AtomicDefaultGateConfig'
  ]) {
    if (!testRunnerSource.includes(phrase)) {
      fail(`test-runner.ts missing ${phrase}`);
    }
  }

  // ---- behavior SDK surface checks ----
  const behaviorSource = readText('packages/plugin-sdk/src/behavior.ts');
  for (const phrase of [
    'EVOLVE_DELEGATION_TARGET',
    'ATM-2-0020:ProposeAtomicUpgrade',
    'interface AtomBehavior',
    'interface AtomBehaviorContext',
    'interface AtomBehaviorInput',
    'interface AtomBehaviorOutput',
    'interface AtomBehaviorRegistryTransition',
    'interface AtomBehaviorRollbackPlan',
    'actionCategories',
    'execute('
  ]) {
    if (!behaviorSource.includes(phrase)) {
      fail(`behavior.ts missing: ${phrase}`);
    }
  }

  const behaviorRegistrySource = readText('packages/plugin-sdk/src/behavior-registry.ts');
  for (const phrase of [
    'class BehaviorRegistry',
    'register(',
    'resolve(',
    'resolveOrThrow(',
    'listRegisteredBehaviorIds(',
    'listActions(',
    'executeGuarded(',
    'EVOLVE_DELEGATION_TARGET',
    'evolve-must-delegate-to-propose-atomic-upgrade',
    'behavior-not-found:'
  ]) {
    if (!behaviorRegistrySource.includes(phrase)) {
      fail(`behavior-registry.ts missing: ${phrase}`);
    }
  }

  const sdkIndexSource = readText('packages/plugin-sdk/src/index.ts');
  for (const exportName of ['AtomBehavior', 'BehaviorRegistry', 'EVOLVE_DELEGATION_TARGET', 'AtomBehaviorOutput', 'detectEvidencePatterns', 'EvidencePatternDetectorReport']) {
    if (!sdkIndexSource.includes(exportName)) {
      fail(`packages/plugin-sdk/src/index.ts must export ${exportName}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[plugin-sdk:${mode}] ok (adapter, language, capability, lifecycle, governance store, and behavior SDK contracts verified)`);
}
