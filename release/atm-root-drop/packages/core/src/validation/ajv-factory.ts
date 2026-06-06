/**
 * Shared AJV factory for runtime code that needs JSON Schema validation.
 *
 * Use `createAtmAjv()` instead of `new Ajv2020({...})` so the framework's AJV
 * configuration (allErrors + non-strict + formats) stays consistent across:
 *
 *  - validator scripts (via `scripts/lib/validator-harness.ts:createAjv`)
 *  - runtime CLI code (via this factory)
 *  - tests that need an AJV instance
 *
 * The factory does not cache compiled validators — caller code is responsible
 * for caching `ajv.compile(schema)` results when the same schema is reused in
 * a hot path. The `createSchemaValidator(schema)` helper below is the cached
 * one-liner for the common "compile once, validate many" pattern.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * Construct a fresh AJV 2020 instance with the framework's standard config.
 * Each call returns a new instance — callers MAY share instances across
 * compilations but MUST NOT mutate the options.
 */
export function createAtmAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/**
 * Compile a schema with a fresh AJV and return a typed predicate. The AJV
 * instance is held in the closure so the compiled validator stays cached for
 * the lifetime of the returned function — call this once per schema, then
 * reuse the predicate.
 */
export function createSchemaValidator<T = unknown>(schema: object): (value: unknown) => value is T {
  const ajv = createAtmAjv();
  const compiled = ajv.compile(schema);
  return (value: unknown): value is T => compiled(value) as boolean;
}
