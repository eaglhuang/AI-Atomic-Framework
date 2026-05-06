import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAtomSpaceLayout,
  defaultAtomSpecFileName,
  defaultAtomTestFileName,
  defaultAtomWorkbenchRoot,
  resolveAtomWorkbenchPath,
  resolveCanonicalAtomFolderName
} from './atom-space.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

export const defaultAtomSpecTemplatePath = path.join(repoRoot, 'templates', 'atom.spec.template.json');
export const defaultAtomTestTemplatePath = path.join(repoRoot, 'templates', 'atom.test.template.ts');

export {
  defaultAtomWorkbenchRoot,
  defaultAtomSpecFileName,
  defaultAtomTestFileName,
  resolveAtomWorkbenchPath
};

export function scaffoldAtomWorkbench(normalizedModel, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const atomSpace = createAtomSpaceLayout(normalizedModel, {
    repositoryRoot,
    workbenchPath: options.workbenchPath,
    workbenchRoot: options.workbenchRoot,
    specFileName: options.specFileName,
    testFileName: options.testFileName
  });
  const workbenchPath = atomSpace.workbenchPath;
  const specOutputPath = atomSpace.specPath;
  const testOutputPath = atomSpace.testPath;
  const templateMap = createTemplateMap(normalizedModel, {
    specPath: specOutputPath,
    testPath: testOutputPath,
    workbenchPath
  });
  const files = [
    {
      kind: 'spec',
      outputPath: specOutputPath,
      templatePath: path.resolve(options.specTemplatePath ?? defaultAtomSpecTemplatePath),
      content: renderTemplate(path.resolve(options.specTemplatePath ?? defaultAtomSpecTemplatePath), templateMap)
    },
    {
      kind: 'test',
      outputPath: testOutputPath,
      templatePath: path.resolve(options.testTemplatePath ?? defaultAtomTestTemplatePath),
      content: renderTemplate(path.resolve(options.testTemplatePath ?? defaultAtomTestTemplatePath), templateMap)
    }
  ];

  const result = {
    ok: true,
    atomId: normalizedModel.identity.atomId,
    workbenchPath: toPortablePath(workbenchPath),
    dryRun: options.dryRun === true,
    overwrittenExisting: options.overwriteExisting === true,
    createdFiles: [],
    overwrittenFiles: [],
    skippedFiles: [],
    renderedFiles: files.map((file) => ({
      kind: file.kind,
      outputPath: toPortablePath(file.outputPath),
      templatePath: toPortablePath(file.templatePath)
    }))
  };

  if (!result.dryRun) {
    mkdirSync(workbenchPath, { recursive: true });
  }

  for (const file of files) {
    const exists = existsSync(file.outputPath);
    if (exists && !result.overwrittenExisting) {
      result.skippedFiles.push({
        kind: file.kind,
        outputPath: toPortablePath(file.outputPath),
        reason: 'exists'
      });
      continue;
    }

    if (!result.dryRun) {
      writeFileSync(file.outputPath, file.content, 'utf8');
    }

    const record = {
      kind: file.kind,
      outputPath: toPortablePath(file.outputPath)
    };
    if (exists) {
      result.overwrittenFiles.push(record);
    } else {
      result.createdFiles.push(record);
    }
  }

  return result;
}

function createTemplateMap(normalizedModel, options) {
  return {
    atomId: normalizedModel.identity.atomId,
    atomIdJson: JSON.stringify(normalizedModel.identity.atomId),
    atomIdSafeSegment: resolveCanonicalAtomFolderName(normalizedModel.identity.atomId),
    titleJson: JSON.stringify(normalizedModel.identity.title),
    descriptionJson: JSON.stringify(normalizedModel.identity.description),
    tagsJson: JSON.stringify(normalizedModel.identity.tags, null, 2),
    schemaIdJson: JSON.stringify(normalizedModel.schema.schemaId),
    specVersionJson: JSON.stringify(normalizedModel.schema.specVersion),
    migrationStrategyJson: JSON.stringify(normalizedModel.schema.migration.strategy),
    migrationFromVersionJson: JSON.stringify(normalizedModel.schema.migration.fromVersion),
    migrationNotesJson: JSON.stringify(normalizedModel.schema.migration.notes),
    languagePrimaryJson: JSON.stringify(normalizedModel.execution.language.primary),
    sourceExtensionsJson: JSON.stringify(normalizedModel.execution.language.sourceExtensions, null, 2),
    toolingJson: JSON.stringify(normalizedModel.execution.language.tooling, null, 2),
    runtimeKindJson: JSON.stringify(normalizedModel.execution.runtime.kind),
    runtimeVersionRangeJson: JSON.stringify(normalizedModel.execution.runtime.versionRange),
    runtimeEnvironmentJson: JSON.stringify(normalizedModel.execution.runtime.environment),
    projectAdapterJson: JSON.stringify(normalizedModel.execution.adapterRequirements.projectAdapter),
    storageJson: JSON.stringify(normalizedModel.execution.adapterRequirements.storage),
    capabilitiesJson: JSON.stringify(normalizedModel.execution.adapterRequirements.capabilities, null, 2),
    coreVersionJson: JSON.stringify(normalizedModel.execution.compatibility.coreVersion),
    registryVersionJson: JSON.stringify(normalizedModel.execution.compatibility.registryVersion),
    pluginApiVersionJson: JSON.stringify(normalizedModel.execution.compatibility.pluginApiVersion),
    languageAdapterJson: JSON.stringify(normalizedModel.execution.compatibility.languageAdapter),
    hashAlgorithmJson: JSON.stringify(normalizedModel.hashLock.algorithm),
    hashDigestJson: JSON.stringify(normalizedModel.hashLock.digest),
    canonicalizationJson: JSON.stringify(normalizedModel.hashLock.canonicalization),
    dependencyExternalJson: JSON.stringify(normalizedModel.execution.dependencyPolicy.external),
    dependencyHostCouplingJson: JSON.stringify(normalizedModel.execution.dependencyPolicy.hostCoupling),
    inputsJson: JSON.stringify(normalizedModel.ports.inputs, null, 2),
    outputsJson: JSON.stringify(normalizedModel.ports.outputs, null, 2),
    validationCommandsJson: JSON.stringify(normalizedModel.execution.validation.commands, null, 2),
    validationEvidenceRequiredJson: JSON.stringify(normalizedModel.execution.validation.evidenceRequired),
    performanceHotPathJson: JSON.stringify(normalizedModel.execution.performanceBudget.hotPath),
    performanceInputMutationJson: JSON.stringify(normalizedModel.execution.performanceBudget.inputMutation),
    performanceMaxDurationMsJson: JSON.stringify(normalizedModel.execution.performanceBudget.maxDurationMs),
    specRelativePathJson: JSON.stringify(path.basename(options.specPath)),
    testRelativePathJson: JSON.stringify(path.basename(options.testPath)),
    workbenchPathJson: JSON.stringify(toPortablePath(options.workbenchPath))
  };
}

function renderTemplate(templatePath, values) {
  const template = readFileSync(templatePath, 'utf8');
  return `${template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`Unknown scaffold template token: ${key}`);
    }
    return values[key];
  })}\n`;
}

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}