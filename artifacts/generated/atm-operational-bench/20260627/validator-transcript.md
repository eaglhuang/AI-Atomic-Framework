# ATM OperationalBench 20260627 Validator Transcript

## bench:operational:paper -- --seed 20260627

```text

> ai-atomic-framework@0.1.0 bench:operational:paper
> node --strip-types scripts/run-atm-operational-bench.ts --profile paper --seed 20260627

{
  "bench": "ATM OperationalBench",
  "profile": "paper",
  "seed": 20260627,
  "outDir": "artifacts/generated/atm-operational-bench/20260627",
  "scenarioCount": 14,
  "resultRows": 5600,
  "recoveryMetrics": {
    "preservedIntentSalvageRate": 1,
    "terminalFailClosedRate": 0.1,
    "overSerializationRate": 0,
    "fullRegenerationRate": null,
    "fullRegenerationNote": "not observed by this harness"
  }
}
EXIT_CODE=0
```

## validate:operational-bench

```text

> ai-atomic-framework@0.1.0 validate:operational-bench
> node --strip-types scripts/validate-operational-bench.ts --mode validate

[operational-bench:validate] ok (OperationalBench v0.1 contract and 20260627 evidence artifacts validated)
EXIT_CODE=0
```

## validate:team-brokered-write

```text

> ai-atomic-framework@0.1.0 validate:team-brokered-write
> node --strip-types scripts/validate-team-brokered-write.ts --mode validate

[team-brokered-write:validate] ok
EXIT_CODE=0
```

## validate:broker-steward

```text

> ai-atomic-framework@0.1.0 validate:broker-steward
> node --strip-types scripts/validate-broker-steward.ts --mode validate

[broker-steward:validate] ok
EXIT_CODE=0
```

## validate:schemas

```text

> ai-atomic-framework@0.1.0 validate:schemas
> node --strip-types scripts/validate-schemas.ts --mode validate

[schema:validate] ok (64 schemas, 58 positive fixtures, 26 negative fixtures)
EXIT_CODE=0
```

## typecheck

```text

> ai-atomic-framework@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit

EXIT_CODE=0
```

## git diff --check

```text
EXIT_CODE=0
```

## validate:operational-bench after transcript/hash closure

```text

> ai-atomic-framework@0.1.0 validate:operational-bench
> node --strip-types scripts/validate-operational-bench.ts --mode validate

[operational-bench:validate] ok (OperationalBench v0.1 contract and 20260627 evidence artifacts validated)
EXIT_CODE=0
```

