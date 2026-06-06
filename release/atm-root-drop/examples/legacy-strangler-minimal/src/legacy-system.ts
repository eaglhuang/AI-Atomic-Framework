export function buildGreetingRecord(name: any) {
  return {
    greeting: `Welcome back, ${name}.`,
    source: 'legacy-system'
  };
}