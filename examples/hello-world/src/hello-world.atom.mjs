export function run(input = {}) {
  const name = typeof input.name === 'string' && input.name.length > 0
    ? input.name
    : 'world';
  return {
    message: `Hello, ${name}!`,
    atomId: 'ATM-EXAMPLE-0001'
  };
}