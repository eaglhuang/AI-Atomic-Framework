# ATM Error Codes

Generated from `packages/`, `scripts/`, `tests/`, and `examples/` TypeScript sources.

Regenerate with `npm run generate:error-codes`.

| Code | Location | Context |
| --- | --- | --- |
| `ATM_ATOM_ID_INVALID` | `packages/core/src/registry/urn.ts:140` | throw new AtmUrnError('ATM_ATOM_ID_INVALID', 'ATM atom-like URN must use ATM-{bucket}-0000 canonical IDs.', { canonicalId, nodeKind }); |
| `ATM_BOOTSTRAP_CREATED` | `packages/cli/src/commands/bootstrap-entry.ts:18` | ? message('info', 'ATM_BOOTSTRAP_CREATED', 'ATM default bootstrap pack created.') |
| `ATM_BOOTSTRAP_READY` | `packages/cli/src/commands/bootstrap-entry.ts:19` | : message('info', 'ATM_BOOTSTRAP_READY', 'ATM default bootstrap pack already exists; no files were changed.') |
| `ATM_BUCKET_INVALID` | `packages/core/src/manager/id-allocator.ts:26` | throw new AtomIdAllocationError('ATM_BUCKET_INVALID', 'Atom ID bucket must match /^[A-Z][A-Z0-9]*$/.', { bucket }); |
| `ATM_BUCKET_REQUIRED` | `packages/core/src/manager/id-allocator.ts:21` | throw new AtomIdAllocationError('ATM_BUCKET_REQUIRED', 'Atom ID bucket must be a string.', { bucket }); |
| `ATM_BUDGET_CHECKED` | `packages/cli/src/commands/budget.ts:34` | messages: [message('info', 'ATM_BUDGET_CHECKED', 'Context budget evaluated.', { decision: evaluation.decision })], |
| `ATM_BUDGET_GUARD_MISSING` | `packages/cli/src/commands/budget.ts:20` | throw new CliError('ATM_BUDGET_GUARD_MISSING', 'Context budget guard is not available for this adapter.'); |
| `ATM_CANONICAL_ID_INVALID` | `packages/core/src/registry/urn.ts:26` | throw new AtmUrnError('ATM_CANONICAL_ID_INVALID', 'Canonical ATM ID is invalid.', { canonicalId }); |
| `ATM_CANONICAL_ID_REQUIRED` | `packages/core/src/registry/urn.ts:116` | throw new AtmUrnError('ATM_CANONICAL_ID_REQUIRED', 'Canonical ATM ID is required.'); |
| `ATM_CLI_HELP` | `packages/cli/src/atm.ts:148` | messages: [message('info', 'ATM_CLI_HELP', 'Use "node atm.mjs &lt;command&gt; --help" for command details.')], |
| `ATM_CLI_HELP_NOT_FOUND` | `packages/cli/src/atm.ts:110` | messages: [message('error', 'ATM_CLI_HELP_NOT_FOUND', &#96;No help spec found for ${commandName}.&#96;)], |
| `ATM_CLI_HELP_READY` | `packages/cli/src/commands/shared.ts:139` | messages: [message('info', 'ATM_CLI_HELP_READY', &#96;Help for ${spec.name}.&#96;)], |
| `ATM_CLI_UNHANDLED` | `packages/cli/src/atm.ts:127` | : new CliError('ATM_CLI_UNHANDLED', error instanceof Error ? error.message : String(error)); |
| `ATM_CLI_UNKNOWN_COMMAND` | `packages/cli/src/atm.ts:76` | messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', &#96;Unknown command: ${targetCommand}&#96;)], |
| `ATM_CLI_USAGE` | `packages/cli/src/commands/budget.ts:94` | throw new CliError('ATM_CLI_USAGE', &#96;budget does not support option ${arg}&#96;, { exitCode: 2 }); |
| `ATM_CONFIG_ADAPTER_MODE` | `packages/cli/src/commands/validate.ts:47` | messages.push(message('error', 'ATM_CONFIG_ADAPTER_MODE', 'ATM-1 CLI MVP only supports standalone mode.', { adapterMode: config.adapter?.mode })); |
| `ATM_CONFIG_MISSING` | `packages/cli/src/commands/status.ts:52` | messages: [message('error', 'ATM_CONFIG_MISSING', 'ATM config is missing. Run atm init first.')], |
| `ATM_CONFIG_UNSUPPORTED_VERSION` | `packages/cli/src/commands/status.ts:79` | : message('error', 'ATM_CONFIG_UNSUPPORTED_VERSION', 'ATM config schemaVersion is not supported.', { schemaVersion: config.schemaVersion }) |
| `ATM_CREATE_DRY_RUN_OK` | `packages/cli/src/commands/create.ts:23` | ? message('info', options.dryRun ? 'ATM_CREATE_DRY_RUN_OK' : 'ATM_CREATE_OK', options.dryRun ? 'Atom create dry-run completed.' : 'Atom created and registered.', { atomId: result.atomId }) |
| `ATM_CREATE_FAILED` | `packages/cli/src/commands/create.ts:24` | : message('error', result.error?.code ?? 'ATM_CREATE_FAILED', result.error?.message ?? 'Atom creation failed.', result.error?.details ?? {}) |
| `ATM_CREATE_MAP_DRY_RUN_OK` | `packages/cli/src/commands/create-map.ts:24` | ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId }) |
| `ATM_CREATE_MAP_FAILED` | `packages/cli/src/commands/create-map.ts:25` | : message('error', result.error?.code ?? 'ATM_CREATE_MAP_FAILED', result.error?.message ?? 'Atomic map creation failed.', result.error?.details ?? {}) |
| `ATM_CREATE_MAP_OK` | `packages/cli/src/commands/create-map.ts:24` | ? message('info', options.dryRun ? 'ATM_CREATE_MAP_DRY_RUN_OK' : 'ATM_CREATE_MAP_OK', options.dryRun ? 'Atomic map create dry-run completed.' : 'Atomic map created and registered.', { mapId: result.mapId }) |
| `ATM_CREATE_OK` | `packages/cli/src/commands/create.ts:23` | ? message('info', options.dryRun ? 'ATM_CREATE_DRY_RUN_OK' : 'ATM_CREATE_OK', options.dryRun ? 'Atom create dry-run completed.' : 'Atom created and registered.', { atomId: result.atomId }) |
| `ATM_DIFF_ATOM_NOT_FOUND` | `packages/cli/src/commands/registry-diff.ts:103` | messages: [message('error', 'ATM_DIFF_ATOM_NOT_FOUND', &#96;Atom ${parsed.atomId} not found in registry.&#96;)], |
| `ATM_DIFF_COMPUTE_FAILED` | `packages/cli/src/commands/registry-diff.ts:133` | messages: [message('error', 'ATM_DIFF_COMPUTE_FAILED', error.message)], |
| `ATM_DIFF_MISSING_ATOM_ID` | `packages/cli/src/commands/registry-diff.ts:67` | messages: [message('error', 'ATM_DIFF_MISSING_ATOM_ID', 'Missing required argument: atomId. Usage: atm registry-diff &lt;atomId&gt; --from &lt;v1&gt; --to &lt;v2&gt;')], |
| `ATM_DIFF_MISSING_VERSIONS` | `packages/cli/src/commands/registry-diff.ts:77` | messages: [message('error', 'ATM_DIFF_MISSING_VERSIONS', 'Missing required flags: --from &lt;version&gt; --to &lt;version&gt;')], |
| `ATM_DIFF_NO_VERSIONS` | `packages/cli/src/commands/registry-diff.ts:114` | messages: [message('error', 'ATM_DIFF_NO_VERSIONS', &#96;Atom ${parsed.atomId} has no version history. Ensure ATM-2-0014 registry version history is populated.&#96;)], |
| `ATM_DIFF_OK` | `packages/cli/src/commands/registry-diff.ts:147` | messages: [message('info', 'ATM_DIFF_OK', summaryText)], |
| `ATM_DIFF_REGISTRY_NOT_FOUND` | `packages/cli/src/commands/registry-diff.ts:91` | messages: [message('error', 'ATM_DIFF_REGISTRY_NOT_FOUND', error.message)], |
| `ATM_DOCTOR_FAILED` | `packages/cli/src/commands/doctor.ts:91` | : [message('error', 'ATM_DOCTOR_FAILED', 'ATM engineering or runtime signals need attention.', { failedChecks })]; |
| `ATM_DOCTOR_GIT_EVIDENCE_MISSING` | `packages/cli/src/commands/doctor.ts:90` | ? [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'Latest Git commit has no matching ATM evidence; work may have bypassed ATM.', { failedChecks })] |
| `ATM_DOCTOR_OK` | `packages/cli/src/commands/doctor.ts:88` | ? [message('info', 'ATM_DOCTOR_OK', 'ATM engineering and runtime signals are ready.')] |
| `ATM_GENERATOR_ATOM_ID_BUCKET_MISMATCH` | `packages/core/src/manager/atom-generator.ts:328` | throw createGeneratorError('ATM_GENERATOR_ATOM_ID_BUCKET_MISMATCH', 'Provided atomId bucket must match the generator request bucket.', { |
| `ATM_GENERATOR_ATOM_ID_INVALID` | `packages/core/src/manager/atom-generator.ts:325` | throw createGeneratorError('ATM_GENERATOR_ATOM_ID_INVALID', 'Provided atomId must match ATM-{BUCKET}-{NNNN}.', { atomId: requestedAtomId }); |
| `ATM_GENERATOR_LOGICAL_NAME_INVALID` | `packages/core/src/manager/atom-generator.ts:281` | throw createGeneratorError('ATM_GENERATOR_LOGICAL_NAME_INVALID', 'logicalName must match atom namespace syntax.', { logicalName: value }); |
| `ATM_GENERATOR_REGISTRY_INVALID` | `packages/core/src/manager/atom-generator.ts:148` | throw createGeneratorError('ATM_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation }); |
| `ATM_GENERATOR_REQUEST_INVALID` | `packages/core/src/manager/atom-generator.ts:256` | throw createGeneratorError('ATM_GENERATOR_REQUEST_INVALID', 'Atom generator request must be an object.'); |
| `ATM_GENERATOR_SPEC_INVALID` | `packages/core/src/manager/atom-generator.ts:71` | throw createGeneratorError('ATM_GENERATOR_SPEC_INVALID', parseResult.promptReport?.summary ?? 'Generated atomic spec is invalid.', { parseResult }); |
| `ATM_GENERATOR_TEST_FAILED` | `packages/core/src/manager/atom-generator.ts:121` | throw createGeneratorError('ATM_GENERATOR_TEST_FAILED', 'Generated atom validation command failed.', { testRun }); |
| `ATM_GENERATOR_UNHANDLED` | `packages/core/src/manager/atom-generator.ts:468` | code: typedError?.code ?? 'ATM_GENERATOR_UNHANDLED', |
| `ATM_GUARD_ENCODING_FAILED` | `packages/cli/src/commands/guard.ts:31` | messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })], |
| `ATM_GUARD_ENCODING_OK` | `packages/cli/src/commands/guard.ts:31` | messages: [findings.length === 0 ? message('info', 'ATM_GUARD_ENCODING_OK', 'Encoding guard passed.') : message('error', 'ATM_GUARD_ENCODING_FAILED', 'Encoding guard found issues.', { findingCount: findings.length })], |
| `ATM_GUIDE_READY` | `packages/cli/src/commands/guide.ts:235` | messages: [message('info', 'ATM_GUIDE_READY', &#96;Guide for ${guide.intent} is ready.&#96;, { intent: guide.intent })], |
| `ATM_HANDOFF_STORE_MISSING` | `packages/cli/src/commands/handoff.ts:22` | throw new CliError('ATM_HANDOFF_STORE_MISSING', 'Context summary store is not available for this adapter.'); |
| `ATM_HANDOFF_SUMMARY_WRITTEN` | `packages/cli/src/commands/handoff.ts:59` | messages: [message('info', 'ATM_HANDOFF_SUMMARY_WRITTEN', 'Handoff summary written.', { taskId, summaryPath: summary.summaryMarkdownPath ?? null })], |
| `ATM_HUMAN_REVIEW_SNAPSHOT_MISMATCH` | `packages/cli/src/commands/review.ts:107` | throw new CliError('ATM_HUMAN_REVIEW_SNAPSHOT_MISMATCH', 'decision-snapshot.hash mismatch.', { |
| `ATM_INIT_ALREADY_INITIALIZED` | `packages/cli/src/commands/init.ts:77` | ? message('info', 'ATM_INIT_ALREADY_INITIALIZED', 'ATM config already exists; no files were changed.') |
| `ATM_INIT_CREATED` | `packages/cli/src/commands/init.ts:78` | : message('info', 'ATM_INIT_CREATED', 'ATM standalone config created.') |
| `ATM_INIT_DRY_RUN_OK` | `packages/cli/src/commands/init.ts:112` | messages: [message('info', 'ATM_INIT_DRY_RUN_OK', 'ATM init adoption dry-run completed.')], |
| `ATM_JS_ENTRYPOINT_EXPORT_MISSING` | `packages/language-js/src/language-js-adapter.ts:44` | messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_EXPORT_MISSING', 'Entrypoint must export a run function or a default function.', entrypointFile.filePath)); |
| `ATM_JS_ENTRYPOINT_MISSING` | `packages/language-js/src/language-js-adapter.ts:42` | messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint)); |
| `ATM_JS_FORBIDDEN_IMPORT` | `packages/language-js/src/language-js-adapter.ts:49` | messages.push(createMessage('error', 'ATM_JS_FORBIDDEN_IMPORT', &#96;Forbidden import: ${importRecord.specifier}&#96;, importRecord.filePath, importRecord.line)); |
| `ATM_JS_VALIDATE_OK` | `packages/language-js/src/language-js-adapter.ts:54` | messages.push(createMessage('info', 'ATM_JS_VALIDATE_OK', 'JavaScript/TypeScript compute atom passed adapter checks.')); |
| `ATM_JSON_INVALID` | `packages/cli/src/commands/create-map.ts:136` | throw new CliError('ATM_JSON_INVALID', &#96;Invalid JSON for ${optionName}.&#96;, { |
| `ATM_JSON_NOT_FOUND` | `packages/cli/src/commands/shared.ts:348` | export function readJsonFile(filePath: any, missingCode = 'ATM_JSON_NOT_FOUND') { |
| `ATM_LEGACY_URI_FRAGMENT_INVALID` | `packages/core/src/registry/urn.ts:165` | throw new AtmUrnError('ATM_LEGACY_URI_FRAGMENT_INVALID', 'Legacy URI line fragment must match #Lx or #Lx-Ly.', { value }); |
| `ATM_LEGACY_URI_INVALID` | `packages/core/src/registry/urn.ts:148` | throw new AtmUrnError('ATM_LEGACY_URI_INVALID', 'Legacy URI must match legacy://&lt;repository&gt;/&lt;path&gt;[#Lx[-Ly]].', { value }); |
| `ATM_LEGACY_URI_REPOSITORY_REQUIRED` | `packages/core/src/registry/urn.ts:156` | throw new AtmUrnError('ATM_LEGACY_URI_REPOSITORY_REQUIRED', 'Legacy URI requires repository alias.', { value }); |
| `ATM_LOCK_ACQUIRED` | `packages/cli/src/commands/lock.ts:34` | messages: [message('info', 'ATM_LOCK_ACQUIRED', 'Scope lock acquired.', { taskId: options.taskId, owner: options.owner })], |
| `ATM_LOCK_FOUND` | `packages/cli/src/commands/lock.ts:23` | messages: [ok ? message('info', 'ATM_LOCK_FOUND', 'Scope lock is active.', { taskId: options.taskId }) : message('info', 'ATM_LOCK_MISSING', 'No active scope lock was found.', { taskId: options.taskId })], |
| `ATM_LOCK_MISSING` | `packages/cli/src/commands/lock.ts:23` | messages: [ok ? message('info', 'ATM_LOCK_FOUND', 'Scope lock is active.', { taskId: options.taskId }) : message('info', 'ATM_LOCK_MISSING', 'No active scope lock was found.', { taskId: options.taskId })], |
| `ATM_LOCK_RELEASED` | `packages/cli/src/commands/lock.ts:44` | messages: [message('info', 'ATM_LOCK_RELEASED', 'Scope lock released.', { taskId: options.taskId, owner: options.owner })], |
| `ATM_MAP_BACKFILL_FAILED` | `scripts/backfill-map-generator-provenance.ts:31` | console.error(&#96;[backfill-map-generator-provenance] generator failed: ${result.error?.code ?? 'ATM_MAP_BACKFILL_FAILED'} ${result.error?.message ?? ''}&#96;.trim()); |
| `ATM_MAP_GENERATOR_ATOM_ID_INVALID` | `packages/core/src/manager/map-generator.ts:270` | throw createGeneratorError('ATM_MAP_GENERATOR_ATOM_ID_INVALID', &#96;${fieldName} must match ATM-{BUCKET}-{NNNN}.&#96;, { |
| `ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER` | `packages/core/src/manager/map-generator.ts:219` | throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER', 'Edge endpoints must reference declared map members.', { |
| `ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER` | `packages/core/src/manager/map-generator.ts:236` | throw createGeneratorError('ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER', 'Entrypoints must reference declared map members.', { |
| `ATM_MAP_GENERATOR_MAP_ID_INVALID` | `packages/core/src/manager/map-generator.ts:281` | throw createGeneratorError('ATM_MAP_GENERATOR_MAP_ID_INVALID', 'mapId must match ATM-MAP-{NNNN}.', { mapId: value }); |
| `ATM_MAP_GENERATOR_QUALITY_TARGET_INVALID` | `packages/core/src/manager/map-generator.ts:252` | throw createGeneratorError('ATM_MAP_GENERATOR_QUALITY_TARGET_INVALID', 'qualityTargets values must be string, number, or boolean.', { |
| `ATM_MAP_GENERATOR_REGISTRY_INVALID` | `packages/core/src/manager/map-generator.ts:124` | throw createGeneratorError('ATM_MAP_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation }); |
| `ATM_MAP_GENERATOR_REQUEST_INVALID` | `packages/core/src/manager/map-generator.ts:182` | throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator request must be an object.'); |
| `ATM_MAP_GENERATOR_TEST_FAILED` | `packages/core/src/manager/map-generator.ts:103` | throw createGeneratorError('ATM_MAP_GENERATOR_TEST_FAILED', 'Generated map validation command failed.', { testRun }); |
| `ATM_MAP_GENERATOR_UNHANDLED` | `packages/core/src/manager/map-generator.ts:534` | code: typedError?.code ?? 'ATM_MAP_GENERATOR_UNHANDLED', |
| `ATM_MAP_GENERATOR_VERSION_INVALID` | `packages/core/src/manager/map-generator.ts:289` | throw createGeneratorError('ATM_MAP_GENERATOR_VERSION_INVALID', &#96;${fieldName} must match semver x.y.z.&#96;, { |
| `ATM_MAP_ID_INVALID` | `packages/core/src/registry/urn.ts:135` | throw new AtmUrnError('ATM_MAP_ID_INVALID', 'ATM map URN must use ATM-MAP-0000 canonical IDs.', { canonicalId }); |
| `ATM_MAP_TEST_LEGACY_FALLBACK` | `packages/core/src/test-runner/map-integration.ts:51` | warnings: [&#96;ATM_MAP_TEST_LEGACY_FALLBACK:${legacy.workbenchPath}&#96;] |
| `ATM_MAP_TEST_TARGET_NOT_FOUND` | `packages/core/src/test-runner/map-integration.ts:55` | throw createMapRunnerError('ATM_MAP_TEST_TARGET_NOT_FOUND', 'Atomic map integration target was not found.', { |
| `ATM_NEXT_ACTION` | `packages/cli/src/commands/next.ts:15` | messages: [nextAction.status === 'ready' ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)], |
| `ATM_NEXT_READY` | `packages/cli/src/commands/next.ts:15` | messages: [nextAction.status === 'ready' ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)], |
| `ATM_NODE_KIND_INVALID` | `packages/core/src/registry/urn.ts:108` | throw new AtmUrnError('ATM_NODE_KIND_INVALID', 'ATM node kind is unsupported.', { nodeKind: value }); |
| `ATM_ONEFILE_EXTRACTED_ROOT` | `scripts/build-onefile-release.ts:219` | ATM_ONEFILE_EXTRACTED_ROOT: extractedRoot |
| `ATM_ONEFILE_PAYLOAD_SHA256` | `scripts/build-onefile-release.ts:218` | ATM_ONEFILE_PAYLOAD_SHA256: payloadSha256, |
| `ATM_ONEFILE_RUNTIME` | `scripts/build-onefile-release.ts:217` | ATM_ONEFILE_RUNTIME: '1', |
| `ATM_POLICE_DEPENDENCY_CYCLE` | `packages/core/src/police/dependency-graph.ts:81` | code: 'ATM_POLICE_DEPENDENCY_CYCLE', |
| `ATM_POLICE_FORBIDDEN_IMPORT` | `packages/core/src/police/forbidden-import-scanner.ts:26` | code: 'ATM_POLICE_FORBIDDEN_IMPORT', |
| `ATM_POLICE_LAYER_BOUNDARY` | `packages/core/src/police/layer-boundary.ts:25` | code: 'ATM_POLICE_LAYER_BOUNDARY', |
| `ATM_POLICE_LAYER_UNKNOWN` | `packages/core/src/police/layer-boundary.ts:11` | code: 'ATM_POLICE_LAYER_UNKNOWN', |
| `ATM_POLICE_PROMOTE_BLOCKED` | `packages/core/src/police/registry-consistency.ts:23` | code: 'ATM_POLICE_PROMOTE_BLOCKED', |
| `ATM_PROJECT_PROBE_MISSING` | `packages/cli/src/commands/status.ts:69` | ? readJsonFile(projectProbePath, 'ATM_PROJECT_PROBE_MISSING') |
| `ATM_REGISTRY_INDEX_DUPLICATE_KEY` | `packages/core/src/registry/registry-index.ts:139` | throw new RegistryIndexError('ATM_REGISTRY_INDEX_DUPLICATE_KEY', message, { key }); |
| `ATM_REGISTRY_INDEX_ENTRY_SKIPPED` | `packages/core/src/registry/registry-index.ts:29` | diagnostics.push({ code: 'ATM_REGISTRY_INDEX_ENTRY_SKIPPED', severity: 'warning', entry }); |
| `ATM_REGISTRY_INVALID` | `packages/core/src/manager/atom-generator.ts:308` | throw createGeneratorError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', { |
| `ATM_REGISTRY_NOT_FOUND` | `packages/cli/src/commands/registry-shared.ts:77` | return readJsonFile(registryFilePath, 'ATM_REGISTRY_NOT_FOUND'); |
| `ATM_REGISTRY_OK` | `packages/core/src/registry/registry.ts:184` | code: 'ATM_REGISTRY_OK', |
| `ATM_REGISTRY_SCHEMA_ERROR` | `packages/cli/src/commands/registry-shared.ts:92` | : (validation.promptReport?.issues ?? []).map((issue: any) =&gt; message('error', issue.code ?? 'ATM_REGISTRY_SCHEMA_ERROR', issue.text ?? 'Registry schema validation failed.', { path: issue.path ?? '/' })); |
| `ATM_REGISTRY_SCHEMA_NOT_FOUND` | `packages/core/src/registry/registry.ts:137` | return createFailure(schemaPath, 'ATM_REGISTRY_SCHEMA_NOT_FOUND', [ |
| `ATM_REGISTRY_VALIDATOR_UNAVAILABLE` | `packages/core/src/registry/registry.ts:157` | return createFailure(schemaPath, 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE', [ |
| `ATM_REVIEW_ADVISORY_OK` | `packages/cli/src/commands/review-advisory.ts:84` | const advisoryCode = report.advisoryUnavailable ? 'ATM_REVIEW_ADVISORY_UNAVAILABLE' : 'ATM_REVIEW_ADVISORY_OK'; |
| `ATM_REVIEW_ADVISORY_UNAVAILABLE` | `packages/cli/src/commands/review-advisory.ts:84` | const advisoryCode = report.advisoryUnavailable ? 'ATM_REVIEW_ADVISORY_UNAVAILABLE' : 'ATM_REVIEW_ADVISORY_OK'; |
| `ATM_REVIEW_ALREADY_DECIDED` | `packages/cli/src/commands/review.ts:90` | throw new CliError('ATM_REVIEW_ALREADY_DECIDED', &#96;Proposal ${proposalId} is already ${queueRecord.status}.&#96;, { |
| `ATM_REVIEW_APPROVED` | `packages/cli/src/commands/review.ts:165` | message('info', decision === 'approve' ? 'ATM_REVIEW_APPROVED' : 'ATM_REVIEW_REJECTED', &#96;Recorded ${decision} decision for ${queueRecord.proposalId}.&#96;, { |
| `ATM_REVIEW_DECISION_INVALID` | `packages/cli/src/commands/review.ts:142` | throw new CliError('ATM_REVIEW_DECISION_INVALID', 'Generated decision log is invalid.', { |
| `ATM_REVIEW_LIST_OK` | `packages/cli/src/commands/review.ts:205` | messages: [message('info', 'ATM_REVIEW_LIST_OK', &#96;Loaded ${queueDocument.entries.length} review proposal(s).&#96;)], |
| `ATM_REVIEW_PROPOSAL_NOT_FOUND` | `packages/cli/src/commands/review.ts:59` | throw new CliError('ATM_REVIEW_PROPOSAL_NOT_FOUND', &#96;Proposal not found in review queue: ${proposalId}&#96;, { |
| `ATM_REVIEW_QUEUE_INVALID` | `packages/cli/src/commands/review.ts:47` | throw new CliError('ATM_REVIEW_QUEUE_INVALID', 'Human review queue is invalid.', { |
| `ATM_REVIEW_QUEUE_MISSING` | `packages/cli/src/commands/review.ts:39` | throw new CliError('ATM_REVIEW_QUEUE_MISSING', 'Human review queue not found. Generate upgrade proposals first.', { |
| `ATM_REVIEW_RECORD_INVALID` | `packages/cli/src/commands/review.ts:98` | throw new CliError('ATM_REVIEW_RECORD_INVALID', 'Proposal queue record is invalid.', { |
| `ATM_REVIEW_REJECTED` | `packages/cli/src/commands/review.ts:165` | message('info', decision === 'approve' ? 'ATM_REVIEW_APPROVED' : 'ATM_REVIEW_REJECTED', &#96;Recorded ${decision} decision for ${queueRecord.proposalId}.&#96;, { |
| `ATM_REVIEW_SHOW_OK` | `packages/cli/src/commands/review.ts:75` | messages: [message('info', 'ATM_REVIEW_SHOW_OK', &#96;Loaded review proposal ${proposalId}.&#96;)], |
| `ATM_ROLLBACK_APPLIED` | `packages/cli/src/commands/rollback.ts:120` | messages: [message('info', 'ATM_ROLLBACK_APPLIED', &#96;Rollback applied for ${options.targetKind} target.&#96;)], |
| `ATM_ROLLBACK_HARD_FAIL` | `packages/cli/src/commands/rollback.ts:61` | throw new CliError('ATM_ROLLBACK_HARD_FAIL', 'Rollback hard-failed. Generated rollback-proof.failure.json.', { |
| `ATM_ROLLBACK_PLAN_READY` | `packages/cli/src/commands/rollback.ts:39` | messages: [message('info', 'ATM_ROLLBACK_PLAN_READY', &#96;Rollback plan prepared for ${options.targetKind} target.&#96;)], |
| `ATM_SCHEMA_DOCUMENT_NOT_FOUND` | `packages/core/src/police/schema-validator.ts:32` | return createFileFailure('ATM_SCHEMA_DOCUMENT_NOT_FOUND', resolvedDocumentPath, 'JSON document was not found.'); |
| `ATM_SCHEMA_INVALID` | `packages/core/src/police/schema-validator.ts:61` | code: 'ATM_SCHEMA_INVALID', |
| `ATM_SCHEMA_NOT_FOUND` | `packages/core/src/police/schema-validator.ts:35` | return createFileFailure('ATM_SCHEMA_NOT_FOUND', resolvedSchemaPath, 'JSON schema was not found.'); |
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
| `ATM_SPEC_NOT_FOUND` | `packages/cli/src/commands/validate.ts:74` | messages: [message('error', 'ATM_SPEC_NOT_FOUND', 'Atomic spec file was not found.', { specPath })], |
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
| `ATM_STATUS_READY` | `packages/cli/src/commands/status.ts:78` | ? message('info', 'ATM_STATUS_READY', 'ATM standalone config is ready.') |
| `ATM_STATUS_REGISTRY_OK` | `packages/cli/src/commands/status.ts:14` | successCode: 'ATM_STATUS_REGISTRY_OK', |
| `ATM_TEMP_ROOT` | `scripts/temp-root.ts:28` | const explicitRoot = process.env.ATM_TEMP_ROOT; |
| `ATM_TEST_HELLO_WORLD_FAILED` | `packages/cli/src/commands/test.ts:70` | : message('error', 'ATM_TEST_HELLO_WORLD_FAILED', 'hello-world atom smoke validation failed.', { checks: smoke.checks }) |
| `ATM_TEST_HELLO_WORLD_OK` | `packages/cli/src/commands/test.ts:69` | ? message('info', 'ATM_TEST_HELLO_WORLD_OK', 'hello-world atom smoke validation passed.') |
| `ATM_TEST_MAP_FAILED` | `packages/cli/src/commands/test.ts:92` | : message('error', 'ATM_TEST_MAP_FAILED', 'Atomic map integration test failed.', { mapId, failedDownstream: testRun.report.failedDownstream }) |
| `ATM_TEST_MAP_OK` | `packages/cli/src/commands/test.ts:91` | ? message('info', 'ATM_TEST_MAP_OK', 'Atomic map integration test passed.', { mapId }) |
| `ATM_TEST_PROPAGATE_FAILED` | `packages/cli/src/commands/test.ts:111` | const infoCode = propagation.ok ? 'ATM_TEST_PROPAGATE_OK' : 'ATM_TEST_PROPAGATE_FAILED'; |
| `ATM_TEST_PROPAGATE_OK` | `packages/cli/src/commands/test.ts:111` | const infoCode = propagation.ok ? 'ATM_TEST_PROPAGATE_OK' : 'ATM_TEST_PROPAGATE_FAILED'; |
| `ATM_TEST_REPORT_INVALID` | `packages/core/src/manager/test-runner.ts:187` | return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_INVALID', (validate.errors \&#124;\&#124; []).map((error: any) =&gt; ({ |
| `ATM_TEST_REPORT_OK` | `packages/core/src/manager/test-runner.ts:200` | code: 'ATM_TEST_REPORT_OK', |
| `ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE` | `packages/core/src/manager/test-runner.ts:172` | return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE', [ |
| `ATM_TEST_SPEC_FAILED` | `packages/cli/src/commands/test.ts:174` | : message('error', 'ATM_TEST_SPEC_FAILED', 'Atomic spec validation commands failed.', { atomId: testRun.atomId }) |
| `ATM_TEST_SPEC_OK` | `packages/cli/src/commands/test.ts:173` | ? message('info', 'ATM_TEST_SPEC_OK', 'Atomic spec validation commands passed.', { atomId: testRun.atomId }) |
| `ATM_UPGRADE_CONTEXT_POLICY_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:393` | return readJsonFile(policyPath, 'ATM_UPGRADE_CONTEXT_POLICY_NOT_FOUND'); |
| `ATM_UPGRADE_INPUT_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:218` | document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND') |
| `ATM_UPGRADE_INPUTS_NOT_FOUND` | `packages/cli/src/commands/upgrade.ts:226` | throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/history/reports.', { |
| `ATM_UPGRADE_PROPOSAL_BLOCKED` | `packages/cli/src/commands/upgrade.ts:53` | ? message('warning', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'Upgrade proposal blocked by automated gates.', { |
| `ATM_UPGRADE_PROPOSAL_READY` | `packages/cli/src/commands/upgrade.ts:57` | : message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Upgrade proposal prepared and ready for review.', { |
| `ATM_UPGRADE_STORE_MISSING` | `packages/cli/src/commands/upgrade.ts:327` | throw new CliError('ATM_UPGRADE_STORE_MISSING', 'Required governance stores are not available for upgrade hard-stop persistence.'); |
| `ATM_URN_INVALID` | `packages/core/src/registry/urn.ts:49` | throw new AtmUrnError('ATM_URN_INVALID', 'ATM URN must match urn:atm:&lt;nodeKind&gt;:&lt;canonicalId&gt;[@&lt;semver&gt;].', { value }); |
| `ATM_VALIDATE_REPOSITORY_OK` | `packages/cli/src/commands/validate.ts:51` | messages.push(message('info', 'ATM_VALIDATE_REPOSITORY_OK', 'ATM repository config validated in standalone mode.')); |
| `ATM_VALIDATE_SPEC_OK` | `packages/cli/src/commands/spec-shared.ts:13` | const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK'; |
| `ATM_VERIFY_AGENTS_MD_FAILED` | `packages/cli/src/commands/verify.ts:94` | : message('error', 'ATM_VERIFY_AGENTS_MD_FAILED', 'AGENTS bootstrap instructions are missing required markers or contain vendor-specific guidance.', { issues: verification.issues, mode: verification.mode }) |
| `ATM_VERIFY_AGENTS_MD_OK` | `packages/cli/src/commands/verify.ts:93` | ? message('info', 'ATM_VERIFY_AGENTS_MD_OK', 'AGENTS bootstrap instructions are vendor-neutral and complete.', { mode: verification.mode }) |
| `ATM_VERIFY_NEUTRALITY_FAILED` | `packages/cli/src/commands/verify.ts:65` | : [message('error', 'ATM_VERIFY_NEUTRALITY_FAILED', 'Neutrality scan found adopter-specific references in protected framework surfaces.', { violations: report.totals.violations })]; |
| `ATM_VERIFY_NEUTRALITY_OK` | `packages/cli/src/commands/verify.ts:64` | ? [message('info', 'ATM_VERIFY_NEUTRALITY_OK', 'Neutrality scan passed across protected framework surfaces.', { scannedFiles: report.totals.scannedFiles })] |
| `ATM_VERIFY_REGISTRY_OK` | `packages/cli/src/commands/registry-shared.ts:86` | const successCode = options.successCode ?? 'ATM_VERIFY_REGISTRY_OK'; |
| `ATM_VERIFY_REGISTRY_SCHEMA_OK` | `packages/cli/src/commands/verify.ts:27` | successCode: 'ATM_VERIFY_REGISTRY_SCHEMA_OK', |
| `ATM_VERIFY_SELF_DRIFT` | `packages/cli/src/commands/verify.ts:40` | : message('error', 'ATM_VERIFY_SELF_DRIFT', 'Seed self-verification detected registry drift.', { issues: verification.issues }) |
| `ATM_VERIFY_SELF_OK` | `packages/cli/src/commands/verify.ts:39` | ? message('info', 'ATM_VERIFY_SELF_OK', 'Seed self-verification hashes match the committed registry entry.') |
| `ATM_VERSION_INVALID` | `packages/core/src/registry/urn.ts:127` | throw new AtmUrnError('ATM_VERSION_INVALID', 'ATM URN version must be a semver string.', { version: value }); |
