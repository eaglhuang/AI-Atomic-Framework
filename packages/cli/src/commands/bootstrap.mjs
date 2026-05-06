import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativePathFrom, writeJsonFile } from './shared.mjs';

const bootstrapTaskId = 'BOOTSTRAP-0001';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const templateRoot = path.join(repoRoot, 'templates', 'root-drop');
const templateFiles = [
  {
    source: 'AGENTS.md',
    target: 'AGENTS.md'
  },
  {
    source: path.join('.atm', 'profile', 'default.md'),
    target: path.join('.atm', 'profile', 'default.md')
  },
  {
    source: path.join('.atm', 'context', 'INITIAL_SUMMARY.md'),
    target: path.join('.atm', 'context', 'INITIAL_SUMMARY.md')
  }
];

export function adoptDefaultBootstrap(cwd, options = {}) {
  const force = options.force === true;
  const taskTitle = typeof options.taskTitle === 'string' && options.taskTitle.trim().length > 0
    ? options.taskTitle.trim()
    : 'Bootstrap ATM in this repository';
  const created = [];
  const unchanged = [];
  const paths = createBootstrapPaths(cwd);

  for (const directoryPath of Object.values(paths.directories)) {
    ensureDirectory(directoryPath, cwd, created, unchanged);
  }

  const recommendedPrompt = createRecommendedPrompt();
  const projectProbe = probeRepository(cwd, recommendedPrompt);
  const defaultGuards = createDefaultGuards(projectProbe);

  writeJson(paths.projectProbePath, projectProbe, cwd, force, created, unchanged);
  writeJson(paths.defaultGuardsPath, defaultGuards, cwd, force, created, unchanged);
  writeJson(paths.taskPath, createBootstrapTask(taskTitle, projectProbe, paths), cwd, force, created, unchanged);
  writeJson(paths.lockPath, createBootstrapLock(paths), cwd, force, created, unchanged);
  writeJson(paths.evidencePath, createBootstrapEvidence(projectProbe, defaultGuards, paths), cwd, force, created, unchanged);

  const templateTokens = {
    RECOMMENDED_PROMPT: recommendedPrompt,
    BOOTSTRAP_TASK_PATH: relativePathFrom(cwd, paths.taskPath),
    BOOTSTRAP_LOCK_PATH: relativePathFrom(cwd, paths.lockPath),
    BOOTSTRAP_PROFILE_PATH: relativePathFrom(cwd, paths.profilePath),
    PROJECT_PROBE_PATH: relativePathFrom(cwd, paths.projectProbePath),
    DEFAULT_GUARDS_PATH: relativePathFrom(cwd, paths.defaultGuardsPath),
    BOOTSTRAP_EVIDENCE_PATH: relativePathFrom(cwd, paths.evidencePath),
    REPOSITORY_KIND: projectProbe.repositoryKind,
    HOST_WORKFLOW: projectProbe.hostWorkflow,
    PACKAGE_MANAGER: projectProbe.packageManager
  };

  for (const templateFile of templateFiles) {
    writeTemplate(
      path.join(templateRoot, templateFile.source),
      path.join(cwd, templateFile.target),
      templateTokens,
      cwd,
      force,
      created,
      unchanged
    );
  }

  return {
    created,
    unchanged,
    adoptedProfile: 'default',
    bootstrapTaskPath: relativePathFrom(cwd, paths.taskPath),
    bootstrapLockPath: relativePathFrom(cwd, paths.lockPath),
    agentInstructionsPath: relativePathFrom(cwd, paths.agentInstructionsPath),
    profilePath: relativePathFrom(cwd, paths.profilePath),
    projectProbePath: relativePathFrom(cwd, paths.projectProbePath),
    defaultGuardsPath: relativePathFrom(cwd, paths.defaultGuardsPath),
    evidencePath: relativePathFrom(cwd, paths.evidencePath),
    projectProbe,
    recommendedPrompt
  };
}

function createBootstrapPaths(cwd) {
  const atmRoot = path.join(cwd, '.atm');
  return {
    agentInstructionsPath: path.join(cwd, 'AGENTS.md'),
    profilePath: path.join(atmRoot, 'profile', 'default.md'),
    projectProbePath: path.join(atmRoot, 'state', 'project-probe.json'),
    defaultGuardsPath: path.join(atmRoot, 'state', 'default-guards.json'),
    taskPath: path.join(atmRoot, 'tasks', `${bootstrapTaskId}.json`),
    lockPath: path.join(atmRoot, 'locks', `${bootstrapTaskId}.lock.json`),
    evidencePath: path.join(atmRoot, 'evidence', `${bootstrapTaskId}.json`),
    directories: {
      profile: path.join(atmRoot, 'profile'),
      state: path.join(atmRoot, 'state'),
      tasks: path.join(atmRoot, 'tasks'),
      locks: path.join(atmRoot, 'locks'),
      artifacts: path.join(atmRoot, 'artifacts'),
      logs: path.join(atmRoot, 'logs'),
      evidence: path.join(atmRoot, 'evidence'),
      context: path.join(atmRoot, 'context'),
      reports: path.join(atmRoot, 'reports')
    }
  };
}

