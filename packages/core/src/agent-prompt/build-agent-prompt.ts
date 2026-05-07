export const defaultAgentPromptSchemaId = 'atm.agentPrompt';
export const defaultAgentPromptFileName = 'prompt.md';
export const defaultAgentPromptWorkbenchRoot = 'atomic_workbench/atoms';
export const defaultAgentPromptSpecFileName = 'atom.spec.json';
export const defaultAgentPromptTestFileName = 'atom.test.ts';

export function buildAgentPrompt(normalizedModel, options = {}) {
  const document = createAgentPromptDocument(normalizedModel, options);

  return {
    ok: true,
    atomId: document.atomId,
    promptPath: document.promptPath,
    document,
    markdown: document.markdown
  };
}

export function createAgentPromptDocument(normalizedModel, options = {}) {
  const atomId = normalizedModel?.identity?.atomId;
  const logicalName = normalizedModel?.identity?.logicalName;
  if (!atomId) {
    throw new Error('Normalized model identity.atomId is required.');
  }

  const lifecycleMode = normalizedModel.execution?.compatibility?.lifecycleMode ?? 'birth';
  const workbenchPath = trimSlashes(toPortablePath(options.workbenchPath ?? `${options.workbenchRoot ?? defaultAgentPromptWorkbenchRoot}/${atomId}`));
  const promptFileName = options.promptFileName ?? defaultAgentPromptFileName;
  const specFileName = options.specFileName ?? defaultAgentPromptSpecFileName;
  const testFileName = options.testFileName ?? defaultAgentPromptTestFileName;
  const promptPath = `${workbenchPath}/${promptFileName}`;
  const allowedFiles = unique([
    promptPath,
    `${workbenchPath}/${specFileName}`,
    `${workbenchPath}/${testFileName}`
  ]);
  const validationCommands = unique(normalizedModel.execution?.validation?.commands ?? []);
  const requiredOutputs = unique(
    (normalizedModel.ports?.outputs ?? [])
      .filter((port) => port.kind === 'evidence' || port.required === true)
      .map((port) => port.name)
  );

  const document = {
    schemaId: defaultAgentPromptSchemaId,
    specVersion: '0.1.0',
    migration: {
      strategy: 'additive',
      fromVersion: null,
      notes: 'Initial agent prompt bootstrap schema for controlled birth-pipeline delegation.'
    },
    atomId,
    title: normalizedModel.identity?.title ?? atomId,
    lifecycleMode,
    promptPath,
    frontmatter: {
      forbiddenRules: createForbiddenRules(normalizedModel, lifecycleMode),
      allowedFiles,
      evidenceContract: {
        evidenceRequired: normalizedModel.execution?.validation?.evidenceRequired === true,
        requiredOutputs,
        validationCommands
      }
    },
    sections: {
      goal: `Implement ${atomId}${logicalName ? ` (${logicalName})` : ''} (${normalizedModel.identity?.title ?? atomId}) from its normalized atomic spec.`,
      context: normalizedModel.identity?.description || 'No description provided.',
      inputs: (normalizedModel.ports?.inputs ?? []).map(clonePort),
      outputs: (normalizedModel.ports?.outputs ?? []).map(clonePort),
      instructions: createInstructionList(normalizedModel)
    }
  };

  document.markdown = serializeAgentPromptMarkdown(document);
  return document;
}

