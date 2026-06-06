import ts from 'typescript';
import { createValidator } from './lib/validator-harness.ts';

const validator = createValidator('type-schema-sync');
const { assert, readJson, readText, ok } = validator;

type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: string[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

const coreSource = ts.createSourceFile('index.ts', readText('packages/core/src/index.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const rollbackSource = ts.createSourceFile('rollback-types.ts', readText('packages/core/src/registry/rollback-types.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const registrySchema = readJson<JsonSchema>('schemas/registry.schema.json');
const evidenceSchema = readJson<JsonSchema>('schemas/governance/evidence.schema.json');
const governanceBundleSchema = readJson<JsonSchema>('schemas/governance/governance-bundle.schema.json');
const rollbackSchema = readJson<JsonSchema>('schemas/registry/rollback-proof.schema.json');
const testReportSchema = readJson<JsonSchema>('schemas/test-report.schema.json');
const typeAliases = new Map<string, ts.TypeAliasDeclaration>();

for (const sourceFile of [coreSource, rollbackSource]) {
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      typeAliases.set(statement.name.text, statement);
    }
  }
}

function findStatement<T extends ts.Statement>(
  sourceFile: ts.SourceFile,
  predicate: (statement: ts.Statement) => statement is T
): T {
  const match = sourceFile.statements.find(predicate);
  assert(Boolean(match), `expected TypeScript declaration is missing in ${sourceFile.fileName}`);
  return match as T;
}

function findTypeAlias(sourceFile: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  return findStatement(sourceFile, (statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name
  );
}

function findInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  return findStatement(sourceFile, (statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === name
  );
}

function getStringUnionValues(typeNode: ts.TypeNode | undefined): string[] {
  assert(Boolean(typeNode), 'expected type node');
  if (typeNode && ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const alias = typeAliases.get(typeNode.typeName.text);
    assert(Boolean(alias), `missing type alias for ${typeNode.typeName.text}`);
    return getStringUnionValues(alias?.type);
  }
  if (typeNode && ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .filter(ts.isLiteralTypeNode)
      .map((literal) => literal.literal)
      .filter(ts.isStringLiteral)
      .map((literal) => literal.text);
  }
  if (typeNode && ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }
  failTypeNode(typeNode);
  return [];
}

function failTypeNode(typeNode: ts.TypeNode | undefined): never {
  throw new Error(`Unsupported type node for union extraction: ${typeNode?.getText() ?? '<missing>'}`);
}

function getInterfaceRequiredProperties(interfaceNode: ts.InterfaceDeclaration): string[] {
  return interfaceNode.members
    .filter(ts.isPropertySignature)
    .flatMap((member) => {
      if (member.questionToken || !member.name || !ts.isIdentifier(member.name)) {
        return [];
      }
      return [member.name.text];
    });
}

function getInterfaceProperty(interfaceNode: ts.InterfaceDeclaration, propertyName: string): ts.PropertySignature {
  const match = interfaceNode.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) &&
      Boolean(member.name) &&
      ts.isIdentifier(member.name) &&
      member.name.text === propertyName
  );
  assert(Boolean(match), `${interfaceNode.name.text}.${propertyName} is missing`);
  return match as ts.PropertySignature;
}

