# Public npm install proof

- Status: **VERIFIED**
- Package: `@ai-atomic-framework/cli@0.1.0-beta.2`
- Registry: https://registry.npmjs.org

```json
{
  "schemaId": "atm.publicNpmInstallProof.v1",
  "package": "@ai-atomic-framework/cli",
  "version": "0.1.0-beta.2",
  "registry": "https://registry.npmjs.org",
  "status": "verified",
  "publicRegistry": true,
  "registryVersion": "0.1.0-beta.2",
  "distTarball": "https://registry.npmjs.org/@ai-atomic-framework/cli/-/cli-0.1.0-beta.2.tgz",
  "distIntegrity": "sha512-Qj0nJbAGRXUftG0uLDuiJ4NCAd6Vuhnf5Lezwf6XEYN5N8gAuZpfAk/uKz7OJNPHH6+jQG3c0tUtCiZd6Rg5ug==",
  "tarballSha256": "7d53e9c4755632ac772ffa8be0c4b32085966425e0fc4bec60184c35e37e227d",
  "cliVersion": "{\n  \"ok\": true,\n  \"command\": \"version\",\n  \"mode\": \"standalone\",\n  \"cwd\": \"C:\\\\Users\\\\User\\\\AI-Atomic-Framework\",\n  \"messages\": [\n    {\n      \"level\": \"info\",\n      \"code\": \"ATM_CLI_VERSION\",\n      \"text\": \"ATM framework version 0.1.0-beta.2.\",\n      \"data\": {}\n    }\n  ],\n  \"evidence\": {\n    \"frameworkVersion\": \"0.1.0-beta.2\",\n    \"runnerMode\": {\n      \"schemaId\": \"atm.runnerMode.v1\",\n      \"mode\": \"unknown\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-ygIc0r/consumer/node_modules/@ai-atomic-framework/cli/dist/atm.mjs\",\n      \"sourceDrift\": {\n        \"schemaId\": \"atm.runnerSourceDrift.v1\",\n        \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-ygIc0r/consumer/node_modules/@ai-atomic-framework/cli/dist/atm.mjs\",\n        \"frozenEntrypoint\": false,\n        \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n        \"runnerMtime\": \"2026-09-11T00:08:17.410Z\",\n        \"newestSourceMtime\": \"2026-09-11T00:02:17.695Z\",\n        \"sourceSeal\": {\n          \"present\": false,\n          \"valid\": false,\n          \"digest\": null\n        },\n        \"syncRequired\": false,\n        \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n        \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n      },\n      \"normalGovernanceCommand\": \"node atm.mjs ...\",\n      \"sourceFirstCommand\": \"node atm.dev.mjs ...\",\n      \"sourceFirstOnlyWhen\": \"explicit source-first framework validation is requested for unbuilt source changes\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\",\n      \"frozenRunnerSources\": [\n        \"release/atm-onefile/atm.mjs\",\n        \"packages/cli/dist/atm.js\"\n      ],\n      \"guidance\": \"Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build and rerun the frozen entrypoint.\"\n    },\n    \"runnerSourceDrift\": {\n      \"schemaId\": \"atm.runnerSourceDrift.v1\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-ygIc0r/consumer/node_modules/@ai-atomic-framework/cli/dist/atm.mjs\",\n      \"frozenEntrypoint\": false,\n      \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n      \"runnerMtime\": \"2026-09-11T00:08:17.410Z\",\n      \"newestSourceMtime\": \"2026-09-11T00:02:17.695Z\",\n      \"sourceSeal\": {\n        \"present\": false,\n        \"valid\": false,\n        \"digest\": null\n      },\n      \"syncRequired\": false,\n      \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n    }\n  },\n  \"nextAction\": null,\n  \"taskIntent\": null,\n  \"userNotice\": null,\n  \"runnerMode\": {\n    \"schemaId\": \"atm.runnerMode.v1\",\n    \"mode\": \"unknown\",\n    \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-ygIc0r/consumer/node_modules/@ai-atomic-framework/cli/dist/atm.mjs\",\n    \"sourceDrift\": {\n      \"schemaId\": \"atm.runnerSourceDrift.v1\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-ygIc0r/consumer/node_modules/@ai-atomic-framework/cli/dist/atm.mjs\",\n      \"frozenEntrypoint\": false,\n      \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n      \"runnerMtime\": \"2026-09-11T00:08:17.410Z\",\n      \"newestSourceMtime\": \"2026-09-11T00:02:17.695Z\",\n      \"sourceSeal\": {\n        \"present\": false,\n        \"valid\": false,\n        \"digest\": null\n      },\n      \"syncRequired\": false,\n      \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n    },\n    \"normalGovernanceCommand\": \"node atm.mjs ...\",\n    \"sourceFirstCommand\": \"node atm.dev.mjs ...\",\n    \"sourceFirstOnlyWhen\": \"explicit source-first framework validation is requested for unbuilt source changes\",\n    \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\",\n    \"frozenRunnerSources\": [\n      \"release/atm-onefile/atm.mjs\",\n      \"packages/cli/dist/atm.js\"\n    ],\n    \"guidance\": \"Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build and rerun the frozen entrypoint.\"\n  },\n  \"frameworkReport\": null,\n  \"frameworkClaim\": null,\n  \"evidenceSummary\": null,\n  \"guardReport\": null,\n  \"taskflowReadiness\": null,\n  \"commitBundle\": null,\n  \"skillGrowth\": null,\n  \"laneSession\": null,\n  \"severity\": \"success\",\n  \"exitCode\": 0,\n  \"blocking\": false,\n  \"diagnostics\": {\n    \"errorCodes\": [],\n    \"warningCodes\": [],\n    \"infoCodes\": [\n      \"ATM_CLI_VERSION\"\n    ]\n  }\n}",
  "cleanConsumer": true,
  "usedWorkspaceLink": false,
  "temporaryRootRemoved": true
}
```

## Historical beta failures retained for regression context

- `0.1.0-beta.0` resolved from npm but attempted to install unpublished stable
  workspace dependencies at `0.1.0`.
- `0.1.0-beta.1` resolved dependency versions but failed in an isolated
  consumer because `integration-claude-code/dist/index.js` was absent from the
  published runtime closure.

The current result above is for `0.1.0-beta.2`, which passed the same isolated
registry install and `atm --version` check. These historical observations are
retained so the proof demonstrates the regression classes that the new release
actually closes.
