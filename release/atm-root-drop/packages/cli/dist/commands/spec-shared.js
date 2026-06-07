import path from 'node:path';
import { createRequire } from 'node:module';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.js';
import { defaultAtomicSpecSchemaPath, parseAtomicSpecFile } from '../../../core/dist/spec/parse-spec.js';
const atomicSpecSchemaPath = defaultAtomicSpecSchemaPath;
const frameworkRoot = path.resolve(path.dirname(atomicSpecSchemaPath), '..');
const requireFromSpecShared = createRequire(import.meta.url);
const supportedReportSchemas = {
    'atm.atomicMap': 'schemas/registry/atomic-map.schema.json',
    'atm.mapEquivalenceReport': 'schemas/governance/map-equivalence-report.schema.json',
    'atm.polymorphImpactReport': 'schemas/governance/polymorph-impact-report.schema.json',
    'atm.propagationReport': 'schemas/governance/propagation-report.schema.json',
    'atm.retirementProof': 'schemas/governance/retirement-proof.schema.json',
    'atm.decompositionPlan': 'schemas/governance/decomposition-plan.schema.json'
};
const supportSchemaPaths = ['schemas/test-report/metrics.schema.json'];
export function validateAtomicSpecFileAgainstSchema(cwd, specOption, options = {}) {
    const commandName = options.commandName ?? 'validate';
    const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK';
    const successText = options.successText ?? 'Atomic spec validated against JSON Schema.';
    const specPath = path.resolve(cwd, specOption);
    const relativeSpecPath = relativePathFrom(cwd, specPath);
    const document = readJsonFile(specPath, 'ATM_SPEC_NOT_FOUND');
    if (supportedReportSchemas[document?.schemaId]) {
        return validateSupportedReportAgainstSchema(document, {
            commandName,
            cwd,
            schemaRelativePath: supportedReportSchemas[document.schemaId],
            specPath,
            relativeSpecPath,
            successCode,
            successText: document?.schemaId === 'atm.atomicMap'
                ? 'Atomic map validated against JSON Schema.'
                : 'Report validated against JSON Schema.'
        });
    }
    const parsed = parseAtomicSpecFile(specOption, { cwd, schemaPath: atomicSpecSchemaPath });
    const messages = parsed.ok
        ? [message('info', successCode, successText)]
        : (parsed.promptReport.issues.length > 0
            ? parsed.promptReport.issues.map((issue) => message('error', issue.code, issue.text, { path: issue.path, prompt: issue.prompt }))
            : [message('error', parsed.promptReport.code, parsed.promptReport.summary)]);
    return makeResult({
        ok: parsed.ok === true,
        command: commandName,
        cwd,
        messages,
        evidence: {
            specPath: relativeSpecPath,
            schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
            schemaId: parsed.ok ? parsed.normalizedModel.schema.schemaId : null,
            specVersion: parsed.ok ? parsed.normalizedModel.schema.specVersion : null,
            atomId: parsed.ok ? parsed.normalizedModel.identity.atomId : null,
            validated: parsed.ok ? [relativeSpecPath] : []
        }
    });
}
function validateSupportedReportAgainstSchema(document, options) {
    const { Ajv2020, addFormats } = loadJsonSchemaValidatorModules();
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const supportSchemaPath of supportSchemaPaths) {
        ajv.addSchema(readJsonFile(path.join(frameworkRoot, supportSchemaPath)));
    }
    const schemaPath = path.join(frameworkRoot, options.schemaRelativePath);
    const validate = ajv.compile(readJsonFile(schemaPath));
    const report = document;
    const ok = validate(document) === true;
    const messages = ok
        ? [message('info', options.successCode, options.successText)]
        : (validate.errors || []).map((error) => message('error', 'ATM_SCHEMA_VALIDATION_ERROR', `${error.instancePath || '/'} ${error.message}`, {
            path: error.instancePath || '/',
            keyword: error.keyword,
            params: error.params
        }));
    return makeResult({
        ok,
        command: options.commandName,
        cwd: options.cwd,
        messages,
        evidence: {
            specPath: options.relativeSpecPath,
            schemaPath: relativePathFrom(options.cwd, schemaPath),
            schemaId: ok ? report.schemaId : null,
            specVersion: ok ? report.specVersion : null,
            atomId: null,
            mapId: ok ? report.mapId ?? null : null,
            validated: ok ? [options.relativeSpecPath] : []
        }
    });
}
function loadJsonSchemaValidatorModules() {
    let ajvModule, formatsModule;
    try {
        ajvModule = requireFromSpecShared('ajv/dist/2020.js');
        formatsModule = requireFromSpecShared('ajv-formats');
    }
    catch {
        const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
        ajvModule = cwdRequire('ajv/dist/2020.js');
        formatsModule = cwdRequire('ajv-formats');
    }
    return {
        Ajv2020: ajvModule.default ?? ajvModule,
        addFormats: formatsModule.default ?? formatsModule
    };
}