function createBootstrapTask(taskTitle, projectProbe, paths) {
  return {
    schemaVersion: 'atm.workItem.v0.1',
    id: bootstrapTaskId,
    title: taskTitle,
    status: 'open',
    taskKind: 'bootstrap',
    repositoryKind: projectProbe.repositoryKind,
    summary: 'Establish the default ATM bootstrap pack, verify the host workflow, and leave initial evidence for the next agent run.',
    scope: [
      'AGENTS.md',
      relativePathFrom(path.dirname(paths.taskPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.lockPath)
    ],
    guardPaths: [
      relativePathFrom(path.dirname(paths.taskPath), paths.defaultGuardsPath)
    ],
    evidencePath: relativePathFrom(path.dirname(paths.taskPath), paths.evidencePath),
    nextPrompt: createRecommendedPrompt()
  };
}

function createBootstrapLock(paths) {
  return {
    schemaVersion: 'atm.scopeLock.v0.1',
    taskId: bootstrapTaskId,
    status: 'open',
    files: [
      'AGENTS.md',
      '.atm/config.json',
      relativePathFrom(path.dirname(paths.lockPath), paths.profilePath),
      relativePathFrom(path.dirname(paths.lockPath), paths.projectProbePath),
      relativePathFrom(path.dirname(paths.lockPath), paths.defaultGuardsPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.taskPath),
      relativePathFrom(path.dirname(paths.lockPath), paths.evidencePath)
    ]
  };
}

function createBootstrapEvidence(projectProbe, defaultGuards, paths) {
  return {
    schemaVersion: 'atm.evidence.v0.1',
    taskId: bootstrapTaskId,
    status: 'seeded',
    summary: 'Default ATM bootstrap pack created.',
    repositoryKind: projectProbe.repositoryKind,
    packageManager: projectProbe.packageManager,
    recommendedPrompt: createRecommendedPrompt(),
    guardIds: defaultGuards.guards.map((guard) => guard.id),
    artifactDirectories: [
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.artifacts),
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.logs),
      relativePathFrom(path.dirname(paths.evidencePath), paths.directories.reports)
    ]
  };
}

function createDefaultGuards(projectProbe) {
  return {
    schemaVersion: 'atm.defaultGuards.v0.1',
    repositoryKind: projectProbe.repositoryKind,
    guards: [
      {
        id: 'preserve-host-workflow',
        summary: 'Do not invent a build step, package manager, or runtime workflow that the host repository does not already use.'
      },
      {
        id: 'lock-before-edit',
        summary: 'Create or respect a scope lock before editing files outside the bootstrap pack.'
      },
      {
        id: 'evidence-after-change',
        summary: 'Record validation evidence and a short context summary before declaring the task done.'
      }
    ]
  };
}

function probeRepository(cwd, recommendedPrompt) {
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    : null;
  const scripts = packageJson?.scripts || {};
  const hasIndexHtml = existsSync(path.join(cwd, 'index.html'));
  const hasArticlesIndex = existsSync(path.join(cwd, 'articles', 'index.html'));
  const hasAssetsCss = existsSync(path.join(cwd, 'assets', 'css'));
  const topLevelEntries = existsSync(cwd)
    ? readdirSync(cwd, { withFileTypes: true }).map((entry) => entry.name).sort()
    : [];

  let repositoryKind = 'generic-repository';
  if (packageJson) {
    repositoryKind = 'javascript-package';
  } else if (hasIndexHtml || hasArticlesIndex || hasAssetsCss) {
    repositoryKind = 'static-site';
  }

  return {
    schemaVersion: 'atm.projectProbe.v0.1',
    repositoryKind,
    packageManager: detectPackageManager(cwd, packageJson),
    hostWorkflow: packageJson ? 'script-driven' : (repositoryKind === 'static-site' ? 'file-publish' : 'manual'),
    sourceControl: existsSync(path.join(cwd, '.git')) ? 'git' : 'filesystem',
    detectedFiles: topLevelEntries,
    commands: {
      test: scripts.test ? createPackageManagerCommand(cwd, packageJson, 'test') : null,
      typecheck: scripts.typecheck ? createPackageManagerCommand(cwd, packageJson, 'typecheck') : null,
      lint: scripts.lint ? createPackageManagerCommand(cwd, packageJson, 'lint') : null
    },
    recommendedPrompt
  };
}

function detectPackageManager(cwd, packageJson) {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(path.join(cwd, 'package-lock.json')) || packageJson) {
    return 'npm';
  }
  return 'none';
}

function createPackageManagerCommand(cwd, packageJson, scriptName) {
  const manager = detectPackageManager(cwd, packageJson);
  if (manager === 'pnpm') {
    return `pnpm run ${scriptName}`;
  }
  if (manager === 'yarn') {
    return `yarn ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function createRecommendedPrompt() {
  return 'Read README.md if present, then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json. Continue the bootstrap task without changing the host workflow, and write evidence to .atm/evidence/BOOTSTRAP-0001.json.';
}

function ensureDirectory(directoryPath, cwd, created, unchanged) {
  if (existsSync(directoryPath)) {
    unchanged.push(relativePathFrom(cwd, directoryPath));
    return;
  }
  mkdirSync(directoryPath, { recursive: true });
  created.push(relativePathFrom(cwd, directoryPath));
}

function writeTemplate(sourcePath, targetPath, tokens, cwd, force, created, unchanged) {
  const rendered = renderTemplate(readFileSync(sourcePath, 'utf8'), tokens);
  writeText(targetPath, rendered, cwd, force, created, unchanged);
}

function writeJson(targetPath, value, cwd, force, created, unchanged) {
  if (existsSync(targetPath) && !force) {
    unchanged.push(relativePathFrom(cwd, targetPath));
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeJsonFile(targetPath, value);
  created.push(relativePathFrom(cwd, targetPath));
}

function writeText(targetPath, value, cwd, force, created, unchanged) {
  if (existsSync(targetPath) && !force) {
    unchanged.push(relativePathFrom(cwd, targetPath));
    return;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, value, 'utf8');
  created.push(relativePathFrom(cwd, targetPath));
}

function renderTemplate(template, tokens) {
  let rendered = template;
  for (const [token, value] of Object.entries(tokens)) {
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }
  return rendered;
}