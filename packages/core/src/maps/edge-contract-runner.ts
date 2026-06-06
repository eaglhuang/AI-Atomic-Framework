import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface EdgeContractResult {
  edge: { from: string; to: string; binding: string };
  passed: boolean;
  reason: string;
  fromOutputSchema: unknown;
  toInputSchema: unknown;
}

export interface EdgeContractReport {
  schemaId: 'atm.edgeContractReport';
  mapId: string;
  checkedAt: string;
  totalEdges: number;
  passed: number;
  failed: number;
  results: EdgeContractResult[];
}

interface AtomSchemas {
  outputSchema?: unknown;
  inputSchema?: unknown;
}

export function runEdgeContractCheck(
  repositoryRoot: string,
  mapId: string
): EdgeContractReport {
  const mapSpecPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');

  if (!existsSync(mapSpecPath)) {
    return {
      schemaId: 'atm.edgeContractReport',
      mapId,
      checkedAt: new Date().toISOString(),
      totalEdges: 0,
      passed: 0,
      failed: 0,
      results: []
    };
  }

  const mapSpec = JSON.parse(readFileSync(mapSpecPath, 'utf-8'));
  const edges: Array<{ from: string; to: string; binding: string; edgeKind?: string }> =
    mapSpec.edges ?? [];

  const atomSchemaCache = new Map<string, AtomSchemas>();

  const results: EdgeContractResult[] = [];

  for (const edge of edges) {
    const fromSchemas = getAtomSchemas(repositoryRoot, mapId, edge.from, atomSchemaCache);
    const toSchemas = getAtomSchemas(repositoryRoot, mapId, edge.to, atomSchemaCache);

    const result = checkEdgeContract(edge, fromSchemas, toSchemas);
    results.push(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    schemaId: 'atm.edgeContractReport',
    mapId,
    checkedAt: new Date().toISOString(),
    totalEdges: edges.length,
    passed,
    failed,
    results
  };
}

function getAtomSchemas(
  repositoryRoot: string,
  mapId: string,
  atomId: string,
  cache: Map<string, AtomSchemas>
): AtomSchemas {
  if (cache.has(atomId)) return cache.get(atomId)!;

  const schemas: AtomSchemas = {};

  // Try to find atom spec in atomic_workbench
  const atomSpecPaths = [
    path.join(repositoryRoot, 'atomic_workbench', 'atoms', atomId, 'atom.spec.json'),
    path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'atoms', atomId, 'atom.spec.json')
  ];

  for (const specPath of atomSpecPaths) {
    if (existsSync(specPath)) {
      try {
        const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
        schemas.inputSchema = spec.inputSchema ?? spec.input ?? null;
        schemas.outputSchema = spec.outputSchema ?? spec.output ?? null;
        break;
      } catch {
        // continue
      }
    }
  }

  // Also check atomic-registry.json
  const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!schemas.inputSchema && existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const entry = registry.entries?.[atomId];
      if (entry) {
        schemas.inputSchema = entry.inputSchema ?? null;
        schemas.outputSchema = entry.outputSchema ?? null;
      }
    } catch {
      // ignore
    }
  }

  cache.set(atomId, schemas);
  return schemas;
}

function checkEdgeContract(
  edge: { from: string; to: string; binding: string; edgeKind?: string },
  fromSchemas: AtomSchemas,
  toSchemas: AtomSchemas
): EdgeContractResult {
  const result: EdgeContractResult = {
    edge: { from: edge.from, to: edge.to, binding: edge.binding },
    passed: true,
    reason: 'pass',
    fromOutputSchema: fromSchemas.outputSchema ?? null,
    toInputSchema: toSchemas.inputSchema ?? null
  };

  // Skip non-data-flow edges (they don't have schema contracts)
  if (edge.edgeKind && edge.edgeKind !== 'data-flow') {
    result.reason = `skipped — edgeKind=${edge.edgeKind} does not require schema contract`;
    return result;
  }

  // If either schema is missing, warn but don't fail (schemas might not be defined yet)
  if (!fromSchemas.outputSchema) {
    result.passed = true;
    result.reason = `advisory — no outputSchema defined for ${edge.from}`;
    return result;
  }

  if (!toSchemas.inputSchema) {
    result.passed = true;
    result.reason = `advisory — no inputSchema defined for ${edge.to}`;
    return result;
  }

  // Basic structural compatibility check
  const compatible = schemasCompatible(fromSchemas.outputSchema, toSchemas.inputSchema);
  if (!compatible) {
    result.passed = false;
    result.reason = `FAIL — outputSchema of ${edge.from} is not compatible with inputSchema of ${edge.to}`;
  } else {
    result.reason = `pass — schema contract satisfied for binding=${edge.binding}`;
  }

  return result;
}

function schemasCompatible(outputSchema: unknown, inputSchema: unknown): boolean {
  // Structural compatibility: check that required fields of inputSchema
  // are present in outputSchema's properties
  if (!outputSchema || !inputSchema) return true;

  const out = outputSchema as Record<string, unknown>;
  const inp = inputSchema as Record<string, unknown>;

  // If both have "type", they must match (basic check)
  if (out.type && inp.type && out.type !== inp.type) {
    return false;
  }

  // If input requires properties that output doesn't provide, fail
  const requiredFields: string[] = Array.isArray(inp.required) ? inp.required as string[] : [];
  const outProperties: Record<string, unknown> = (out.properties as Record<string, unknown>) ?? {};

  for (const field of requiredFields) {
    if (!(field in outProperties)) {
      return false;
    }
  }

  return true;
}
