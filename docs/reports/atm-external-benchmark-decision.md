# ATM external benchmark decision

- Verdict: **inconclusive**
- Product Proof status: **not established — execution packet prepared**
- Public ATM arm: `@ai-atomic-framework/cli@0.1.0-beta.4`
- Public tarball SHA-256: `sha256:6b1affb435479a7bf62e0d69d504f979b2f490680273692ad747ec766f460424`
- Verifier source commit: `0af98a1b3604cc6cdcf388013236f63d4b0aca17`

No benchmark result is recorded in this report. No synthetic timing, workspace-linked
ATM code, inferred provider cost, or self-adjudication is accepted as product proof.

## Sealed workload

The protocol is [`scripts/fixtures/atm-external-benchmark/manifest.json`](../../scripts/fixtures/atm-external-benchmark/manifest.json).
It pins p-map at `bc26cf03f81292325236a1188063dac8e7a4de0f` and Fastify at
`1beaf7e72d24b2fc63a02a7f5806772a00e45454`, requires AB and BA sequences, and
requires the positive-conflict, benign-concurrency, semantic-conflict, stale-base,
recovery, and negative controls.

The ATM arm must install the exact npm tarball above in a clean worktree. `npm link`,
`file:`, `workspace:`, and a framework checkout are not valid ATM-arm inputs.

## Required external packet

Use four separate files, plus the raw run and adjudication arrays:

| File | Required signer role | Required binding |
| --- | --- | --- |
| `hidden-corpus-acceptance.json` | `hidden-corpus-custodian` | `corpusId`, `corpusDigest`, `visibility: "oracle-only"`, `acceptedAt` |
| `independent-adjudication.json` | `independent-adjudicator` | custodian identity, raw-run `inputDigest`, adjudication `outputDigest`, `labeledAt` |
| `provider-telemetry.json` | `provider-telemetry` | provider, original-export SHA-256, observation time, each runId exactly once |
| `provider-raw-export.ndjson` | n/a | original provider/API export; its SHA-256 must equal `rawExportSha256` |

Every signed JSON artifact must also contain `schemaId`, `protocolVersion`,
`protocolDigest`, `signerId`, `publicKeyPem`, and an Ed25519 `signature`. The
signature is over canonical JSON with `publicKeyPem` and `signature` excluded. The
three signer identities and their public keys must be distinct. The custodian signer
and adjudicator signer must exactly match the roles preregistered in the protocol.

The verifier supplies the exact deterministic signing payload; do not reproduce the
key-sorting rule by hand:

```text
node --strip-types scripts/run-atm-external-benchmark.ts \
  --print-signing-payload <unsigned-artifact.json> > payload.json
node --strip-types scripts/run-atm-external-benchmark.ts \
  --print-canonical-digest <signed-artifact.json>
```

The independent-adjudication manifest's `inputDigest` is the canonical SHA-256 of
the supplied raw-run array; its `outputDigest` is the canonical SHA-256 of the
supplied adjudication array. Each raw run requires exactly one adjudication with the
same `runId` and arm, and with the preregistered custodian, adjudicator, and arm
implementer identities.

## Neutral-steward sealing sequence

1. Custodian, adjudicator, provider-telemetry signer, baseline operator, and ATM
   operator remain distinct. Labels/conflict graph remain oracle-only until the runs
   have been produced.
2. Operators produce real AB and BA runs in fresh worktrees. Each raw record retains
   timestamps, prompt, tokens, billed cost, human minutes, retries, commands,
   repairs, repository SHA, and environment digest.
3. The adjudicator labels anonymized output and signs the manifest after the raw run
   array is fixed. The telemetry signer supplies the unmodified provider export.
4. A neutral steward computes each canonical artifact digest, updates only the three
   mutable `executionPrerequisites.*` seals and `runEligibility` in the protocol,
   then re-runs `validate-external-benchmark-protocol`. These mutable seals are
   deliberately excluded from `preregistrationDigest`; thresholds and workload are
   not editable at this stage.
5. Run the verifier from commit `0af98a1b3604cc6cdcf388013236f63d4b0aca17`:

```text
node --strip-types scripts/run-atm-external-benchmark.ts \
  --protocol <sealed-protocol.json> \
  --raw-runs <raw-runs.json> \
  --adjudications <adjudications.json> \
  --hidden-corpus-acceptance <hidden-corpus-acceptance.json> \
  --independent-adjudication <independent-adjudication.json> \
  --provider-telemetry <provider-telemetry.json> \
  --provider-raw-export <provider-raw-export.ndjson> \
  --output docs/reports/atm-external-benchmark-decision.md
```

The only possible final verdicts are `keep`, `narrow`, `stop`, or `inconclusive`.
`keep` requires safety non-inferiority, no worse false-block rate, and at least 20%
raw billed-cost improvement. Missing or non-original cost data remains
`inconclusive`; adverse safety is `stop` and must name the smallest optional
capability before any narrow retest.
