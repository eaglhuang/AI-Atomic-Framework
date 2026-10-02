import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// OSV Scanner computes groups[].max_severity from CVSS vectors. Reuse that
// score; do not maintain a second CVSS implementation here.
export function assessOsvSeverity(payload: any) {
  if (!payload || !Array.isArray(payload.results)) throw new Error('OSV results array is required');
  const blocking: string[] = [], inconclusive: string[] = [];
  const numeric = (value: unknown): number | null => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
    const score = Number(value);
    return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
  };
  for (const result of payload.results) {
    if (!Array.isArray(result.packages)) throw new Error('OSV packages array is required');
    for (const pkg of result.packages) {
      if (!Array.isArray(pkg.vulnerabilities)) throw new Error('OSV vulnerabilities array is required');
      const scores = new Map<string, number>();
      for (const group of pkg.groups ?? []) {
        const score = numeric(group.max_severity);
        if (score === null) continue;
        for (const id of group.ids ?? []) scores.set(id, Math.max(score, scores.get(id) ?? 0));
      }
      for (const vuln of pkg.vulnerabilities) {
        const key = `${pkg.package?.name ?? 'unknown'}: ${vuln.id ?? 'unknown'}`;
        const raw = [vuln.database_specific?.severity, vuln.ecosystem_specific?.severity, vuln.severityText, ...(Array.isArray(vuln.severity) ? vuln.severity : [vuln.severity])];
        const labels = raw.filter(value => typeof value === 'string').map(value => value.toUpperCase());
        const numbers = raw.map(value => numeric(value && typeof value === 'object' ? value.score : value)).filter((value): value is number => value !== null);
        const groupScore = scores.get(vuln.id);
        if (groupScore !== undefined) numbers.push(groupScore);
        if (labels.some(value => value === 'HIGH' || value === 'CRITICAL') || numbers.some(value => value >= 7)) blocking.push(key);
        else if (!numbers.length && !labels.some(value => ['LOW', 'MODERATE', 'MEDIUM', 'NONE', 'NEGLIGIBLE'].includes(value))) inconclusive.push(key);
      }
    }
  }
  return { blocking, inconclusive, exitCode: blocking.length ? 1 : inconclusive.length ? 2 : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = assessOsvSeverity(JSON.parse(readFileSync(process.argv[2] ?? 'osv-results.json', 'utf8')));
    console.log(JSON.stringify(report));
    process.exitCode = report.exitCode;
  } catch (error) {
    console.error(`OSV assessment incomplete: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
