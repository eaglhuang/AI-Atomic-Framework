# Public npm install proof

- Status: **VERIFIED**
- Package: `@ai-atomic-framework/cli@0.1.0-beta.5`
- Registry: https://registry.npmjs.org

```json
{
  "schemaId": "atm.publicNpmInstallProof.v1",
  "package": "@ai-atomic-framework/cli",
  "version": "0.1.0-beta.5",
  "registry": "https://registry.npmjs.org",
  "status": "verified",
  "publicRegistry": true,
  "registryVersion": "0.1.0-beta.5",
  "distTarball": "https://registry.npmjs.org/@ai-atomic-framework/cli/-/cli-0.1.0-beta.5.tgz",
  "distIntegrity": "sha512-McuJ7lbhZdI4ltS7iZIZUjb3yXWsTrbWw/midG1VuHfYn3xTlZ1M4qjhjvQcgH8+Ic+hNox97GH5dwrHCeHhuQ==",
  "registryUnpackedSize": 3357365,
  "registryFileCount": 78,
  "artifactBudget": {
    "maxPackedBytes": 3365772,
    "maxPackedEntries": 308
  },
  "tarballSha256": "d08dfbbe772d4cb71b6849f270949321481072224dc7e0f84a1892bf0ba5e67f",
  "cliVersion": "{\n  \"ok\": true,\n  \"command\": \"version\",\n  \"mode\": \"standalone\",\n  \"cwd\": \"C:\\\\Users\\\\User\\\\AI-Atomic-Framework\",\n  \"messages\": [\n    {\n      \"level\": \"info\",\n      \"code\": \"ATM_CLI_VERSION\",\n      \"text\": \"ATM framework version 0.1.0-beta.5.\",\n      \"data\": {}\n    }\n  ],\n  \"evidence\": {\n    \"frameworkVersion\": \"0.1.0-beta.5\",\n    \"runnerMode\": {\n      \"schemaId\": \"atm.runnerMode.v1\",\n      \"mode\": \"unknown\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-INKvU7/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs\",\n      \"sourceDrift\": {\n        \"schemaId\": \"atm.runnerSourceDrift.v1\",\n        \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-INKvU7/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs\",\n        \"frozenEntrypoint\": false,\n        \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n        \"runnerMtime\": \"2026-09-11T17:35:27.807Z\",\n        \"newestSourceMtime\": \"2026-09-11T21:19:31.968Z\",\n        \"sourceSeal\": {\n          \"present\": true,\n          \"valid\": true,\n          \"digest\": \"sha256:a528d36b8993587ac1ef4b862cf240740c4f3a62e4ce3c60f8324dbd9764abcf\"\n        },\n        \"syncRequired\": false,\n        \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n        \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n      },\n      \"normalGovernanceCommand\": \"node atm.mjs ...\",\n      \"sourceFirstCommand\": \"node atm.dev.mjs ...\",\n      \"sourceFirstOnlyWhen\": \"explicit source-first framework validation is requested for unbuilt source changes\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\",\n      \"frozenRunnerSources\": [\n        \"release/atm-onefile/atm.mjs\",\n        \"packages/cli/dist/atm.js\"\n      ],\n      \"guidance\": \"Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build and rerun the frozen entrypoint.\"\n    },\n    \"runnerSourceDrift\": {\n      \"schemaId\": \"atm.runnerSourceDrift.v1\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-INKvU7/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs\",\n      \"frozenEntrypoint\": false,\n      \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n      \"runnerMtime\": \"2026-09-11T17:35:27.807Z\",\n      \"newestSourceMtime\": \"2026-09-11T21:19:31.968Z\",\n      \"sourceSeal\": {\n        \"present\": true,\n        \"valid\": true,\n        \"digest\": \"sha256:a528d36b8993587ac1ef4b862cf240740c4f3a62e4ce3c60f8324dbd9764abcf\"\n      },\n      \"syncRequired\": false,\n      \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n    }\n  },\n  \"nextAction\": null,\n  \"taskIntent\": null,\n  \"userNotice\": null,\n  \"runnerMode\": {\n    \"schemaId\": \"atm.runnerMode.v1\",\n    \"mode\": \"unknown\",\n    \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-INKvU7/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs\",\n    \"sourceDrift\": {\n      \"schemaId\": \"atm.runnerSourceDrift.v1\",\n      \"entrypoint\": \"C:/Users/User/AppData/Local/Temp/atm-public-npm-INKvU7/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs\",\n      \"frozenEntrypoint\": false,\n      \"runnerPath\": \"release/atm-onefile/atm.mjs\",\n      \"runnerMtime\": \"2026-09-11T17:35:27.807Z\",\n      \"newestSourceMtime\": \"2026-09-11T21:19:31.968Z\",\n      \"sourceSeal\": {\n        \"present\": true,\n        \"valid\": true,\n        \"digest\": \"sha256:a528d36b8993587ac1ef4b862cf240740c4f3a62e4ce3c60f8324dbd9764abcf\"\n      },\n      \"syncRequired\": false,\n      \"advisory\": \"Current entrypoint is not the frozen runner; source-first/source-import diagnostics may differ from node atm.mjs.\",\n      \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\"\n    },\n    \"normalGovernanceCommand\": \"node atm.mjs ...\",\n    \"sourceFirstCommand\": \"node atm.dev.mjs ...\",\n    \"sourceFirstOnlyWhen\": \"explicit source-first framework validation is requested for unbuilt source changes\",\n    \"syncCommand\": \"ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build\",\n    \"frozenRunnerSources\": [\n      \"release/atm-onefile/atm.mjs\",\n      \"packages/cli/dist/atm.js\"\n    ],\n    \"guidance\": \"Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build and rerun the frozen entrypoint.\"\n  },\n  \"frameworkReport\": null,\n  \"frameworkClaim\": null,\n  \"evidenceSummary\": null,\n  \"guardReport\": null,\n  \"taskflowReadiness\": null,\n  \"commitBundle\": null,\n  \"skillGrowth\": null,\n  \"laneSession\": null,\n  \"severity\": \"success\",\n  \"exitCode\": 0,\n  \"blocking\": false,\n  \"diagnostics\": {\n    \"errorCodes\": [],\n    \"warningCodes\": [],\n    \"infoCodes\": [\n      \"ATM_CLI_VERSION\"\n    ]\n  }\n}",
  "cleanConsumer": true,
  "usedWorkspaceLink": false,
  "temporaryRootRemoved": true
}
```