export function serializeAgentPromptMarkdown(document) {
  const lines = [
    '---',
    `schemaId: ${quoteYaml(document.schemaId)}`,
    `specVersion: ${quoteYaml(document.specVersion)}`,
    `atomId: ${quoteYaml(document.atomId)}`,
    `title: ${quoteYaml(document.title)}`,
    `lifecycleMode: ${quoteYaml(document.lifecycleMode)}`,
    `promptPath: ${quoteYaml(document.promptPath)}`,
    'forbiddenRules:'
  ];

  for (const rule of document.frontmatter.forbiddenRules) {
    lines.push(`  - ${quoteYaml(rule)}`);
  }

  lines.push('allowedFiles:');
  for (const filePath of document.frontmatter.allowedFiles) {
    lines.push(`  - ${quoteYaml(filePath)}`);
  }

  lines.push('evidenceContract:');
  lines.push(`  evidenceRequired: ${document.frontmatter.evidenceContract.evidenceRequired ? 'true' : 'false'}`);
  lines.push('  requiredOutputs:');
  for (const outputName of document.frontmatter.evidenceContract.requiredOutputs) {
    lines.push(`    - ${quoteYaml(outputName)}`);
  }
  lines.push('  validationCommands:');
  for (const command of document.frontmatter.evidenceContract.validationCommands) {
    lines.push(`    - ${quoteYaml(command)}`);
  }

  lines.push('---');
  lines.push(`# Build Agent Prompt: ${document.title}`);
  lines.push('');
  lines.push('## Goal');
  lines.push(document.sections.goal);
  lines.push('');
  lines.push('## Context');
  lines.push(document.sections.context);
  lines.push('');
  lines.push('## Inputs');
  for (const port of document.sections.inputs) {
    lines.push(`- ${renderPort(port)}`);
  }
  lines.push('');
  lines.push('## Outputs');
  for (const port of document.sections.outputs) {
    lines.push(`- ${renderPort(port)}`);
  }
  lines.push('');
  lines.push('## Instructions');
  document.sections.instructions.forEach((instruction, index) => {
    lines.push(`${index + 1}. ${instruction}`);
  });

  return `${lines.join('\n')}\n`;
}

function createForbiddenRules(normalizedModel, lifecycleMode) {
  const rules = [];
  const hostCoupling = normalizedModel.execution?.dependencyPolicy?.hostCoupling ?? 'forbidden';
  if (hostCoupling === 'adapter-only') {
    rules.push('Keep all host coupling behind adapters; do not call host-specific runtime APIs directly.');
  } else {
    rules.push('Do not introduce host-specific coupling into the atom implementation.');
  }

  const externalPolicy = normalizedModel.execution?.dependencyPolicy?.external ?? 'none';
  if (externalPolicy === 'workspace-only') {
    rules.push('Stay within workspace-only dependencies; do not introduce external services or packages.');
  } else if (externalPolicy === 'none') {
    rules.push('Do not add new external dependencies.');
  }

  const inputMutation = normalizedModel.execution?.performanceBudget?.inputMutation ?? 'forbidden';
  if (inputMutation === 'forbidden') {
    rules.push('Treat input payloads as immutable; do not mutate provided inputs in place.');
  } else if (inputMutation === 'clone-on-write') {
    rules.push('Clone inputs before mutation; do not mutate provided inputs directly.');
  }

  if (lifecycleMode === 'birth') {
    rules.push('Stay in the birth pipeline; do not propose evolution-only or upgrade-specific work.');
  }

  return unique(rules);
}

function createInstructionList(normalizedModel) {
  const instructions = [
    `Use ${quoteInline(normalizedModel.execution?.language?.primary ?? 'unknown')} with ${quoteInline(`${normalizedModel.execution?.runtime?.kind ?? 'runtime'} ${normalizedModel.execution?.runtime?.versionRange ?? ''}`.trim())} as the primary execution target.`,
    'Keep edits inside the allowed files listed in the frontmatter.'
  ];

  if ((normalizedModel.execution?.validation?.commands ?? []).length > 0) {
    instructions.push('Satisfy the validation commands listed in the evidence contract.');
  }

  if (normalizedModel.execution?.validation?.evidenceRequired === true) {
    instructions.push('Return evidence for the required outputs before closing the work.');
  }

  return instructions;
}

function clonePort(port) {
  return {
    name: port.name,
    kind: port.kind,
    required: port.required === true
  };
}

function renderPort(port) {
  return `\`${port.name}\` (\`${port.kind}\`, ${port.required ? 'required' : 'optional'})`;
}

function quoteInline(value) {
  return `\`${String(value)}\``;
}

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value)))];
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/');
}

function trimSlashes(value) {
  return value.replace(/\/+$/g, '');
}