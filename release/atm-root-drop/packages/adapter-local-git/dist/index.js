export const adapterLocalGitPackage = {
    packageName: '@ai-atomic-framework/adapter-local-git',
    packageRole: 'local-git-adapter',
    packageVersion: '0.0.0'
};
export const defaultLocalGitAdapterConfig = {
    registryPath: '.atm/registry',
    reportsPath: '.atm/history/reports',
    dryRun: false,
    lockMode: 'noop',
    gateMode: 'noop',
    docMode: 'noop'
};
export const localGitAdapterRuntime = {
    entrypoint: './local-git-adapter.ts',
    supportsFilesystemRegistryPath: true,
    hostGovernanceRequired: false,
    noopOperations: ['lock', 'gate', 'doc'],
    resultFormat: 'LocalGitAdapterResult'
};