## TASK-PRF-0052 candidate revalidation (2026-09-14)

The public registry receipt above remains historical (`0.1.0-beta.5`). A fresh
install of the current public `0.1.0` was still **installable-but-core-workflow-incomplete**:
`--version`, `doctor`, and `bootstrap` passed, while `atm-chart render` failed
with `ATM_CHART_SCHEMA_SOURCE_MISSING` for
`schemas/governance/default-guards.schema.json`. The retained external receipt
is `C:\Users\User\atm-benchmark-sink\TASK-PRF-0051\public-install-2026-09-14\public-install-receipt.json`
with SHA-256
`0216e927043b41f27ab69580c5fcdc4c84b229e014437345d41df9a5704c44ba`.

The local candidate built from the repaired source now carries all five
ATMChart source schemas in `dist/npm-runtime/layout/schemas/**`, exposes the
`atm-chart` adopter command, and passes an isolated tarball install followed by
`bootstrap`, `atm-chart render`, and `atm-chart verify`. The candidate pack
measured 2,684,504 unpacked bytes and 71 entries, below the declared budget of
3,365,772 bytes and 308 entries. The focused contract also verified that no
workspace link or extra framework download is needed.

This is candidate evidence only. It does not change the public registry and
does not authorize npm publish; a new public-registry receipt is required after
an independently authorized release.

## TASK-PRF-0053 validator boundary (2026-09-14)

The public validator now requires the complete core workflow (`version`,
`doctor`, `bootstrap`, `atm-chart render`, and `atm-chart verify`) to exit
successfully. It records `requiredSuccessCommandFailures` and
`coreWorkflowPassed`, and uses `--record-blocked` only to preserve a negative
registry receipt rather than turning a failed command into a pass. On the live
`0.1.0` registry install, chart render and verify remain failed because the
published package lacks the default-guards chart schema. The local candidate
passing chart lifecycle remains candidate-only evidence and is not substituted
for this registry result.
