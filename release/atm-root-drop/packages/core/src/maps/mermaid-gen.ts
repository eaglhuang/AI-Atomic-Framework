import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface MermaidGenResult {
  mapId: string;
  mermaidSource: string;
  nodeCount: number;
  edgeCount: number;
  generatedAt: string;
}

export function generateMermaidFromMapSpec(
  repositoryRoot: string,
  mapId: string
): MermaidGenResult {
  const mapSpecPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');

  if (!existsSync(mapSpecPath)) {
    return {
      mapId,
      mermaidSource: `flowchart LR\n    %% map.spec.json not found for ${mapId}`,
      nodeCount: 0,
      edgeCount: 0,
      generatedAt: new Date().toISOString()
    };
  }

  const spec = JSON.parse(readFileSync(mapSpecPath, 'utf-8'));
  const members: Array<{ atomId?: string; id?: string; role?: string }> = spec.members ?? [];
  const edges: Array<{ from: string; to: string; binding: string; edgeKind?: string }> = spec.edges ?? [];
  const entrypoints: string[] = spec.entrypoints ?? [];
  const entrypointSet = new Set(entrypoints);

  const lines: string[] = ['flowchart LR'];

  // Add node definitions
  for (const member of members) {
    const nodeId = sanitizeId(member.atomId ?? member.id ?? 'unknown');
    const label = member.atomId ?? member.id ?? 'unknown';
    const role = member.role ? `\n${member.role}` : '';
    if (entrypointSet.has(label)) {
      lines.push(`    ${nodeId}(["${label}${role}"]):::entrypoint`);
    } else {
      lines.push(`    ${nodeId}["${label}${role}"]`);
    }
  }

  // Add edge definitions
  for (const edge of edges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    const label = edge.binding ? `|${edge.binding}|` : '';
    const arrowStyle = edge.edgeKind === 'control-flow' ? '-.->': '-->';
    lines.push(`    ${fromId} ${arrowStyle}${label} ${toId}`);
  }

  // Add styling
  if (entrypoints.length > 0) {
    lines.push('    classDef entrypoint fill:#f96,stroke:#333,stroke-width:2px');
  }

  return {
    mapId,
    mermaidSource: lines.join('\n'),
    nodeCount: members.length,
    edgeCount: edges.length,
    generatedAt: new Date().toISOString()
  };
}

function sanitizeId(id: string): string {
  // Replace non-alphanumeric characters with underscores for Mermaid compatibility
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
