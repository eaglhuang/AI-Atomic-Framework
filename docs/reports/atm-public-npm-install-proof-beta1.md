# Public npm install proof

- Status: **BLOCKED / INCONCLUSIVE**
- Package: `@ai-atomic-framework/cli@0.1.0-beta.1`
- Registry: https://registry.npmjs.org

```json
{
  "schemaId": "atm.publicNpmInstallProof.v1",
  "package": "@ai-atomic-framework/cli",
  "version": "0.1.0-beta.1",
  "registry": "https://registry.npmjs.org",
  "status": "blocked",
  "publicRegistry": false,
  "temporaryRootRemoved": true,
  "blockedReason": "public clean-consumer install proof failed",
  "error": "Error: Command failed: C:\\Users\\User\\AppData\\Local\\Temp\\atm-public-npm-oqJlFk\\consumer\\node_modules\\.bin\\atm.cmd --version\nnode:internal/modules/esm/resolve:274\r\n    throw new ERR_MODULE_NOT_FOUND(\r\n          ^\r\n\r\nError [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\Users\\User\\AppData\\Local\\Temp\\atm-public-npm-oqJlFk\\consumer\\node_modules\\@ai-atomic-framework\\integration-claude-code\\dist\\index.js' imported from C:\\Users\\User\\AppData\\Local\\Temp\\atm-public-npm-oqJlFk\\consumer\\node_modules\\@ai-atomic-framework\\cli\\dist\\commands\\integration\\adapters.js\r\n    at finalizeResolution (node:internal/modules/esm/resolve:274:11)\r\n    at moduleResolve (node:internal/modules/esm/resolve:864:10)\r\n    at defaultResolve (node:internal/modules/esm/resolve:990:11)\r\n    at #cachedDefaultResolve (node:internal/modules/esm/loader:718:20)\r\n    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:735:38)\r\n    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:764:52)\r\n    at #resolve (node:internal/modules/esm/loader:700:17)\r\n    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:620:35)\r\n    at ModuleJob.syncLink (node:internal/modules/esm/module_job:143:33)\r\n    at ModuleJob.link (node:internal/modules/esm/module_job:228:17) {\r\n  code: 'ERR_MODULE_NOT_FOUND',\r\n  url: 'file:///C:/Users/User/AppData/Local/Temp/atm-public-npm-oqJlFk/consumer/node_modules/@ai-atomic-framework/integration-claude-code/dist/index.js'\r\n}\r\n\r\nNode.js v24.12.0\r\n"
}
```
