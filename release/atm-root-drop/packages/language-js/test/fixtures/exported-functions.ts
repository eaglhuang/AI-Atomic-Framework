export function loadRows(limit: number): string[] {
  const rows: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    rows.push(`row-${index}`);
  }
  return rows;
}

export async function fetchRows(url: string): Promise<string[]> {
  const response = await Promise.resolve(url);
  return [response];
}

export default function main(): void {
  loadRows(3);
}
