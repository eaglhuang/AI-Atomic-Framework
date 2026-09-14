# Public npm install proof

- Status: **BLOCKED / INCONCLUSIVE**
- Package: `@ai-atomic-framework/cli@0.1.0`
- Registry: https://registry.npmjs.org

```json
{
  "schemaId": "atm.publicNpmInstallProof.v1",
  "package": "@ai-atomic-framework/cli",
  "version": "0.1.0",
  "registry": "https://registry.npmjs.org",
  "status": "blocked",
  "publicRegistry": false,
  "temporaryRootRemoved": true,
  "blockedReason": "npm registry metadata lookup failed or package/version is not published",
  "error": "Error: Command failed: npm.cmd view @ai-atomic-framework/cli@0.1.0 version dist.tarball dist.integrity _id --json\nnpm error code E404\nnpm error 404 No match found for version 0.1.0\nnpm error 404\nnpm error 404  The requested resource '@ai-atomic-framework/cli@0.1.0' could not be found or you do not have permission to access it.\nnpm error 404\nnpm error 404 Note that you can also install from a\nnpm error 404 tarball, folder, http url, or git url.\nnpm error A complete log of this run can be found in: C:\\Users\\User\\AppData\\Local\\npm-cache\\_logs\\2026-09-11T00_04_57_042Z-debug-0.log\n"
}
```

## Live registry recheck (2026-09-14)

The earlier E404 receipt above is historical. A fresh metadata lookup now
resolves `@ai-atomic-framework/cli@0.1.0`, and a clean install from the public
registry succeeds without a workspace link. The expanded seven-command matrix
returned `version=0`, `doctor=0`, `bootstrap=0`, `atm-chart render=2`, and
`atm-chart verify=2`. Both chart commands fail closed because the published
runtime is missing `schemas/governance/default-guards.schema.json` (render:
`ATM_CHART_SCHEMA_SOURCE_MISSING`; verify: `ATM_CHART_MISSING`).

Consequently the public package remains **BLOCKED / INCONCLUSIVE** for the
core-workflow proof. The retained live receipt records registry unpacked size
`3357358` bytes, `78` files, tarball SHA-256
`e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14`, and npm
integrity `sha512-yJTt/zEMZ+YltM09/KJRPQnMeNyFgDcRzhwQbYIEb+rNeD8pnh3LqHW8JhNprKXlsFA0icjRB80sYBYDeyq8jw==`.
The external receipt is retained under
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0052\registry-live-2026-09-14`.
