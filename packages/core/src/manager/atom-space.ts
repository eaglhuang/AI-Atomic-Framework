import path from 'node:path';

export const defaultAtomWorkbenchRoot = 'atomic_workbench/atoms';
export const defaultAtomSpecFileName = 'atom.spec.json';
export const defaultAtomTestFileName = 'atom.test.ts';
export const defaultTestReportFileName = 'atom.test.report.json';

export function createAtomSpaceLayout(normalizedModel: any, options: any = {}) {
  const workbenchPath = resolveAtomWorkbenchPath(normalizedModel, options);

  return {
    atomId: normalizedModel.identity.atomId,
    folderName: resolveCanonicalAtomFolderName(normalizedModel.identity.atomId),
    workbenchPath,
    specPath: path.join(workbenchPath, options.specFileName ?? defaultAtomSpecFileName),
    testPath: path.join(workbenchPath, options.testFileName ?? defaultAtomTestFileName),
    reportPath: path.join(workbenchPath, options.reportFileName ?? defaultTestReportFileName)
  };
}

export function resolveAtomWorkbenchPath(normalizedModel: any, options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  if (options.workbenchPath) {
    return path.resolve(repositoryRoot, options.workbenchPath);
  }

  const workbenchRoot = options.workbenchRoot ?? defaultAtomWorkbenchRoot;
  return path.resolve(repositoryRoot, workbenchRoot, resolveCanonicalAtomFolderName(normalizedModel.identity.atomId));
}

export function resolveAtomicTestReportPath(normalizedModel: any, options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  if (options.reportPath) {
    return path.resolve(repositoryRoot, options.reportPath);
  }

  return createAtomSpaceLayout(normalizedModel, options).reportPath;
}

export function resolveCanonicalAtomFolderName(atomId: any) {
  const folderName = String(atomId ?? '').trim();
  if (!folderName) {
    throw new Error('Atomic ID is required to resolve the canonical atom folder.');
  }
  if (folderName.includes('/') || folderName.includes('\\')) {
    throw new Error(`Atomic ID cannot contain path separators: ${folderName}`);
  }
  return folderName;
}