function assertArrayEquals(actual: string[], expected: string[], label: string): void {
  assert(
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()),
    `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const registryEntryStatus = getStringUnionValues(findTypeAlias(coreSource, 'RegistryEntryStatus').type);
const registryGovernanceTier = getStringUnionValues(findTypeAlias(coreSource, 'RegistryGovernanceTier').type);
const evidenceSignalKind = getStringUnionValues(findTypeAlias(coreSource, 'EvidenceSignalKind').type);
const evidenceSignalScope = getStringUnionValues(findTypeAlias(coreSource, 'EvidenceSignalScope').type);
const evidenceType = getStringUnionValues(getInterfaceProperty(findInterface(coreSource, 'EvidenceRecord'), 'evidenceType').type);
const rollbackVerificationStatus = getStringUnionValues(getInterfaceProperty(findInterface(rollbackSource, 'RollbackProof'), 'verificationStatus').type);
const rollbackTargetKind = getStringUnionValues(getInterfaceProperty(findInterface(rollbackSource, 'RollbackProof'), 'targetKind').type);

function assertEvidenceEvolutionFields(schemaNode: JsonSchema | undefined, label: string): void {
  const properties = schemaNode?.properties ?? {};
  for (const propertyName of ['signalKind', 'signalScope', 'atomId', 'atomMapId', 'patternTags', 'confidence', 'recurrence']) {
    assert(Boolean(properties[propertyName]), `${label} missing optional evolution field: ${propertyName}`);
  }
  assertArrayEquals(
    evidenceSignalKind,
    properties.signalKind?.enum ?? [],
    `${label}.signalKind enum vs EvidenceSignalKind`
  );
  assertArrayEquals(
    evidenceSignalScope,
    properties.signalScope?.enum ?? [],
    `${label}.signalScope enum vs EvidenceSignalScope`
  );
  const recurrence = properties.recurrence;
  const recurrenceProperties = recurrence?.properties ?? (
    recurrence?.$ref === '#/$defs/recurrence'
      ? schemaNode?.$defs?.recurrence?.properties
      : undefined
  ) ?? {};
  assert(Boolean(recurrenceProperties.window), `${label}.recurrence missing window`);
  assert(Boolean(recurrenceProperties.count), `${label}.recurrence missing count`);
}

assertArrayEquals(
  registryEntryStatus,
  registrySchema.$defs?.registryEntry?.properties?.status?.enum ?? [],
  'RegistryEntryStatus vs registry schema enum'
);
assertArrayEquals(
  registryGovernanceTier,
  registrySchema.$defs?.registryEntry?.properties?.governance?.properties?.tier?.enum ?? [],
  'RegistryGovernanceTier vs registry schema enum'
);
assertArrayEquals(
  evidenceType,
  evidenceSchema.properties?.evidenceType?.enum ?? [],
  'EvidenceRecord.evidenceType vs evidence schema enum'
);
assertEvidenceEvolutionFields(evidenceSchema, 'governance evidence schema');
assertEvidenceEvolutionFields(governanceBundleSchema.$defs?.evidenceRecord, 'governance bundle embedded evidence schema');
assertEvidenceEvolutionFields(testReportSchema.$defs?.evidenceRecord, 'test report embedded evidence schema');
assertArrayEquals(
  rollbackVerificationStatus,
  rollbackSchema.properties?.verificationStatus?.enum ?? [],
  'RollbackProof.verificationStatus vs rollback schema enum'
);
assertArrayEquals(
  rollbackTargetKind,
  rollbackSchema.properties?.targetKind?.enum ?? [],
  'RollbackProof.targetKind vs rollback schema enum'
);

const registryDocumentRequired = getInterfaceRequiredProperties(findInterface(coreSource, 'RegistryDocument'));
const registryEntryRequired = getInterfaceRequiredProperties(findInterface(coreSource, 'RegistryEntryRecord'));
const testReportRequired = getInterfaceRequiredProperties(findInterface(coreSource, 'TestReportDocument'));
const rollbackProofRequired = getInterfaceRequiredProperties(findInterface(rollbackSource, 'RollbackProof'));

assertArrayEquals(
  registryDocumentRequired,
  registrySchema.required ?? [],
  'RegistryDocument required properties vs registry schema'
);
assertArrayEquals(
  registryEntryRequired,
  registrySchema.$defs?.registryEntry?.required ?? [],
  'RegistryEntryRecord required properties vs registry schema'
);
assertArrayEquals(
  testReportRequired,
  testReportSchema.required ?? [],
  'TestReportDocument required properties vs test-report schema'
);
assertArrayEquals(
  rollbackProofRequired,
  rollbackSchema.required ?? [],
  'RollbackProof required properties vs rollback-proof schema'
);

ok('registry, evidence, rollback, and test-report contracts are synchronized');
