# ATM Error Codes

Generated from `packages/`, `scripts/`, `tests/`, and `examples/` TypeScript sources.

Regenerate with `npm run generate:error-codes`.

| Code | Location | Context |
| --- | --- | --- |
| `ATM_ACTOR_ID` | `packages/cli/src/commands/actor-registry.ts:6` | export const actorIdEnvVar = 'ATM_ACTOR_ID' as const; |
| `ATM_ACTOR_ID_MISSING` | `packages/cli/src/commands/actor.ts:261` | throw new CliError('ATM_ACTOR_ID_MISSING', &#96;No actor identity was provided. Use --id or set ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).&#96;, { |
| `ATM_ACTOR_LIST` | `packages/cli/src/commands/actor.ts:60` | messages: [message('info', 'ATM_ACTOR_LIST', &#96;Loaded ${registry.actors.length} actor identity record(s).&#96;)], |
| `ATM_ACTOR_NOT_FOUND` | `packages/cli/src/commands/actor.ts:71` | throw new CliError('ATM_ACTOR_NOT_FOUND', &#96;Actor ${resolved.actorId} is not registered in ${actorRegistryRelativePath}.&#96;, { |
| `ATM_ACTOR_REGISTERED` | `packages/cli/src/commands/actor.ts:43` | messages: [message('info', 'ATM_ACTOR_REGISTERED', 'Actor identity has been registered.', { |
| `ATM_ACTOR_RESOLVED` | `packages/cli/src/commands/actor.ts:85` | messages: [message('info', 'ATM_ACTOR_RESOLVED', 'Resolved actor identity from explicit option or environment.')], |
| `ATM_ACTOR_VERIFY_GIT_MISMATCH` | `packages/cli/src/commands/actor.ts:109` | : message('error', 'ATM_ACTOR_VERIFY_GIT_MISMATCH', 'Git identity does not match the resolved actor.', { |
| `ATM_ACTOR_VERIFY_GIT_OK` | `packages/cli/src/commands/actor.ts:108` | ? message('info', 'ATM_ACTOR_VERIFY_GIT_OK', 'Git identity matches the resolved actor.') |
| `ATM_AGENT_PACK_DIFF` | `packages/cli/src/commands/agent-pack.ts:248` | messages: [message('info', 'ATM_AGENT_PACK_DIFF', &#96;Agent pack "${packId}" diff: ${changedFiles.length} changed file(s).&#96;)], |
| `ATM_AGENT_PACK_INSTALL` | `packages/cli/src/commands/agent-pack.ts:166` | dryRun ? 'ATM_AGENT_PACK_INSTALL_DRY_RUN' : 'ATM_AGENT_PACK_INSTALL', |
| `ATM_AGENT_PACK_INSTALL_DRY_RUN` | `packages/cli/src/commands/agent-pack.ts:166` | dryRun ? 'ATM_AGENT_PACK_INSTALL_DRY_RUN' : 'ATM_AGENT_PACK_INSTALL', |
| `ATM_AGENT_PACK_LIST` | `packages/cli/src/commands/agent-pack.ts:93` | messages: [message('info', 'ATM_AGENT_PACK_LIST', installedPacks.length === 0 ? 'No agent packs installed.' : 'Agent packs listed.')], |
| `ATM_AGENT_PACK_MANIFEST_MISSING` | `packages/cli/src/commands/agent-pack.ts:265` | throw new CliError('ATM_AGENT_PACK_MANIFEST_MISSING', &#96;Agent pack "${packId}" manifest was not found. Run install first.&#96;, { |
| `ATM_AGENT_PACK_NOT_INSTALLED` | `packages/cli/src/commands/agent-pack.ts:227` | messages: [message('warn', 'ATM_AGENT_PACK_NOT_INSTALLED', &#96;Agent pack "${packId}" is not installed.&#96;)], |
| `ATM_AGENT_PACK_STALE` | `packages/cli/src/commands/agent-pack.ts:295` | throw new CliError('ATM_AGENT_PACK_STALE', 'Agent pack manifest is stale. Reinstall or re-render the pack from the current SSoT.', { |
| `ATM_AGENT_PACK_UNINSTALL` | `packages/cli/src/commands/agent-pack.ts:212` | messages: [message('info', 'ATM_AGENT_PACK_UNINSTALL', &#96;Agent pack "${packId}" uninstalled (${removedFiles.length} removed, ${backedUpFiles.length} backed up).&#96;)], |
| `ATM_AGENT_PACK_VERIFY_FRESH_OK` | `packages/cli/src/commands/agent-pack.ts:311` | messages: [message('info', 'ATM_AGENT_PACK_VERIFY_FRESH_OK', &#96;Agent pack "${packId}" matches the current ATM source hashes.&#96;)], |
| `ATM_ATOM_ID_INVALID` | `packages/core/src/registry/urn.ts:140` | throw new AtmUrnError('ATM_ATOM_ID_INVALID', 'ATM atom-like URN must use ATM-{bucket}-0000 canonical IDs.', { canonicalId, nodeKind }); |
| `ATM_BOOTSTRAP_CREATED` | `packages/cli/src/commands/bootstrap-entry.ts:24` | ? message('info', 'ATM_BOOTSTRAP_CREATED', 'ATM default bootstrap pack created.') |
| `ATM_BOOTSTRAP_READY` | `packages/cli/src/commands/bootstrap-entry.ts:25` | : message('info', 'ATM_BOOTSTRAP_READY', 'ATM default bootstrap pack already exists; no files were changed.') |
| `ATM_BUCKET_INVALID` | `packages/core/src/manager/id-allocator.ts:26` | throw new AtomIdAllocationError('ATM_BUCKET_INVALID', 'Atom ID bucket must match /^[A-Z][A-Z0-9]*$/.', { bucket }); |
| `ATM_BUCKET_REQUIRED` | `packages/core/src/manager/id-allocator.ts:21` | throw new AtomIdAllocationError('ATM_BUCKET_REQUIRED', 'Atom ID bucket must be a string.', { bucket }); |
| `ATM_BUDGET_CHECKED` | `packages/cli/src/commands/budget.ts:34` | messages: [message('info', 'ATM_BUDGET_CHECKED', 'Context budget evaluated.', { decision: evaluation.decision })], |
| `ATM_BUDGET_GUARD_MISSING` | `packages/cli/src/commands/budget.ts:20` | throw new CliError('ATM_BUDGET_GUARD_MISSING', 'Context budget guard is not available for this adapter.'); |
| `ATM_CANDIDATES_RANK_READY` | `packages/cli/src/commands/candidates.ts:183` | message('info', 'ATM_CANDIDATES_RANK_READY', 'Candidate ranking report generated.', { |
| `ATM_CANONICAL_ID_INVALID` | `packages/core/src/registry/urn.ts:26` | throw new AtmUrnError('ATM_CANONICAL_ID_INVALID', 'Canonical ATM ID is invalid.', { canonicalId }); |
| `ATM_CANONICAL_ID_REQUIRED` | `packages/core/src/registry/urn.ts:116` | throw new AtmUrnError('ATM_CANONICAL_ID_REQUIRED', 'Canonical ATM ID is required.'); |
| `ATM_CHART_FRONTMATTER_INVALID` | `packages/cli/src/commands/atm-chart.ts:419` | throw new CliError('ATM_CHART_FRONTMATTER_INVALID', 'ATMChart markdown is missing its frontmatter block.', { |
| `ATM_CHART_GUARDS_INVALID` | `packages/cli/src/commands/atm-chart.ts:405` | throw new CliError('ATM_CHART_GUARDS_INVALID', 'Default guards file is missing the guards array.', { |
| `ATM_CHART_GUARDS_MISSING` | `packages/cli/src/commands/agent-pack.ts:118` | if (!(e instanceof CliError) &#124;&#124; (e as CliError).code !== 'ATM_CHART_GUARDS_MISSING') throw e; |
| `ATM_CHART_MISSING` | `packages/cli/src/commands/atm-chart.ts:265` | throw new CliError('ATM_CHART_MISSING', 'ATMChart markdown was not found. Run &#96;node atm.mjs atm-chart render&#96; first.', { |
| `ATM_CHART_RENDERED` | `packages/cli/src/commands/atm-chart.ts:245` | messages: [message('info', 'ATM_CHART_RENDERED', 'ATMChart markdown rendered from current ATM guard sources.')], |
| `ATM_CHART_SCHEMA_SOURCE_MISSING` | `packages/cli/src/commands/atm-chart.ts:340` | throw new CliError('ATM_CHART_SCHEMA_SOURCE_MISSING', &#96;Schema source was not found for ${schemaId}.&#96;, { |
| `ATM_CHART_STALE` | `packages/cli/src/commands/atm-chart.ts:284` | throw new CliError('ATM_CHART_STALE', 'ATMChart markdown is stale. Re-run &#96;node atm.mjs atm-chart render&#96;.', { |
| `ATM_CHART_VERIFY_OK` | `packages/cli/src/commands/atm-chart.ts:308` | message('info', 'ATM_CHART_VERIFY_OK', 'ATMChart markdown matches the current ATM guard sources.'), |
| `ATM_CHART_VERSION_CHECK_OK` | `packages/cli/src/commands/atm-chart.ts:310` | ? [message(versionCompatibility.status === 'deprecated' ? 'warning' : 'info', 'ATM_CHART_VERSION_CHECK_OK', 'ATMChart version compatibility check completed.', versionCompatibility)] |
| `ATM_CHART_VERSION_UNSUPPORTED` | `packages/cli/src/commands/atm-chart.ts:297` | throw new CliError('ATM_CHART_VERSION_UNSUPPORTED', 'ATMChart version is not supported by the current framework release train.', { |
| `ATM_CLI_HELP` | `packages/cli/src/atm.ts:218` | messages: [message('info', 'ATM_CLI_HELP', 'Use "node atm.mjs &lt;command&gt; --help" for command details.')], |
| `ATM_CLI_HELP_NOT_FOUND` | `packages/cli/src/atm.ts:146` | messages: [message('error', 'ATM_CLI_HELP_NOT_FOUND', &#96;No help spec found for ${commandName}.&#96;)], |
| `ATM_CLI_HELP_READY` | `packages/cli/src/commands/shared.ts:217` | messages: [message('info', 'ATM_CLI_HELP_READY', &#96;Help for ${spec.name}.&#96;)], |
| `ATM_CLI_TARGET_FILE_NOT_FOUND` | `packages/cli/src/commands/start.ts:50` | throw new CliError('ATM_CLI_TARGET_FILE_NOT_FOUND', &#96;--target-file not found: ${targetFile}&#96;, { exitCode: 2 }); |
| `ATM_CLI_UNHANDLED` | `packages/cli/src/atm.ts:197` | : new CliError('ATM_CLI_UNHANDLED', error instanceof Error ? error.message : String(error)); |
| `ATM_CLI_UNKNOWN_COMMAND` | `packages/cli/src/atm.ts:112` | messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', &#96;Unknown command: ${targetCommand}&#96;)], |
| `ATM_CLI_USAGE` | `packages/cli/src/commands/actor.ts:20` | throw new CliError('ATM_CLI_USAGE', 'actor register requires --id &lt;actor-id&gt;.', { exitCode: 2 }); |
| `ATM_COMPATIBILITY_BUNDLED_SNAPSHOT` | `packages/cli/src/commands/atm-chart.ts:533` | code: 'ATM_COMPATIBILITY_BUNDLED_SNAPSHOT', |
| `ATM_COMPATIBILITY_LEGACY_MATRIX_INVALID` | `packages/cli/src/commands/atm-chart.ts:702` | throw new CliError('ATM_COMPATIBILITY_LEGACY_MATRIX_INVALID', 'compatibility-matrix.legacy.json is missing required legacy fields.', { exitCode: 2 }); |
| `ATM_COMPATIBILITY_LEGACY_MATRIX_PATH` | `packages/cli/src/commands/atm-chart.ts:685` | const overridePath = process.env.ATM_COMPATIBILITY_LEGACY_MATRIX_PATH; |
| `ATM_COMPATIBILITY_MATRIX_INVALID` | `packages/cli/src/commands/atm-chart.ts:679` | throw new CliError('ATM_COMPATIBILITY_MATRIX_INVALID', 'compatibility-matrix.json is missing required release train fields.', { exitCode: 2 }); |
| `ATM_COMPATIBILITY_MATRIX_PATH` | `packages/cli/src/commands/atm-chart.ts:518` | const overridePath = process.env.ATM_COMPATIBILITY_MATRIX_PATH; |
| `ATM_CONFIG_ADAPTER_MODE` | `packages/cli/src/commands/validate.ts:47` | messages.push(message('error', 'ATM_CONFIG_ADAPTER_MODE', 'ATM-1 CLI MVP only supports standalone mode.', { adapterMode: config.adapter?.mode })); |
| `ATM_CONFIG_MISSING` | `packages/cli/src/commands/status.ts:53` | messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init first.')], |
| `ATM_CONFIG_UNSUPPORTED_VERSION` | `packages/cli/src/commands/status.ts:80` | : message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion }) |
| `ATM_CREATE_DRY_RUN_OK` | `packages/cli/src/commands/create.ts:23` | ? message('info', options.dryRun ? 'ATM_CREATE_DRY_RUN_OK' : 'ATM_CREATE_OK', options.dryRun ? 'Atom create dry-run completed.' : 'Atom created and registered.', { atomId: result.atomId }) |
| `ATM_CREATE_FAILED` | `packages/cli/src/commands/create.ts:24` | : message('error', result.error?.code ?? 'ATM_CREATE_FAILED', result.error?.message ?? 'Atom creation failed.', result.error?.details ?? {}) |
| `ATM_CREATE_MAP_DRY_RUN_OK` | `packages/cli/src/commands/create-map.ts:28` | ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId }) |
| `ATM_CREATE_MAP_FAILED` | `packages/cli/src/commands/create-map.ts:17` | : (result.error?.code ?? 'ATM_CREATE_MAP_FAILED'); |
| `ATM_CREATE_MAP_OK` | `packages/cli/src/commands/create-map.ts:28` | ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId }) |
| `ATM_CREATE_OK` | `packages/cli/src/commands/create.ts:23` | ? message('info', options.dryRun ? 'ATM_CREATE_DRY_RUN_OK' : 'ATM_CREATE_OK', options.dryRun ? 'Atom create dry-run completed.' : 'Atom created and registered.', { atomId: result.atomId }) |
| `ATM_CREATE_READY` | `packages/create-atm/src/index.ts:73` | : { level: 'info', code: 'ATM_CREATE_READY', text: &#96;ATM governance project created at ${targetRoot}&#96; } |
| `ATM_DECOMP_PLAN_INVALID` | `packages/cli/src/commands/create-map.ts:201` | if (error &amp;&amp; typeof error === 'object' &amp;&amp; 'code' in error &amp;&amp; (error as any).code === 'ATM_DECOMP_PLAN_INVALID') { |
| `ATM_DIFF_ATOM_NOT_FOUND` | `packages/core/src/registry/diff.ts:24` | readonly code: 'ATM_DIFF_ATOM_NOT_FOUND' &#124; 'ATM_DIFF_LINEAGE_MISSING'; |
| `ATM_DIFF_COMPUTE_FAILED` | `packages/cli/src/commands/registry-diff.ts:119` | messages: [message('error', 'ATM_DIFF_COMPUTE_FAILED', error.message)], |
| `ATM_DIFF_LINEAGE_MISSING` | `packages/core/src/registry/diff.ts:24` | readonly code: 'ATM_DIFF_ATOM_NOT_FOUND' &#124; 'ATM_DIFF_LINEAGE_MISSING'; |
| `ATM_DIFF_MISSING_ATOM_ID` | `packages/cli/src/commands/registry-diff.ts:54` | messages: [message('error', 'ATM_DIFF_MISSING_ATOM_ID', 'Missing required argument: atomId. Usage: atm registry-diff &lt;atomId&gt; --from &lt;v1&gt; --to &lt;v2&gt;')], |
| `ATM_DIFF_MISSING_VERSIONS` | `packages/cli/src/commands/registry-diff.ts:64` | messages: [message('error', 'ATM_DIFF_MISSING_VERSIONS', 'Missing required flags: --from &lt;version&gt; --to &lt;version&gt;')], |
| `ATM_DIFF_OK` | `packages/cli/src/commands/registry-diff.ts:137` | messages: [message('info', 'ATM_DIFF_OK', summaryText)], |
| `ATM_DIFF_REGISTRY_NOT_FOUND` | `packages/cli/src/commands/registry-diff.ts:77` | messages: [message('error', 'ATM_DIFF_REGISTRY_NOT_FOUND', error.message)], |
| `ATM_DOCTOR_CHARTER_MISSING` | `packages/cli/src/commands/doctor.ts:153` | ? [message('error', 'ATM_DOCTOR_CHARTER_MISSING', 'AtomicCharter files are missing or corrupt. Repair before continuing.', { failedChecks })] |
| `ATM_DOCTOR_FAILED` | `packages/cli/src/commands/doctor.ts:172` | : [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })]) |
| `ATM_DOCTOR_GIT_EVIDENCE_MISSING` | `packages/cli/src/commands/doctor.ts:169` | ? [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'Latest Git commit has no matching ATM evidence; work may have bypassed ATM.', { failedChecks })] |
| `ATM_DOCTOR_INTEGRATION_DRIFT` | `packages/cli/src/commands/doctor.ts:171` | ? [message('error', 'ATM_DOCTOR_INTEGRATION_DRIFT', 'Installed integration adapter manifests have missing, drifted, or stale files.', { failedChecks })] |
| `ATM_DOCTOR_INTEGRATION_INSTALL_RECOMMENDED` | `packages/cli/src/commands/doctor.ts:129` | 'ATM_DOCTOR_INTEGRATION_INSTALL_RECOMMENDED', |
| `ATM_DOCTOR_KNOWN_BAD_VERSION` | `packages/cli/src/commands/doctor.ts:161` | ? [message('error', 'ATM_DOCTOR_KNOWN_BAD_VERSION', 'This ATM CLI version is listed in known-bad-versions.json.', { |
| `ATM_DOCTOR_OK` | `packages/cli/src/commands/doctor.ts:151` | ? [message('info', 'ATM_DOCTOR_OK', 'ATM engineering and runtime signals are ready.')] |
| `ATM_DOCTOR_ONBOARDING_STALE` | `packages/cli/src/commands/doctor.ts:155` | ? [message('error', 'ATM_DOCTOR_ONBOARDING_STALE', 'Onboarding ATMChart sources are missing or stale. Refresh the first-touch artifacts before continuing.', { failedChecks })] |
| `ATM_DOCTOR_RELEASE_TRUST_FAILED` | `packages/cli/src/commands/doctor.ts:159` | ? [message('error', 'ATM_DOCTOR_RELEASE_TRUST_FAILED', 'Bundled release integrity hashes do not match expected values.', { failedChecks, trustMode: trustIntegrity?.mode })] |
| `ATM_DOCTOR_UNSUPPORTED_CHART_VERSION` | `packages/cli/src/commands/doctor.ts:157` | ? [message('error', 'ATM_DOCTOR_UNSUPPORTED_CHART_VERSION', 'ATMChart/framework/template versions are outside the supported release train.', { failedChecks, versionStatus: versionSummary.compatibility.code })] |
| `ATM_EDITOR_ID` | `packages/cli/src/commands/integration.ts:31` | type EditorDetectionSource = 'ATM_EDITOR_ID' &#124; 'ATM_ACTOR_ID' &#124; 'AGENT_IDENTITY' &#124; 'CODEX_HOME'; |
| `ATM_EVIDENCE_ADDED` | `packages/cli/src/commands/evidence.ts:128` | messages: [message('info', 'ATM_EVIDENCE_ADDED', &#96;Added ${kind} evidence for ${options.taskId}.&#96;, { |
| `ATM_EVIDENCE_SCAN_EMPTY` | `packages/cli/src/commands/upgrade.ts:579` | ? message('info', 'ATM_EVIDENCE_SCAN_EMPTY', 'Evidence scan completed with no proposal candidates.', { |
| `ATM_EVIDENCE_SCAN_INPUT_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:977` | document: readJsonFile(filePath, 'ATM_EVIDENCE_SCAN_INPUT_NOT_FOUND') |
| `ATM_EVIDENCE_SCAN_INPUTS_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:555` | throw new CliError('ATM_EVIDENCE_SCAN_INPUTS_NOT_FOUND', 'Upgrade scan requires detector reports. Provide --input paths or stage detector reports under .atm/history/reports.', { |
| `ATM_EVIDENCE_SCAN_READY` | `packages/cli/src/commands/upgrade.ts:583` | : message('info', 'ATM_EVIDENCE_SCAN_READY', 'Evidence scan produced dry-run proposal drafts.', { |
| `ATM_EVIDENCE_VERIFY_FAILED` | `packages/cli/src/commands/evidence.ts:160` | : message('error', 'ATM_EVIDENCE_VERIFY_FAILED', &#96;Evidence gate ${result.gate} failed for ${options.taskId}.&#96;, { |
| `ATM_EVIDENCE_VERIFY_OK` | `packages/cli/src/commands/evidence.ts:156` | ? message('info', 'ATM_EVIDENCE_VERIFY_OK', &#96;Evidence gate ${result.gate} passed for ${options.taskId}.&#96;, { |
| `ATM_EXPERIENCE_BEHAVIOR_INVALID` | `packages/cli/src/commands/experience.ts:42` | throw new CliError('ATM_EXPERIENCE_BEHAVIOR_INVALID', 'Experience behavior did not emit a skill candidate and proposal snapshot.', { |
| `ATM_EXPERIENCE_EXTRACT_OK` | `packages/cli/src/commands/experience.ts:73` | message('info', 'ATM_EXPERIENCE_EXTRACT_OK', 'Experience extraction completed.', { |
| `ATM_EXPERIENCE_INPUT_INVALID` | `packages/cli/src/commands/experience.ts:175` | throw new CliError('ATM_EXPERIENCE_INPUT_INVALID', 'Experience input must be a JSON object.'); |
| `ATM_EXPERIENCE_INPUT_NOT_FOUND` | `packages/cli/src/commands/experience.ts:27` | const rawInput = readJsonFile(inputPath, 'ATM_EXPERIENCE_INPUT_NOT_FOUND'); |
| `ATM_EXPERIENCE_QUEUE_INVALID` | `packages/cli/src/commands/experience.ts:255` | throw new CliError('ATM_EXPERIENCE_QUEUE_INVALID', 'Generated experience review queue record is invalid.', { |
| `ATM_EXPERIMENTAL_API_ALLOWED` | `packages/cli/src/commands/upgrade.ts:189` | messages: [message('warning', 'ATM_EXPERIMENTAL_API_ALLOWED', 'Experimental API call allowed by explicit --allow-experimental opt-in.', { |
| `ATM_EXPERIMENTAL_API_NOTICE` | `packages/cli/src/commands/welcome.ts:101` | message('warning', 'ATM_EXPERIMENTAL_API_NOTICE', 'Experimental APIs are disabled unless a command is invoked with --allow-experimental.') |
| `ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN` | `packages/agent-pack-sdk/src/experimental/index.ts:29` | readonly code: 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN' &#124; 'ATM_EXPERIMENTAL_API_UNKNOWN'; |
| `ATM_EXPERIMENTAL_API_UNKNOWN` | `packages/agent-pack-sdk/src/experimental/index.ts:29` | readonly code: 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN' &#124; 'ATM_EXPERIMENTAL_API_UNKNOWN'; |
| `ATM_FAIL` | `tests/unit/shared-helpers.unit.test.ts:32` | const m = message('error', 'ATM_FAIL', 'bad', { foo: 1 }); |
| `ATM_FRAMEWORK_DOWNGRADE_DETECTED` | `packages/cli/src/commands/doctor.ts:277` | messages.push(message('warning', 'ATM_FRAMEWORK_DOWNGRADE_DETECTED', versionSummary.downgrade.reason, { |
| `ATM_GENERATOR_ATOM_ID_BUCKET_MISMATCH` | `packages/core/src/manager/atom-generator.ts:328` | throw createGeneratorError('ATM_GENERATOR_ATOM_ID_BUCKET_MISMATCH', 'Provided atomId bucket must match the generator request bucket.', { |
| `ATM_GENERATOR_ATOM_ID_INVALID` | `packages/core/src/manager/atom-generator.ts:325` | throw createGeneratorError('ATM_GENERATOR_ATOM_ID_INVALID', 'Provided atomId must match ATM-{BUCKET}-{NNNN}.', { atomId: requestedAtomId }); |
| `ATM_GENERATOR_LOGICAL_NAME_INVALID` | `packages/core/src/manager/atom-generator.ts:281` | throw createGeneratorError('ATM_GENERATOR_LOGICAL_NAME_INVALID', 'logicalName must match atom namespace syntax.', { logicalName: value }); |
| `ATM_GENERATOR_REGISTRY_INVALID` | `packages/core/src/manager/atom-generator.ts:148` | throw createGeneratorError('ATM_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation }); |
| `ATM_GENERATOR_REQUEST_INVALID` | `packages/core/src/manager/atom-generator.ts:256` | throw createGeneratorError('ATM_GENERATOR_REQUEST_INVALID', 'Atom generator request must be an object.'); |
| `ATM_GENERATOR_SPEC_INVALID` | `packages/core/src/manager/atom-generator.ts:71` | throw createGeneratorError('ATM_GENERATOR_SPEC_INVALID', parseResult.promptReport?.summary ?? 'Generated atomic spec is invalid.', { parseResult }); |
| `ATM_GENERATOR_TEST_FAILED` | `packages/core/src/manager/atom-generator.ts:121` | throw createGeneratorError('ATM_GENERATOR_TEST_FAILED', 'Generated atom validation command failed.', { testRun }); |
| `ATM_GENERATOR_UNHANDLED` | `packages/core/src/manager/atom-generator.ts:468` | code: typedError?.code ?? 'ATM_GENERATOR_UNHANDLED', |
| `ATM_GIT_CHECK_FAILED` | `packages/cli/src/commands/git-governance.ts:46` | : message('error', 'ATM_GIT_CHECK_FAILED', 'Git governance checks failed.', { |
| `ATM_GIT_CHECK_OK` | `packages/cli/src/commands/git-governance.ts:45` | ? message('info', 'ATM_GIT_CHECK_OK', 'Git governance checks passed.') |
| `ATM_GIT_PREPARE_IDENTITY_MISSING` | `packages/cli/src/commands/git-governance.ts:174` | throw new CliError('ATM_GIT_PREPARE_IDENTITY_MISSING', 'git prepare requires git name/email from actor registry or explicit --name/--email.', { |
| `ATM_GIT_PREPARED` | `packages/cli/src/commands/git-governance.ts:197` | messages: [message('info', 'ATM_GIT_PREPARED', 'Repo-local git identity has been prepared for the resolved actor.', { |
| `ATM_GUARD_ENCODING_FAILED` | `packages/cli/src/commands/guard.ts:50` | messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })], |
| `ATM_GUARD_ENCODING_OK` | `packages/cli/src/commands/guard.ts:50` | messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })], |
| `ATM_GUARD_GIT_FAIL_OPEN` | `packages/cli/src/commands/guard.ts:151` | ? message('warning', 'ATM_GUARD_GIT_FAIL_OPEN', 'Git governance guard found violations but continued in fail-open mode.', { violations: check.violations }) |
| `ATM_GUARD_GIT_FAILED` | `packages/cli/src/commands/guard.ts:152` | : message('error', 'ATM_GUARD_GIT_FAILED', 'Git governance guard failed.', { violations: check.violations })], |
| `ATM_GUARD_GIT_OK` | `packages/cli/src/commands/guard.ts:149` | ? message('info', 'ATM_GUARD_GIT_OK', 'Git governance guard passed.') |
| `ATM_GUARD_MUTATION_FAIL_OPEN` | `packages/cli/src/commands/guard.ts:124` | ? message('warning', 'ATM_GUARD_MUTATION_FAIL_OPEN', 'Mutation guard found violations but continued in fail-open mode.', { violations }) |
| `ATM_GUARD_MUTATION_FAILED` | `packages/cli/src/commands/guard.ts:125` | : message('error', 'ATM_GUARD_MUTATION_FAILED', 'Mutation guard failed.', { violations })], |
| `ATM_GUARD_MUTATION_OK` | `packages/cli/src/commands/guard.ts:122` | ? message('info', 'ATM_GUARD_MUTATION_OK', 'Mutation guard passed for claimed task scope.') |
| `ATM_GUIDANCE_DRIFT_GOAL_MISSING` | `packages/cli/src/commands/candidates.ts:434` | code: 'ATM_GUIDANCE_DRIFT_GOAL_MISSING', |
| `ATM_GUIDANCE_EXPLAIN_READY` | `packages/cli/src/commands/explain.ts:40` | messages: [message('info', 'ATM_GUIDANCE_EXPLAIN_READY', 'Guidance block explanation is ready.', { sessionId: session.sessionId })], |
| `ATM_GUIDANCE_LEGACY_PLAN_REQUIRED` | `packages/core/src/guidance/mutation-gate.ts:38` | &#124; 'ATM_GUIDANCE_LEGACY_PLAN_REQUIRED' |
| `ATM_GUIDANCE_NEXT_ACTION` | `packages/cli/src/commands/next.ts:41` | : message('info', 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction) |
| `ATM_GUIDANCE_NEXT_BLOCKED` | `packages/cli/src/commands/next.ts:40` | ? message('info', 'ATM_GUIDANCE_NEXT_BLOCKED', 'ATM guidance identified the next single action.', nextAction) |
| `ATM_GUIDANCE_NEXT_NOT_UNIQUE` | `packages/core/src/guidance/mutation-gate.ts:45` | &#124; 'ATM_GUIDANCE_NEXT_NOT_UNIQUE'; |
| `ATM_GUIDANCE_ORIENTATION_READY` | `packages/cli/src/commands/orient.ts:18` | messages: [message('info', 'ATM_GUIDANCE_ORIENTATION_READY', 'Project orientation report is ready.', { repositoryRoot: orientation.repositoryRoot })], |
| `ATM_GUIDANCE_PROPOSAL_REQUIRED` | `packages/core/src/guidance/mutation-gate.ts:39` | &#124; 'ATM_GUIDANCE_PROPOSAL_REQUIRED' |
| `ATM_GUIDANCE_RELEASE_BLOCKER` | `packages/core/src/guidance/mutation-gate.ts:42` | &#124; 'ATM_GUIDANCE_RELEASE_BLOCKER' |
| `ATM_GUIDANCE_REVIEW_REQUIRED` | `packages/core/src/guidance/mutation-gate.ts:40` | &#124; 'ATM_GUIDANCE_REVIEW_REQUIRED' |
| `ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED` | `packages/core/src/guidance/mutation-gate.ts:41` | &#124; 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED' |
| `ATM_GUIDANCE_ROUTE_CONFIRMED` | `packages/cli/src/commands/candidates.ts:446` | code: 'ATM_GUIDANCE_ROUTE_CONFIRMED', |
| `ATM_GUIDANCE_SESSION_REQUIRED` | `packages/cli/src/commands/explain.ts:21` | const issue = explainGuidanceIssue('ATM_GUIDANCE_SESSION_REQUIRED'); |
| `ATM_GUIDANCE_SESSION_STARTED` | `packages/cli/src/commands/start.ts:92` | messages: [message('info', 'ATM_GUIDANCE_SESSION_STARTED', 'Guidance session started.', { sessionId: session.sessionId })], |
| `ATM_GUIDANCE_SKILL_MISS_CANDIDATE` | `packages/cli/src/commands/candidates.ts:440` | code: 'ATM_GUIDANCE_SKILL_MISS_CANDIDATE', |
| `ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED` | `packages/core/src/guidance/mutation-gate.ts:43` | &#124; 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED' |
| `ATM_GUIDANCE_UNGUIDED_FORBIDDEN` | `packages/core/src/guidance/mutation-gate.ts:44` | &#124; 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN' |
| `ATM_GUIDE_READY` | `packages/cli/src/commands/guide.ts:491` | messages: [message('info', 'ATM_GUIDE_READY', &#96;Guide for ${guide.intent} is ready.&#96;, { intent: guide.intent })], |
| `ATM_GUIDE_SKILL_NOT_FOUND` | `packages/cli/src/commands/guide.ts:386` | throw new CliError('ATM_GUIDE_SKILL_NOT_FOUND', &#96;Bundled skill was not found: ${sourcePath}&#96;, { |
| `ATM_HANDOFF_STORE_MISSING` | `packages/cli/src/commands/handoff.ts:22` | throw new CliError('ATM_HANDOFF_STORE_MISSING', 'Context summary store is not available for this adapter.'); |
| `ATM_HANDOFF_SUMMARY_WRITTEN` | `packages/cli/src/commands/handoff.ts:59` | messages: [message('info', 'ATM_HANDOFF_SUMMARY_WRITTEN', 'Handoff summary written.', { taskId, summaryPath: summary.summaryMarkdownPath ?? null })], |
| `ATM_HUMAN_REVIEW_SNAPSHOT_MISMATCH` | `packages/cli/src/commands/review.ts:171` | throw new CliError('ATM_HUMAN_REVIEW_SNAPSHOT_MISMATCH', 'decision-snapshot.hash mismatch.', { |
| `ATM_INIT_ALREADY_INITIALIZED` | `packages/cli/src/commands/init.ts:96` | ? message('info', 'ATM_INIT_ALREADY_INITIALIZED', 'ATM config already exists; no files were changed.') |
| `ATM_INIT_CREATED` | `packages/cli/src/commands/init.ts:97` | : message('info', 'ATM_INIT_CREATED', 'ATM standalone config created.'), |
| `ATM_INIT_DRY_RUN_OK` | `packages/cli/src/commands/init.ts:138` | messages: [message('info', 'ATM_INIT_DRY_RUN_OK', 'ATM init adoption dry-run completed.')], |
| `ATM_INIT_INTEGRATION_ADDED` | `packages/cli/src/commands/init.ts:98` | ...(integrationInstall ? [message('info', 'ATM_INIT_INTEGRATION_ADDED', &#96;Integration adapter ${integrationInstall.adapter.id} installed during init.&#96;)] : []) |
| `ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION` | `packages/agent-pack-sdk/src/install-manifest.ts:7` | readonly code: 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION' &#124; 'ATM_INSTALL_MANIFEST_UNKNOWN_SCHEMA_VERSION'; |
| `ATM_INSTALL_MANIFEST_UNKNOWN_SCHEMA_VERSION` | `packages/agent-pack-sdk/src/install-manifest.ts:7` | readonly code: 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION' &#124; 'ATM_INSTALL_MANIFEST_UNKNOWN_SCHEMA_VERSION'; |
| `ATM_INTEGRATION_ADD_DRY_RUN` | `packages/cli/src/commands/integration.ts:193` | message('info', report.dryRun ? 'ATM_INTEGRATION_ADD_DRY_RUN' : 'ATM_INTEGRATION_ADDED', report.dryRun |
| `ATM_INTEGRATION_ADDED` | `packages/cli/src/commands/integration.ts:193` | message('info', report.dryRun ? 'ATM_INTEGRATION_ADD_DRY_RUN' : 'ATM_INTEGRATION_ADDED', report.dryRun |
| `ATM_INTEGRATION_ALREADY_INSTALLED` | `packages/cli/src/commands/integration.ts:269` | throw new CliError('ATM_INTEGRATION_ALREADY_INSTALLED', &#96;Integration adapter ${adapter.id} already has a manifest. Use --force to reinstall.&#96;, { |
| `ATM_INTEGRATION_LIST_OK` | `packages/cli/src/commands/integration.ts:309` | messages: [message('info', 'ATM_INTEGRATION_LIST_OK', 'Integration adapters listed.')], |
| `ATM_INTEGRATION_MANIFEST_ADAPTER_MISMATCH` | `packages/cli/src/commands/integration.ts:464` | throw new CliError('ATM_INTEGRATION_MANIFEST_ADAPTER_MISMATCH', &#96;Integration manifest adapterId does not match ${adapter.id}.&#96;, { |
| `ATM_INTEGRATION_MANIFEST_MISSING` | `packages/cli/src/commands/integration.ts:462` | const manifest = readJsonFile(path.join(repositoryRoot, manifestPath), 'ATM_INTEGRATION_MANIFEST_MISSING') as InstallManifest; |
| `ATM_INTEGRATION_REMOVED` | `packages/cli/src/commands/integration.ts:237` | messages: [message('info', 'ATM_INTEGRATION_REMOVED', &#96;Integration adapter ${adapter.id} uninstall completed.&#96;)], |
| `ATM_INTEGRATION_TARGET_EXISTS` | `packages/cli/src/commands/integration.ts:277` | throw new CliError('ATM_INTEGRATION_TARGET_EXISTS', &#96;Integration adapter ${adapter.id} target files already exist. Use --force to overwrite.&#96;, { |
| `ATM_INTEGRATION_UNKNOWN_ADAPTER` | `packages/cli/src/commands/integration.ts:478` | throw new CliError('ATM_INTEGRATION_UNKNOWN_ADAPTER', &#96;Unknown integration adapter: ${adapterId}&#96;, { |
| `ATM_INTEGRATION_VERIFY_DRIFT` | `packages/cli/src/commands/integration.ts:216` | : message('error', 'ATM_INTEGRATION_VERIFY_DRIFT', &#96;Integration adapter ${adapter.id} has manifest drift.&#96;) |
| `ATM_INTEGRATION_VERIFY_OK` | `packages/cli/src/commands/integration.ts:215` | ? message('info', 'ATM_INTEGRATION_VERIFY_OK', &#96;Integration adapter ${adapter.id} matches its manifest.&#96;) |
| `ATM_JS_ENTRYPOINT_EXPORT_MISSING` | `packages/language-js/src/language-js-adapter.ts:44` | messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_EXPORT_MISSING', 'Entrypoint must export a run function or a default function.', entrypointFile.filePath)); |
| `ATM_JS_ENTRYPOINT_MISSING` | `packages/language-js/src/language-js-adapter.ts:42` | messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint)); |
| `ATM_JS_FORBIDDEN_IMPORT` | `packages/language-js/src/language-js-adapter.ts:49` | messages.push(createMessage('error', 'ATM_JS_FORBIDDEN_IMPORT', &#96;Forbidden import: ${importRecord.specifier}&#96;, importRecord.filePath, importRecord.line)); |
| `ATM_JS_VALIDATE_OK` | `packages/language-js/src/language-js-adapter.ts:54` | messages.push(createMessage('info', 'ATM_JS_VALIDATE_OK', 'JavaScript/TypeScript compute atom passed adapter checks.')); |
| `ATM_JSON_INVALID` | `packages/cli/src/commands/create-map.ts:182` | throw new CliError('ATM_JSON_INVALID', &#96;Invalid JSON for ${optionName}.&#96;, { |
| `ATM_JSON_NOT_FOUND` | `packages/cli/src/commands/shared.ts:485` | export function readJsonFile(filePath: string, missingCode = 'ATM_JSON_NOT_FOUND') { |
| `ATM_KNOWN_BAD_ROOT` | `packages/cli/src/config/env-registry.ts:73` | name: 'ATM_KNOWN_BAD_ROOT', |
| `ATM_KNOWN_BAD_VERSION` | `packages/cli/src/config/env-registry.ts:81` | name: 'ATM_KNOWN_BAD_VERSION', |
| `ATM_KNOWN_BAD_VERSION_BLOCKED` | `packages/cli/src/atm.ts:177` | messages: [message('error', 'ATM_KNOWN_BAD_VERSION_BLOCKED', 'This ATM CLI version is marked known-bad; refusing to run write-oriented commands.', { |
| `ATM_KNOWN_BAD_VERSIONS_PATH` | `packages/cli/src/config/env-registry.ts:65` | name: 'ATM_KNOWN_BAD_VERSIONS_PATH', |
| `ATM_LEGACY_URI_FRAGMENT_INVALID` | `packages/core/src/registry/urn.ts:165` | throw new AtmUrnError('ATM_LEGACY_URI_FRAGMENT_INVALID', 'Legacy URI line fragment must match #Lx or #Lx-Ly.', { value }); |
| `ATM_LEGACY_URI_INVALID` | `packages/core/src/registry/urn.ts:148` | throw new AtmUrnError('ATM_LEGACY_URI_INVALID', 'Legacy URI must match legacy://&lt;repository&gt;/&lt;path&gt;[#Lx[-Ly]].', { value }); |
| `ATM_LEGACY_URI_REPOSITORY_REQUIRED` | `packages/core/src/registry/urn.ts:156` | throw new AtmUrnError('ATM_LEGACY_URI_REPOSITORY_REQUIRED', 'Legacy URI requires repository alias.', { value }); |
| `ATM_LOCK_ACQUIRED` | `packages/cli/src/commands/lock.ts:47` | messages: [message('info', 'ATM_LOCK_ACQUIRED', 'Scope lock acquired.', { taskId: options.taskId, owner: options.owner })], |
| `ATM_LOCK_CONFLICT` | `packages/cli/src/commands/lock.ts:34` | if (code === 'ATM_LOCK_CONFLICT') { |
| `ATM_LOCK_FOUND` | `packages/cli/src/commands/lock.ts:23` | messages: [ok ? message('info', 'ATM_LOCK_FOUND', 'Scope lock is active.', { taskId: options.taskId }) : message('info', 'ATM_LOCK_MISSING', 'No active scope lock was found.', { taskId: options.taskId })], |
| `ATM_LOCK_MISSING` | `packages/cli/src/commands/lock.ts:23` | messages: [ok ? message('info', 'ATM_LOCK_FOUND', 'Scope lock is active.', { taskId: options.taskId }) : message('info', 'ATM_LOCK_MISSING', 'No active scope lock was found.', { taskId: options.taskId })], |
| `ATM_LOCK_RELEASED` | `packages/cli/src/commands/lock.ts:57` | messages: [message('info', 'ATM_LOCK_RELEASED', 'Scope lock released.', { taskId: options.taskId, owner: options.owner })], |
| `ATM_MAP_BACKFILL_FAILED` | `scripts/backfill-map-generator-provenance.ts:31` | console.error(&#96;[backfill-map-generator-provenance] generator failed: ${result.error?.code ?? 'ATM_MAP_BACKFILL_FAILED'} ${result.error?.message ?? ''}&#96;.trim()); |
| `ATM_MAP_EQUIVALENCE_EXECUTOR_FAILED` | `packages/core/src/equivalence/run-map-equivalence.ts:276` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_FAILED', &#96;${fieldName} failed while running ${caseId}.&#96;, { |
| `ATM_MAP_EQUIVALENCE_EXECUTOR_INVALID` | `packages/core/src/equivalence/run-map-equivalence.ts:263` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_INVALID', &#96;${fieldName}.${exportName} must be a function.&#96;, { |
| `ATM_MAP_EQUIVALENCE_EXECUTOR_NOT_FOUND` | `packages/core/src/equivalence/run-map-equivalence.ts:255` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_NOT_FOUND', &#96;${fieldName} module was not found.&#96;, { |
| `ATM_MAP_EQUIVALENCE_FIXTURES_INVALID` | `packages/core/src/equivalence/run-map-equivalence.ts:248` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', &#96;${fieldName}.modulePath is required.&#96;, { |
| `ATM_MAP_EQUIVALENCE_FIXTURES_NOT_FOUND` | `packages/core/src/equivalence/run-map-equivalence.ts:69` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_NOT_FOUND', 'Map equivalence fixtures file was not found.', { |
| `ATM_MAP_EQUIVALENCE_JSON_INVALID` | `packages/core/src/equivalence/run-map-equivalence.ts:393` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_JSON_INVALID', 'Failed to parse JSON input for map equivalence.', { |
| `ATM_MAP_EQUIVALENCE_MAP_MISMATCH` | `packages/core/src/equivalence/run-map-equivalence.ts:86` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_MAP_MISMATCH', 'Fixture set mapId does not match the requested map.', { |
| `ATM_MAP_EQUIVALENCE_REPLACEMENT_REQUIRED` | `packages/core/src/equivalence/run-map-equivalence.ts:78` | throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_REPLACEMENT_REQUIRED', 'Map equivalence requires replacement.legacyUris on the target map spec.', { |
| `ATM_MAP_GENERATOR_` | `packages/core/src/manager/map-generator/normalize-fields.ts:9` | * Surface contract: error codes (&#96;ATM_MAP_GENERATOR_*&#96;) and the regex |
| `ATM_MAP_GENERATOR_ATOM_ID_INVALID` | `packages/core/src/manager/map-generator/normalize-fields.ts:20` | throw createGeneratorError('ATM_MAP_GENERATOR_ATOM_ID_INVALID', &#96;${fieldName} must match ATM-{BUCKET}-{NNNN}.&#96;, { |
| `ATM_MAP_GENERATOR_EDGE_KIND_INVALID` | `packages/core/src/manager/map-generator/normalize-lineage.ts:36` | throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_KIND_INVALID', 'edges[].edgeKind is not a known atomic map edge kind.', { edgeKind }); |
| `ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER` | `packages/core/src/manager/map-generator.ts:238` | throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER', 'Edge endpoints must reference declared map members.', { |
| `ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER` | `packages/core/src/manager/map-generator.ts:260` | throw createGeneratorError('ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER', 'Entrypoints must reference declared map members.', { |
| `ATM_MAP_GENERATOR_MAP_ID_INVALID` | `packages/core/src/manager/map-generator/normalize-fields.ts:31` | throw createGeneratorError('ATM_MAP_GENERATOR_MAP_ID_INVALID', 'mapId must match ATM-MAP-{NNNN}.', { mapId: value }); |
| `ATM_MAP_GENERATOR_MEMBER_ROLE_INVALID` | `packages/core/src/manager/map-generator/normalize-lineage.ts:25` | throw createGeneratorError('ATM_MAP_GENERATOR_MEMBER_ROLE_INVALID', 'members[].role is not a known atomic map member role.', { role }); |
| `ATM_MAP_GENERATOR_QUALITY_TARGET_INVALID` | `packages/core/src/manager/map-generator.ts:276` | throw createGeneratorError('ATM_MAP_GENERATOR_QUALITY_TARGET_INVALID', 'qualityTargets values must be string, number, or boolean.', { |
| `ATM_MAP_GENERATOR_REGISTRY_INVALID` | `packages/core/src/manager/map-generator.ts:135` | throw createGeneratorError('ATM_MAP_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation }); |
| `ATM_MAP_GENERATOR_REPLACEMENT_INVALID` | `packages/core/src/manager/map-generator/normalize-lineage.ts:46` | throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement must be an object.', { fieldName: 'replacement' }); |
| `ATM_MAP_GENERATOR_REQUEST_INVALID` | `packages/core/src/manager/map-generator/normalize-fields.ts:49` | throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', &#96;Atomic map generator requires ${fieldName}.&#96;, { fieldName }); |
| `ATM_MAP_GENERATOR_SPEC_VERSION_INVALID` | `packages/core/src/manager/map-generator/normalize-fields.ts:57` | throw createGeneratorError('ATM_MAP_GENERATOR_SPEC_VERSION_INVALID', 'Atomic map specVersion must be 0.1.0 or 0.2.0.', { specVersion: value }); |
| `ATM_MAP_GENERATOR_TEST_FAILED` | `packages/core/src/manager/map-generator.ts:114` | throw createGeneratorError('ATM_MAP_GENERATOR_TEST_FAILED', 'Generated map validation command failed.', { testRun }); |
| `ATM_MAP_GENERATOR_UNHANDLED` | `packages/core/src/manager/map-generator.ts:525` | code: typedError?.code ?? 'ATM_MAP_GENERATOR_UNHANDLED', |
| `ATM_MAP_GENERATOR_VERSION_INVALID` | `packages/core/src/manager/map-generator/normalize-fields.ts:39` | throw createGeneratorError('ATM_MAP_GENERATOR_VERSION_INVALID', &#96;${fieldName} must match semver x.y.z.&#96;, { |
| `ATM_MAP_ID_INVALID` | `packages/core/src/registry/urn.ts:135` | throw new AtmUrnError('ATM_MAP_ID_INVALID', 'ATM map URN must use ATM-MAP-0000 canonical IDs.', { canonicalId }); |
| `ATM_MAP_SPEC_INVALID` | `packages/cli/src/commands/create-map.ts:16` | ? 'ATM_MAP_SPEC_INVALID' |
| `ATM_MAP_SPEC_VALIDATE_OK` | `packages/cli/src/commands/create-map.ts:287` | successCode: 'ATM_MAP_SPEC_VALIDATE_OK', |
| `ATM_MAP_TEST_LEGACY_FALLBACK` | `packages/core/src/test-runner/map-integration.ts:51` | warnings: [&#96;ATM_MAP_TEST_LEGACY_FALLBACK:${legacy.workbenchPath}&#96;] |
| `ATM_MAP_TEST_TARGET_NOT_FOUND` | `packages/core/src/test-runner/map-integration.ts:55` | throw createMapRunnerError('ATM_MAP_TEST_TARGET_NOT_FOUND', 'Atomic map integration target was not found.', { |
| `ATM_MIGRATE_ERROR` | `packages/cli/src/commands/migrate.ts:183` | return makeResult({ ok: false, command: 'migrate', cwd, messages: [message('error', err.code ?? 'ATM_MIGRATE_ERROR', err.message)], evidence: { status: 'error' } }); |
| `ATM_MIGRATE_FIXTURE_MISMATCH` | `packages/cli/src/commands/migrate.ts:156` | return makeResult({ ok: false, command: 'migrate', cwd, messages: failures.map((f) =&gt; message('error', 'ATM_MIGRATE_FIXTURE_MISMATCH', &#96;verify failure: ${f}&#96;)), evidence: { fixture: fixturePath, status: 'fixture-mismatch', failures } }); |
| `ATM_MIGRATE_FIXTURE_MISSING` | `packages/cli/src/commands/migrate.ts:132` | throw new CliError('ATM_MIGRATE_FIXTURE_MISSING', &#96;Fixture ${fixturePath} must contain before/ and after/ directories&#96;, { exitCode: 1 }); |
| `ATM_MIGRATE_FIXTURE_NOT_INDEXED` | `packages/cli/src/commands/migrate.ts:138` | throw new CliError('ATM_MIGRATE_FIXTURE_NOT_INDEXED', &#96;Fixture ${fixturePath} is not referenced in the migration index&#96;, { exitCode: 1 }); |
| `ATM_MIGRATE_NO_ENTRY` | `packages/cli/src/commands/migrate.ts:68` | return makeResult({ ok: true, command: 'migrate', cwd, messages: [message('info', 'ATM_MIGRATE_NO_ENTRY', &#96;No migration defined for ${fromVersion} to ${toVersion}&#96;)], evidence: { fromVersion, toVersion, status: 'no-migration-defined', codemods: [], affectedFiles: [], userModifiedFiles: [], guide: null } }); |
| `ATM_MIGRATE_WORKSPACE_VERIFY` | `packages/cli/src/commands/migrate.ts:160` | return makeResult({ ok: true, command: 'migrate', cwd, messages: [message('info', 'ATM_MIGRATE_WORKSPACE_VERIFY', 'Workspace version verification requires --from / --to flags; use migrate plan instead.')], evidence: { status: 'workspace-verify-not-implemented' } }); |
| `ATM_NEVER_DECLARED` | `tests/unit/env-registry.unit.test.ts:33` | try { readEnvVar('ATM_NEVER_DECLARED' as &#96;ATM_${string}&#96;); } catch (e) { thrown = e; } |
| `ATM_NEXT_ACTION` | `packages/cli/src/commands/next.ts:137` | : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction) |
| `ATM_NEXT_CLAIM_NO_TASK` | `packages/cli/src/commands/next.ts:68` | messages: [message('error', 'ATM_NEXT_CLAIM_NO_TASK', 'No claimable imported task is ready at the moment.')], |
| `ATM_NEXT_CLAIMED` | `packages/cli/src/commands/next.ts:108` | message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', { |
| `ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED` | `packages/cli/src/commands/next.ts:619` | 'ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED', |
| `ATM_NEXT_READY` | `packages/cli/src/commands/next.ts:136` | ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) |
| `ATM_NODE_KIND_INVALID` | `packages/core/src/registry/urn.ts:108` | throw new AtmUrnError('ATM_NODE_KIND_INVALID', 'ATM node kind is unsupported.', { nodeKind: value }); |
| `ATM_NOT_REGISTERED` | `tests/unit/env-registry.unit.test.ts:27` | assert.equal(findEnvDescriptor('ATM_NOT_REGISTERED'), undefined, |
| `ATM_ONEFILE_EXTRACTED_ROOT` | `scripts/build-onefile-release.ts:220` | ATM_ONEFILE_EXTRACTED_ROOT: extractedRoot |
| `ATM_ONEFILE_LAUNCHER_PATH` | `packages/plugin-governance-local/src/index.ts:948` | const onefileLauncher = resolveExistingFile(process.env.ATM_ONEFILE_LAUNCHER_PATH); |
| `ATM_ONEFILE_PAYLOAD_SHA256` | `scripts/build-onefile-release.ts:219` | ATM_ONEFILE_PAYLOAD_SHA256: payloadSha256, |
| `ATM_ONEFILE_RUNTIME` | `scripts/build-onefile-release.ts:217` | ATM_ONEFILE_RUNTIME: '1', |
| `ATM_PINNED_RUNNER_SOURCE` | `packages/plugin-governance-local/src/index.ts:897` | reason: 'No pinned onefile launcher source was available. Run bootstrap from release/atm-onefile/atm.mjs or set ATM_PINNED_RUNNER_SOURCE.' |
| `ATM_POLICE_DEPENDENCY_CYCLE` | `packages/core/src/police/dependency-graph.ts:81` | code: 'ATM_POLICE_DEPENDENCY_CYCLE', |
| `ATM_POLICE_FORBIDDEN_IMPORT` | `packages/core/src/police/forbidden-import-scanner.ts:26` | code: 'ATM_POLICE_FORBIDDEN_IMPORT', |
| `ATM_POLICE_GATE_FAILED` | `packages/cli/src/commands/police.ts:54` | message(report.ok ? 'info' : 'error', report.ok ? 'ATM_POLICE_GATE_OK' : 'ATM_POLICE_GATE_FAILED', report.ok |
| `ATM_POLICE_GATE_OK` | `packages/cli/src/commands/police.ts:54` | message(report.ok ? 'info' : 'error', report.ok ? 'ATM_POLICE_GATE_OK' : 'ATM_POLICE_GATE_FAILED', report.ok |
| `ATM_POLICE_LAYER_BOUNDARY` | `packages/core/src/police/layer-boundary.ts:25` | code: 'ATM_POLICE_LAYER_BOUNDARY', |
| `ATM_POLICE_LAYER_UNKNOWN` | `packages/core/src/police/layer-boundary.ts:11` | code: 'ATM_POLICE_LAYER_UNKNOWN', |
| `ATM_POLICE_PROMOTE_BLOCKED` | `packages/core/src/police/registry-consistency.ts:23` | code: 'ATM_POLICE_PROMOTE_BLOCKED', |
| `ATM_PROJECT_PROBE_MISSING` | `packages/cli/src/commands/status.ts:70` | ? readJsonFile(projectProbePath, 'ATM_PROJECT_PROBE_MISSING') |
| `ATM_PY_ENTRYPOINT_MISSING` | `packages/language-python/src/language-python-adapter.ts:95` | messages.push(message('error', 'ATM_PY_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint)); |
| `ATM_PY_ENTRYPOINT_SIGNATURE_MISSING` | `packages/language-python/src/language-python-adapter.ts:100` | 'ATM_PY_ENTRYPOINT_SIGNATURE_MISSING', |
| `ATM_PY_FORBIDDEN_IMPORT` | `packages/language-python/src/language-python-adapter.ts:110` | message('error', 'ATM_PY_FORBIDDEN_IMPORT', &#96;Forbidden import: ${importRecord.specifier}&#96;, importRecord.filePath, importRecord.line) |
| `ATM_PY_PLAN_ENTRYPOINT_MISSING` | `packages/language-python/src/language-python-adapter.ts:227` | messages.push(message('warning', 'ATM_PY_PLAN_ENTRYPOINT_MISSING', 'Entrypoint source not supplied; dry-run will return advisory steps only.', request.entrypoint)); |
| `ATM_PY_PLAN_FORBIDDEN_IMPORT` | `packages/language-python/src/language-python-adapter.ts:247` | message('error', 'ATM_PY_PLAN_FORBIDDEN_IMPORT', &#96;Forbidden import in entrypoint: ${importRecord.specifier}&#96;, importRecord.filePath, importRecord.line) |
| `ATM_PY_PLAN_NO_ENTRYPOINT_SIGNATURE` | `packages/language-python/src/language-python-adapter.ts:235` | 'ATM_PY_PLAN_NO_ENTRYPOINT_SIGNATURE', |
| `ATM_PY_VALIDATE_OK` | `packages/language-python/src/language-python-adapter.ts:116` | messages.push(message('info', 'ATM_PY_VALIDATE_OK', 'Python compute atom passed adapter checks.')); |
| `ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED` | `packages/cli/src/commands/doctor.ts:137` | 'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED', |
| `ATM_REGISTRY_INDEX_DUPLICATE_KEY` | `packages/core/src/registry/registry-index.ts:142` | throw new RegistryIndexError('ATM_REGISTRY_INDEX_DUPLICATE_KEY', message, { key }); |
| `ATM_REGISTRY_INDEX_ENTRY_SKIPPED` | `packages/core/src/registry/registry-index.ts:29` | diagnostics.push({ code: 'ATM_REGISTRY_INDEX_ENTRY_SKIPPED', severity: 'warning', entry }); |
| `ATM_REGISTRY_INVALID` | `packages/core/src/manager/atom-generator.ts:308` | throw createGeneratorError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', { |
| `ATM_REGISTRY_NOT_FOUND` | `packages/cli/src/commands/registry-shared.ts:77` | return readJsonFile(registryFilePath, 'ATM_REGISTRY_NOT_FOUND'); |
| `ATM_REGISTRY_OK` | `packages/core/src/registry/registry.ts:194` | code: 'ATM_REGISTRY_OK', |
| `ATM_REGISTRY_SCHEMA_ERROR` | `packages/cli/src/commands/registry-shared.ts:92` | : (validation.promptReport?.issues ?? []).map((issue: any) =&gt; message('error', issue.code ?? 'ATM_REGISTRY_SCHEMA_ERROR', issue.text ?? 'Registry schema validation failed.', { path: issue.path ?? '/' })); |
| `ATM_REGISTRY_SCHEMA_NOT_FOUND` | `packages/core/src/registry/registry.ts:139` | return createFailure(schemaPath, 'ATM_REGISTRY_SCHEMA_NOT_FOUND', [ |
| `ATM_REGISTRY_VALIDATOR_UNAVAILABLE` | `packages/core/src/registry/registry.ts:161` | return createFailure(schemaPath, 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE', [ |
| `ATM_RELEASE_INTEGRITY_FAILED` | `packages/cli/src/atm.ts:163` | messages: [message('error', 'ATM_RELEASE_INTEGRITY_FAILED', 'Bundled ATM release integrity check failed; refusing to run non-read-only commands.', { mode: trustIntegrity.mode })], |
| `ATM_RELEASE_TRUST_ROOT` | `packages/cli/src/config/env-registry.ts:41` | name: 'ATM_RELEASE_TRUST_ROOT', |
| `ATM_REPLACEMENT_LANE_TRANSITION_APPLIED` | `packages/cli/src/commands/replacement-lane.ts:45` | messages: [message('info', 'ATM_REPLACEMENT_LANE_TRANSITION_APPLIED', &#96;Replacement lane moved ${mapId} from ${result.from} to ${result.to}.&#96;)], |
| `ATM_REPLACEMENT_TRANSITION_INVALID` | `packages/core/src/registry/replacement-lane.ts:119` | throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { |
| `ATM_REVIEW_ADVISORY_OK` | `packages/cli/src/commands/review-advisory.ts:84` | const advisoryCode = report.advisoryUnavailable ? 'ATM_REVIEW_ADVISORY_UNAVAILABLE' : 'ATM_REVIEW_ADVISORY_OK'; |
| `ATM_REVIEW_ADVISORY_UNAVAILABLE` | `packages/cli/src/commands/review-advisory.ts:84` | const advisoryCode = report.advisoryUnavailable ? 'ATM_REVIEW_ADVISORY_UNAVAILABLE' : 'ATM_REVIEW_ADVISORY_OK'; |
| `ATM_REVIEW_ALREADY_DECIDED` | `packages/cli/src/commands/review.ts:154` | throw new CliError('ATM_REVIEW_ALREADY_DECIDED', &#96;Proposal ${proposalId} is already ${queueRecord.status}.&#96;, { |
| `ATM_REVIEW_APPLY_READY_OK` | `packages/cli/src/commands/review.ts:103` | messages: [message('info', 'ATM_REVIEW_APPLY_READY_OK', &#96;Approved proposal ${proposalId} is ready for actual patch planning within the governed leaf boundary.&#96;, { |
| `ATM_REVIEW_APPLY_READY_REQUIRES_APPROVAL` | `packages/cli/src/commands/review.ts:88` | throw new CliError('ATM_REVIEW_APPLY_READY_REQUIRES_APPROVAL', &#96;Proposal ${proposalId} is not approved yet.&#96;, { |
| `ATM_REVIEW_APPROVED` | `packages/cli/src/commands/review.ts:229` | message('info', decision === 'approve' ? 'ATM_REVIEW_APPROVED' : 'ATM_REVIEW_REJECTED', &#96;Recorded ${decision} decision for ${queueRecord.proposalId}.&#96;, { |
| `ATM_REVIEW_DECISION_INVALID` | `packages/cli/src/commands/review.ts:206` | throw new CliError('ATM_REVIEW_DECISION_INVALID', 'Generated decision log is invalid.', { |
| `ATM_REVIEW_LIST_OK` | `packages/cli/src/commands/review.ts:269` | messages: [message('info', 'ATM_REVIEW_LIST_OK', &#96;Loaded ${queueDocument.entries.length} review proposal(s).&#96;)], |
| `ATM_REVIEW_PROPOSAL_NOT_FOUND` | `packages/cli/src/commands/review.ts:59` | throw new CliError('ATM_REVIEW_PROPOSAL_NOT_FOUND', &#96;Proposal not found in review queue: ${proposalId}&#96;, { |
| `ATM_REVIEW_QUEUE_INVALID` | `packages/cli/src/commands/review.ts:47` | throw new CliError('ATM_REVIEW_QUEUE_INVALID', 'Human review queue is invalid.', { |
| `ATM_REVIEW_QUEUE_MISSING` | `packages/cli/src/commands/review.ts:39` | throw new CliError('ATM_REVIEW_QUEUE_MISSING', 'Human review queue not found. Generate upgrade proposals first.', { |
| `ATM_REVIEW_RECORD_INVALID` | `packages/cli/src/commands/review.ts:162` | throw new CliError('ATM_REVIEW_RECORD_INVALID', 'Proposal queue record is invalid.', { |
| `ATM_REVIEW_REJECTED` | `packages/cli/src/commands/review.ts:229` | message('info', decision === 'approve' ? 'ATM_REVIEW_APPROVED' : 'ATM_REVIEW_REJECTED', &#96;Recorded ${decision} decision for ${queueRecord.proposalId}.&#96;, { |
| `ATM_REVIEW_ROLLOUT_READY_EVIDENCE_MISSING` | `packages/cli/src/commands/review.ts:322` | throw new CliError('ATM_REVIEW_ROLLOUT_READY_EVIDENCE_MISSING', &#96;Actual patch evidence is missing for ${queueRecord.proposalId}.&#96;, { |
| `ATM_REVIEW_ROLLOUT_READY_OK` | `packages/cli/src/commands/review.ts:135` | messages: [message('info', 'ATM_REVIEW_ROLLOUT_READY_OK', &#96;Approved proposal ${proposalId} has actual patch evidence and rollback-ready proof; the governed rollout is ready for closeout review.&#96;, { |
| `ATM_REVIEW_ROLLOUT_READY_REQUIRES_APPROVAL` | `packages/cli/src/commands/review.ts:120` | throw new CliError('ATM_REVIEW_ROLLOUT_READY_REQUIRES_APPROVAL', &#96;Proposal ${proposalId} is not approved yet.&#96;, { |
| `ATM_REVIEW_SHOW_OK` | `packages/cli/src/commands/review.ts:75` | messages: [message('info', 'ATM_REVIEW_SHOW_OK', &#96;Loaded review proposal ${proposalId}.&#96;)], |
| `ATM_ROLLBACK_APPLIED` | `packages/cli/src/commands/rollback.ts:120` | messages: [message('info', 'ATM_ROLLBACK_APPLIED', &#96;Rollback applied for ${options.targetKind} target.&#96;)], |
| `ATM_ROLLBACK_HARD_FAIL` | `packages/cli/src/commands/rollback.ts:61` | throw new CliError('ATM_ROLLBACK_HARD_FAIL', 'Rollback hard-failed. Generated rollback-proof.failure.json.', { |
| `ATM_ROLLBACK_PLAN_READY` | `packages/cli/src/commands/rollback.ts:39` | messages: [message('info', 'ATM_ROLLBACK_PLAN_READY', &#96;Rollback plan prepared for ${options.targetKind} target.&#96;)], |
| `ATM_SCHEMA_DOCUMENT_NOT_FOUND` | `packages/core/src/police/schema-validator.ts:32` | return createFileFailure('ATM_SCHEMA_DOCUMENT_NOT_FOUND', resolvedDocumentPath, 'JSON document was not found.'); |
| `ATM_SCHEMA_INVALID` | `packages/core/src/police/schema-validator.ts:61` | code: 'ATM_SCHEMA_INVALID', |
| `ATM_SCHEMA_NOT_FOUND` | `packages/core/src/police/schema-validator.ts:35` | return createFileFailure('ATM_SCHEMA_NOT_FOUND', resolvedSchemaPath, 'JSON schema was not found.'); |
| `ATM_SCHEMA_VALIDATION_ERROR` | `packages/cli/src/commands/spec-shared.ts:88` | : (validate.errors &#124;&#124; []).map((error: any) =&gt; message('error', 'ATM_SCHEMA_VALIDATION_ERROR', &#96;${error.instancePath &#124;&#124; '/'} ${error.message}&#96;, { |
| `ATM_SEED_REGISTRY_SCHEMA_OK` | `scripts/validate-seed-registry.ts:50` | successCode: 'ATM_SEED_REGISTRY_SCHEMA_OK', |
| `ATM_SELF_HOST_ALPHA_CONFIDENCE_ADVISORY` | `packages/cli/src/commands/self-host-alpha.ts:89` | ? [message('warning', 'ATM_SELF_HOST_ALPHA_CONFIDENCE_ADVISORY', 'Multi-agent confidence is advisory and does not block alpha0 release.', { |
| `ATM_SELF_HOST_ALPHA_FAILED` | `packages/cli/src/commands/self-host-alpha.ts:87` | : message('error', 'ATM_SELF_HOST_ALPHA_FAILED', 'Self-hosting alpha deterministic criteria failed.', criteria), |
| `ATM_SELF_HOST_ALPHA_OK` | `packages/cli/src/commands/self-host-alpha.ts:86` | ? message('info', 'ATM_SELF_HOST_ALPHA_OK', 'Self-hosting alpha deterministic criteria passed.') |
| `ATM_SELF_HOST_ALPHA_READINESS_ADVISORY` | `packages/cli/src/commands/self-host-alpha.ts:95` | message('warning', 'ATM_SELF_HOST_ALPHA_READINESS_ADVISORY', 'Evolution readiness checks are advisory and do not block alpha0.', { readinessWarnings }) |
| `ATM_SELF_HOST_ALPHA_STORE_MISSING` | `packages/cli/src/commands/self-host-alpha.ts:186` | throw new CliError('ATM_SELF_HOST_ALPHA_STORE_MISSING', 'Required governance stores are not available for self-host-alpha.'); |
| `ATM_SEMANTIC_FINGERPRINT_INVALID` | `packages/core/src/registry/semantic-fingerprint.ts:61` | throw new SemanticFingerprintError('ATM_SEMANTIC_FINGERPRINT_INVALID', 'Semantic fingerprint must be sha256-like text.', { value }); |
| `ATM_SPEC_ADDITIONAL_PROPERTY` | `packages/core/src/spec/parse-spec.ts:371` | code: 'ATM_SPEC_ADDITIONAL_PROPERTY', |
| `ATM_SPEC_CONST_MISMATCH` | `packages/cli/src/commands/validate.ts:140` | errors.push({ code: 'ATM_SPEC_CONST_MISMATCH', path: checkPath, text: &#96;${checkPath} must be ${expected}.&#96; }); |
| `ATM_SPEC_ENUM_MISMATCH` | `packages/cli/src/commands/validate.ts:146` | errors.push({ code: 'ATM_SPEC_ENUM_MISMATCH', path: checkPath, text: &#96;${checkPath} must be one of: ${allowed.join(', ')}.&#96; }); |
| `ATM_SPEC_HASH_PATTERN` | `packages/cli/src/commands/validate.ts:127` | requireStringPattern(errors, spec.hashLock?.digest, /^sha256:[a-f0-9]{64}$/, '/hashLock/digest', 'ATM_SPEC_HASH_PATTERN'); |
| `ATM_SPEC_ID_PATTERN` | `packages/cli/src/commands/validate.ts:117` | requireStringPattern(errors, spec.id, /^ATM-[A-Z][A-Z0-9]*-\d{4}$/, '/id', 'ATM_SPEC_ID_PATTERN'); |
| `ATM_SPEC_INVALID_OBJECT` | `packages/cli/src/commands/validate.ts:106` | return [{ code: 'ATM_SPEC_INVALID_OBJECT', path: '/', text: 'Atomic spec must be a JSON object.' }]; |
| `ATM_SPEC_NOT_FOUND` | `packages/cli/src/commands/spec-shared.ts:29` | const document = readJsonFile(specPath, 'ATM_SPEC_NOT_FOUND') as Record&lt;string, any&gt;; |
| `ATM_SPEC_PARSE_INVALID` | `packages/core/src/spec/parse-spec.ts:120` | code: 'ATM_SPEC_PARSE_INVALID', |
| `ATM_SPEC_PARSE_OK` | `packages/core/src/spec/parse-spec.ts:134` | code: 'ATM_SPEC_PARSE_OK', |
| `ATM_SPEC_PATTERN_MISMATCH` | `packages/core/src/spec/parse-spec.ts:398` | return 'ATM_SPEC_PATTERN_MISMATCH'; |
| `ATM_SPEC_REQUIRED_FIELD` | `packages/cli/src/commands/validate.ts:111` | errors.push({ code: 'ATM_SPEC_REQUIRED_FIELD', path: &#96;/${field}&#96;, text: &#96;Atomic spec is missing required field: ${field}&#96; }); |
| `ATM_SPEC_SCHEMA_ERROR` | `packages/core/src/spec/parse-spec.ts:380` | code: 'ATM_SPEC_SCHEMA_ERROR', |
| `ATM_SPEC_SCHEMA_NOT_FOUND` | `packages/core/src/spec/parse-spec.ts:61` | code: 'ATM_SPEC_SCHEMA_NOT_FOUND', |
| `ATM_SPEC_STRING_REQUIRED` | `packages/cli/src/commands/validate.ts:152` | errors.push({ code: 'ATM_SPEC_STRING_REQUIRED', path: checkPath, text: &#96;${checkPath} must be a non-empty string.&#96; }); |
| `ATM_SPEC_TYPE_MISMATCH` | `packages/core/src/spec/parse-spec.ts:357` | code: 'ATM_SPEC_TYPE_MISMATCH', |
| `ATM_SPEC_VALIDATE_OK` | `packages/cli/src/commands/spec.ts:12` | successCode: 'ATM_SPEC_VALIDATE_OK', |
| `ATM_SPEC_VALIDATOR_UNAVAILABLE` | `packages/core/src/spec/parse-spec.ts:99` | code: 'ATM_SPEC_VALIDATOR_UNAVAILABLE', |
| `ATM_SPEC_VERSION_PATTERN` | `packages/cli/src/commands/validate.ts:124` | requireStringPattern(errors, spec.compatibility?.coreVersion, /^\d+\.\d+\.\d+$/, '/compatibility/coreVersion', 'ATM_SPEC_VERSION_PATTERN'); |
| `ATM_STATUS_PHASE_B1_COMPLETE` | `packages/cli/src/commands/status.ts:29` | ? message('info', 'ATM_STATUS_PHASE_B1_COMPLETE', 'ATM framework Phase B1 is complete.') |
| `ATM_STATUS_PHASE_B1_INCOMPLETE` | `packages/cli/src/commands/status.ts:30` | : message('error', 'ATM_STATUS_PHASE_B1_INCOMPLETE', 'ATM framework Phase B1 is not complete yet.', { issues: governance.verificationIssues }) |
| `ATM_STATUS_READY` | `packages/cli/src/commands/status.ts:79` | ? message('info', 'ATM_STATUS_READY', 'ATM standalone config is ready.') |
| `ATM_STATUS_REGISTRY_OK` | `packages/cli/src/commands/status.ts:14` | successCode: 'ATM_STATUS_REGISTRY_OK', |
| `ATM_TASK_CLAIM_MISSING` | `packages/cli/src/commands/tasks.ts:622` | throw new CliError('ATM_TASK_CLAIM_MISSING', &#96;Task ${options.taskId} has no active claim record.&#96;, { |
| `ATM_TASK_CLAIM_NOT_READY` | `packages/cli/src/commands/tasks.ts:570` | throw new CliError('ATM_TASK_CLAIM_NOT_READY', &#96;Task ${options.taskId} must be ready before it can be claimed.&#96;, { |
| `ATM_TASK_CLAIM_OWNER_MISMATCH` | `packages/cli/src/commands/tasks.ts:630` | throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', &#96;Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.&#96;, { |
| `ATM_TASK_CLOSE_EVIDENCE_REQUIRED` | `packages/cli/src/commands/tasks.ts:485` | throw new CliError('ATM_TASK_CLOSE_EVIDENCE_REQUIRED', &#96;Task ${options.taskId} cannot be closed as done without required evidence.&#96;, { |
| `ATM_TASK_CLOSE_OWNER_MISMATCH` | `packages/cli/src/commands/tasks.ts:471` | throw new CliError('ATM_TASK_CLOSE_OWNER_MISMATCH', &#96;Task ${options.taskId} owner is ${currentOwner}, not ${actorId}.&#96;, { |
| `ATM_TASK_NOT_FOUND` | `packages/cli/src/commands/git-governance.ts:283` | throw new CliError('ATM_TASK_NOT_FOUND', &#96;Task file not found for ${taskId}.&#96;, { |
| `ATM_TASKS_CLAIM_ACQUIRED` | `packages/cli/src/commands/tasks.ts:607` | messages: [message('info', 'ATM_TASKS_CLAIM_ACQUIRED', &#96;Claim acquired for ${options.taskId}.&#96;, { |
| `ATM_TASKS_CLAIM_HANDOFF` | `packages/cli/src/commands/tasks.ts:717` | messages: [message('info', 'ATM_TASKS_CLAIM_HANDOFF', &#96;Claim for ${options.taskId} handed off to ${options.handoffTo}.&#96;, { |
| `ATM_TASKS_CLAIM_RELEASED` | `packages/cli/src/commands/tasks.ts:681` | messages: [message('info', 'ATM_TASKS_CLAIM_RELEASED', &#96;Claim released for ${options.taskId}.&#96;, { taskId: options.taskId, actorId })], |
| `ATM_TASKS_CLAIM_RENEWED` | `packages/cli/src/commands/tasks.ts:648` | messages: [message('info', 'ATM_TASKS_CLAIM_RENEWED', &#96;Claim renewed for ${options.taskId}.&#96;, { taskId: options.taskId, actorId })], |
| `ATM_TASKS_CLAIM_TAKEOVER` | `packages/cli/src/commands/tasks.ts:773` | messages: [message('info', 'ATM_TASKS_CLAIM_TAKEOVER', &#96;Takeover completed for ${options.taskId}.&#96;, { |
| `ATM_TASKS_CLOSED` | `packages/cli/src/commands/tasks.ts:520` | messages: [message('info', 'ATM_TASKS_CLOSED', &#96;Task ${options.taskId} moved to ${options.status}.&#96;, { |
| `ATM_TASKS_DUPLICATE_ID` | `packages/cli/src/commands/tasks.ts:1170` | code: 'ATM_TASKS_DUPLICATE_ID', |
| `ATM_TASKS_IMPORT_DRIFT` | `packages/cli/src/commands/tasks.ts:1476` | code: 'ATM_TASKS_IMPORT_DRIFT', |
| `ATM_TASKS_IMPORT_DRY_RUN` | `packages/cli/src/commands/tasks.ts:196` | options.dryRun ? 'ATM_TASKS_IMPORT_DRY_RUN' : 'ATM_TASKS_IMPORT_WRITE_READY', |
| `ATM_TASKS_IMPORT_UNCHANGED` | `packages/cli/src/commands/tasks.ts:1468` | code: 'ATM_TASKS_IMPORT_UNCHANGED', |
| `ATM_TASKS_IMPORT_UNREADABLE_EXISTING` | `packages/cli/src/commands/tasks.ts:1484` | code: 'ATM_TASKS_IMPORT_UNREADABLE_EXISTING', |
| `ATM_TASKS_IMPORT_WRITE_FAILED` | `packages/cli/src/commands/tasks.ts:160` | throw new CliError('ATM_TASKS_IMPORT_WRITE_FAILED', 'Task plan import refused to write because of conflicts.', { |
| `ATM_TASKS_IMPORT_WRITE_READY` | `packages/cli/src/commands/tasks.ts:196` | options.dryRun ? 'ATM_TASKS_IMPORT_DRY_RUN' : 'ATM_TASKS_IMPORT_WRITE_READY', |
| `ATM_TASKS_PLAN_EMPTY` | `packages/cli/src/commands/tasks.ts:135` | code: 'ATM_TASKS_PLAN_EMPTY', |
| `ATM_TASKS_PLAN_NOT_FOUND` | `packages/cli/src/commands/tasks.ts:117` | throw new CliError('ATM_TASKS_PLAN_NOT_FOUND', &#96;Plan markdown file not found: ${options.from}&#96;, { |
| `ATM_TASKS_PLAN_PARSE_FAILED` | `packages/cli/src/commands/tasks.ts:139` | throw new CliError('ATM_TASKS_PLAN_PARSE_FAILED', 'Task plan import failed before writing any tasks.', { |
| `ATM_TASKS_PROMOTE_INVALID_STATE` | `packages/cli/src/commands/tasks.ts:427` | throw new CliError('ATM_TASKS_PROMOTE_INVALID_STATE', &#96;Task ${options.taskId} must be in reserved state before promote.&#96;, { |
| `ATM_TASKS_PROMOTE_OWNER_MISMATCH` | `packages/cli/src/commands/tasks.ts:421` | throw new CliError('ATM_TASKS_PROMOTE_OWNER_MISMATCH', &#96;Task ${options.taskId} is reserved by ${currentOwner}, not ${actorId}.&#96;, { |
| `ATM_TASKS_PROMOTED` | `packages/cli/src/commands/tasks.ts:440` | messages: [message('info', 'ATM_TASKS_PROMOTED', &#96;Task ${options.taskId} promoted to ready by ${actorId}.&#96;, { |
| `ATM_TASKS_RESERVED` | `packages/cli/src/commands/tasks.ts:405` | messages: [message('info', 'ATM_TASKS_RESERVED', &#96;Task ${options.taskId} reserved by ${actorId}.&#96;, { |
| `ATM_TASKS_STATUS_UNKNOWN` | `packages/cli/src/commands/tasks.ts:1395` | code: 'ATM_TASKS_STATUS_UNKNOWN', |
| `ATM_TASKS_TAKEOVER_NOT_ALLOWED` | `packages/cli/src/commands/tasks.ts:742` | throw new CliError('ATM_TASKS_TAKEOVER_NOT_ALLOWED', &#96;Claim for ${options.taskId} is still active under ${currentClaim.actorId}.&#96;, { |
| `ATM_TASKS_TAKEOVER_SELF` | `packages/cli/src/commands/tasks.ts:733` | throw new CliError('ATM_TASKS_TAKEOVER_SELF', &#96;tasks takeover is intended for a different actor; ${actorId} already owns ${options.taskId}.&#96;, { |
| `ATM_TASKS_VERIFY_BAD_SOURCE_TRACE` | `packages/cli/src/commands/tasks.ts:299` | code: 'ATM_TASKS_VERIFY_BAD_SOURCE_TRACE', |
| `ATM_TASKS_VERIFY_DEPENDENCY_MISSING` | `packages/cli/src/commands/tasks.ts:327` | code: 'ATM_TASKS_VERIFY_DEPENDENCY_MISSING', |
| `ATM_TASKS_VERIFY_DEPENDENCY_TYPE` | `packages/cli/src/commands/tasks.ts:310` | code: 'ATM_TASKS_VERIFY_DEPENDENCY_TYPE', |
| `ATM_TASKS_VERIFY_DUPLICATE_ID` | `packages/cli/src/commands/tasks.ts:278` | code: 'ATM_TASKS_VERIFY_DUPLICATE_ID', |
| `ATM_TASKS_VERIFY_FAILED` | `packages/cli/src/commands/tasks.ts:353` | ok ? 'ATM_TASKS_VERIFY_OK' : 'ATM_TASKS_VERIFY_FAILED', |
| `ATM_TASKS_VERIFY_INVALID_JSON` | `packages/cli/src/commands/tasks.ts:256` | code: 'ATM_TASKS_VERIFY_INVALID_JSON', |
| `ATM_TASKS_VERIFY_INVALID_STATUS` | `packages/cli/src/commands/tasks.ts:289` | code: 'ATM_TASKS_VERIFY_INVALID_STATUS', |
| `ATM_TASKS_VERIFY_MISSING_ID` | `packages/cli/src/commands/tasks.ts:270` | code: 'ATM_TASKS_VERIFY_MISSING_ID', |
| `ATM_TASKS_VERIFY_OK` | `packages/cli/src/commands/tasks.ts:353` | ok ? 'ATM_TASKS_VERIFY_OK' : 'ATM_TASKS_VERIFY_FAILED', |
| `ATM_TASKS_VERIFY_STORE_MISSING` | `packages/cli/src/commands/tasks.ts:226` | code: 'ATM_TASKS_VERIFY_STORE_MISSING', |
| `ATM_TELEMETRY_DISABLED` | `packages/cli/src/commands/telemetry.ts:26` | code = 'ATM_TELEMETRY_DISABLED'; |
| `ATM_TELEMETRY_ENABLED` | `packages/cli/src/commands/telemetry.ts:22` | code = 'ATM_TELEMETRY_ENABLED'; |
| `ATM_TELEMETRY_NOTICE` | `packages/cli/src/commands/welcome.ts:100` | message('info', 'ATM_TELEMETRY_NOTICE', 'ATM telemetry is opt-in only. Run &#96;node atm.mjs telemetry --on --json&#96; after reviewing docs/TELEMETRY.md.'), |
| `ATM_TELEMETRY_STATUS` | `packages/cli/src/commands/telemetry.ts:15` | let code = 'ATM_TELEMETRY_STATUS'; |
| `ATM_TEMP_ROOT` | `packages/cli/src/config/env-registry.ts:33` | name: 'ATM_TEMP_ROOT', |
| `ATM_TEST` | `tests/unit/shared-helpers.unit.test.ts:24` | const m = message('info', 'ATM_TEST', 'hello'); |
| `ATM_TEST_HELLO_WORLD_FAILED` | `packages/cli/src/commands/test.ts:74` | : message('error', 'ATM_TEST_HELLO_WORLD_FAILED', 'hello-world atom smoke validation failed.', { checks: smoke.checks }) |
| `ATM_TEST_HELLO_WORLD_OK` | `packages/cli/src/commands/test.ts:73` | ? message('info', 'ATM_TEST_HELLO_WORLD_OK', 'hello-world atom smoke validation passed.') |
| `ATM_TEST_MAP_EQUIVALENCE_FAILED` | `packages/cli/src/commands/test.ts:97` | : message('error', 'ATM_TEST_MAP_EQUIVALENCE_FAILED', 'Atomic map equivalence test failed.', { mapId, failedCaseIds: testRun.failedCaseIds }) |
| `ATM_TEST_MAP_EQUIVALENCE_OK` | `packages/cli/src/commands/test.ts:96` | ? message('info', 'ATM_TEST_MAP_EQUIVALENCE_OK', 'Atomic map equivalence test passed.', { mapId, acceptedKnownDivergenceIds: testRun.acceptedKnownDivergenceIds }) |
| `ATM_TEST_MAP_FAILED` | `packages/cli/src/commands/test.ts:125` | : message('error', 'ATM_TEST_MAP_FAILED', 'Atomic map integration test failed.', { mapId, failedDownstream: testRun.report.failedDownstream }) |
| `ATM_TEST_MAP_OK` | `packages/cli/src/commands/test.ts:124` | ? message('info', 'ATM_TEST_MAP_OK', 'Atomic map integration test passed.', { mapId }) |
| `ATM_TEST_PROPAGATE_FAILED` | `packages/cli/src/commands/test.ts:168` | const infoCode = propagation.ok ? 'ATM_TEST_PROPAGATE_OK' : 'ATM_TEST_PROPAGATE_FAILED'; |
| `ATM_TEST_PROPAGATE_OK` | `packages/cli/src/commands/test.ts:168` | const infoCode = propagation.ok ? 'ATM_TEST_PROPAGATE_OK' : 'ATM_TEST_PROPAGATE_FAILED'; |
| `ATM_TEST_REPORT_INVALID` | `packages/core/src/manager/test-runner.ts:187` | return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_INVALID', (validate.errors &#124;&#124; []).map((error: any) =&gt; ({ |
| `ATM_TEST_REPORT_OK` | `packages/core/src/manager/test-runner.ts:200` | code: 'ATM_TEST_REPORT_OK', |
| `ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE` | `packages/core/src/manager/test-runner.ts:172` | return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE', [ |
| `ATM_TEST_SPEC_FAILED` | `packages/cli/src/commands/test.ts:232` | : message('error', 'ATM_TEST_SPEC_FAILED', 'Atomic spec validation commands failed.', { atomId: testRun.atomId }) |
| `ATM_TEST_SPEC_OK` | `packages/cli/src/commands/test.ts:231` | ? message('info', 'ATM_TEST_SPEC_OK', 'Atomic spec validation commands passed.', { atomId: testRun.atomId }) |
| `ATM_UPGRADE_APPLIED` | `packages/cli/src/commands/upgrade.ts:409` | : message('info', 'ATM_UPGRADE_APPLIED', 'Safe ATM onboarding upgrade applied after backup.')], |
| `ATM_UPGRADE_BACKUP_INVALID` | `packages/cli/src/commands/upgrade.ts:435` | throw new CliError('ATM_UPGRADE_BACKUP_INVALID', 'Rollback requires an atm.safeUpgradeBackupManifest document.', { exitCode: 2 }); |
| `ATM_UPGRADE_BACKUP_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:433` | const manifest = readJsonFile(backupManifestPath, 'ATM_UPGRADE_BACKUP_NOT_FOUND'); |
| `ATM_UPGRADE_CANARY_APPLIED` | `packages/cli/src/commands/upgrade.ts:408` | ? message('info', 'ATM_UPGRADE_CANARY_APPLIED', 'Safe ATM onboarding upgrade applied to the selected canary subset after backup.', { percent: canary.percent }) |
| `ATM_UPGRADE_CANARY_PERCENT_INVALID` | `packages/cli/src/commands/upgrade/canary.ts:20` | throw new CliError('ATM_UPGRADE_CANARY_PERCENT_INVALID', '--canary must be an integer percent from 1 to 100', { exitCode: 2, details: { value } }); |
| `ATM_UPGRADE_CONTEXT_POLICY_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:1119` | return readJsonFile(policyPath, 'ATM_UPGRADE_CONTEXT_POLICY_NOT_FOUND'); |
| `ATM_UPGRADE_INPUT_NOT_FOUND` | `packages/cli/src/commands/upgrade-map-propose.ts:66` | document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND') |
| `ATM_UPGRADE_INPUTS_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:937` | throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/history/reports.', { |
| `ATM_UPGRADE_PLAN_INVALID` | `packages/cli/src/commands/upgrade.ts:354` | throw new CliError('ATM_UPGRADE_PLAN_INVALID', 'Safe upgrade apply requires an atm.safeUpgradePlan document.', { exitCode: 2 }); |
| `ATM_UPGRADE_PLAN_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:352` | const plan = readJsonFile(planPath, 'ATM_UPGRADE_PLAN_NOT_FOUND'); |
| `ATM_UPGRADE_PLAN_READY` | `packages/cli/src/commands/upgrade.ts:337` | : message('info', 'ATM_UPGRADE_PLAN_READY', 'Safe ATM onboarding upgrade plan generated as dry-run output.') |
| `ATM_UPGRADE_PROPOSAL_BLOCKED` | `packages/cli/src/commands/upgrade.ts:103` | ? message('warning', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'Upgrade proposal blocked by automated gates.', { |
| `ATM_UPGRADE_PROPOSAL_READY` | `packages/cli/src/commands/upgrade.ts:107` | : message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Upgrade proposal prepared and ready for review.', { |
| `ATM_UPGRADE_ROLLBACK_OK` | `packages/cli/src/commands/upgrade.ts:460` | messages: [message('info', 'ATM_UPGRADE_ROLLBACK_OK', 'Safe ATM onboarding upgrade rollback restored the previous files.')], |
| `ATM_UPGRADE_STORE_MISSING` | `packages/cli/src/commands/upgrade.ts:1053` | throw new CliError('ATM_UPGRADE_STORE_MISSING', 'Required governance stores are not available for upgrade hard-stop persistence.'); |
| `ATM_UPGRADE_UNKNOWN_CHART_ALLOWED` | `packages/cli/src/commands/upgrade.ts:336` | ? message('warning', 'ATM_UPGRADE_UNKNOWN_CHART_ALLOWED', 'Unknown ATMChart version allowed by explicit --allow-unknown-chart override.', { readOnlyDiagnostic: true }) |
| `ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE` | `packages/cli/src/commands/upgrade.ts:292` | throw new CliError('ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE', 'ATMChart version is unknown. Safe upgrade plan is read-only but still requires --allow-unknown-chart before preparing write-oriented follow-up steps.', { |
| `ATM_UPGRADE_UNSAFE_PATH` | `packages/cli/src/commands/upgrade/path-helpers.ts:37` | throw new CliError('ATM_UPGRADE_UNSAFE_PATH', &#96;Unsafe upgrade path: ${relativePath}&#96;, { exitCode: 2 }); |
| `ATM_URN_INVALID` | `packages/core/src/registry/urn.ts:49` | throw new AtmUrnError('ATM_URN_INVALID', 'ATM URN must match urn:atm:&lt;nodeKind&gt;:&lt;canonicalId&gt;[@&lt;semver&gt;].', { value }); |
| `ATM_USER_NOTICE` | `packages/cli/src/commands/next.ts:607` | messages.push(message('info', 'ATM_USER_NOTICE', userNotice.spokenLine, { |
| `ATM_VALIDATE_REPOSITORY_OK` | `packages/cli/src/commands/validate.ts:51` | messages.push(message('info', 'ATM_VALIDATE_REPOSITORY_OK', 'ATM repository config validated in standalone mode.')); |
| `ATM_VALIDATE_SPEC_OK` | `packages/cli/src/commands/spec-shared.ts:25` | const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK'; |
| `ATM_VERIFY_AGENTS_MD_FAILED` | `packages/cli/src/commands/verify.ts:100` | : message('error', 'ATM_VERIFY_AGENTS_MD_FAILED', 'AGENTS bootstrap instructions are missing required markers or contain vendor-specific guidance.', { issues: verification.issues, mode: verification.mode }) |
| `ATM_VERIFY_AGENTS_MD_OK` | `packages/cli/src/commands/verify.ts:99` | ? message('info', 'ATM_VERIFY_AGENTS_MD_OK', 'AGENTS bootstrap instructions are vendor-neutral and complete.', { mode: verification.mode }) |
| `ATM_VERIFY_GUARDS_EVIDENCE_NOT_FOUND` | `packages/cli/src/commands/verify.ts:123` | throw new CliError('ATM_VERIFY_GUARDS_EVIDENCE_NOT_FOUND', &#96;Guard evidence file not found: ${evidencePath}&#96;, { |
| `ATM_VERIFY_GUARDS_EVIDENCE_PARSE_ERROR` | `packages/cli/src/commands/verify.ts:133` | throw new CliError('ATM_VERIFY_GUARDS_EVIDENCE_PARSE_ERROR', &#96;Guard evidence file is not valid JSON: ${evidencePath}&#96;, { |
| `ATM_VERIFY_GUARDS_MISSING_JUSTIFICATION` | `packages/cli/src/commands/verify.ts:147` | messages: [message('error', 'ATM_VERIFY_GUARDS_MISSING_JUSTIFICATION', |
| `ATM_VERIFY_GUARDS_OK` | `packages/cli/src/commands/verify.ts:164` | messages: [message('info', 'ATM_VERIFY_GUARDS_OK', |
| `ATM_VERIFY_NEUTRALITY_FAILED` | `packages/cli/src/commands/verify.ts:71` | : [message('error', 'ATM_VERIFY_NEUTRALITY_FAILED', 'Neutrality scan found adopter-specific references in protected framework surfaces.', { violations: report.totals.violations })]; |
| `ATM_VERIFY_NEUTRALITY_OK` | `packages/cli/src/commands/verify.ts:70` | ? [message('info', 'ATM_VERIFY_NEUTRALITY_OK', 'Neutrality scan passed across protected framework surfaces.', { scannedFiles: report.totals.scannedFiles })] |
| `ATM_VERIFY_REGISTRY_OK` | `packages/cli/src/commands/registry-shared.ts:86` | const successCode = options.successCode ?? 'ATM_VERIFY_REGISTRY_OK'; |
| `ATM_VERIFY_REGISTRY_SCHEMA_OK` | `packages/cli/src/commands/verify.ts:33` | successCode: 'ATM_VERIFY_REGISTRY_SCHEMA_OK', |
| `ATM_VERIFY_SELF_DRIFT` | `packages/cli/src/commands/verify.ts:46` | : message('error', 'ATM_VERIFY_SELF_DRIFT', 'Seed self-verification detected registry drift.', { issues: verification.issues }) |
| `ATM_VERIFY_SELF_OK` | `packages/cli/src/commands/verify.ts:45` | ? message('info', 'ATM_VERIFY_SELF_OK', 'Seed self-verification hashes match the committed registry entry.') |
| `ATM_VERSION_INVALID` | `packages/cli/src/commands/atm-chart/semver.ts:7` | * lexicographic within). Throws &#96;CliError(ATM_VERSION_INVALID, exitCode=2)&#96; |
| `ATM_WELCOME_DRY_RUN` | `packages/cli/src/commands/welcome.ts:73` | message('info', dryRun ? 'ATM_WELCOME_DRY_RUN' : 'ATM_WELCOME_READY', dryRun |
| `ATM_WELCOME_INTEGRATION_INSTALL_RECOMMENDED` | `packages/cli/src/commands/welcome.ts:79` | 'ATM_WELCOME_INTEGRATION_INSTALL_RECOMMENDED', |
| `ATM_WELCOME_READ_ONLY_DIAGNOSTIC` | `packages/cli/src/commands/welcome.ts:44` | throw new CliError('ATM_WELCOME_READ_ONLY_DIAGNOSTIC', 'ATMChart version is unsupported or unknown; run &#96;node atm.mjs welcome --dry-run --json&#96; or &#96;node atm.mjs upgrade plan --json&#96; before writing lineage.', { |
| `ATM_WELCOME_READY` | `packages/cli/src/commands/welcome.ts:73` | message('info', dryRun ? 'ATM_WELCOME_DRY_RUN' : 'ATM_WELCOME_READY', dryRun |
| `ATM_X` | `tests/unit/shared-helpers.unit.test.ts:53` | messages: [message('warn', 'ATM_X', 't')], |
