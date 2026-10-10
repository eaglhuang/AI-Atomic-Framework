// Hidden oracle: lives outside the agent worktree, copied in only after agents finish.
// Usage: node check.mjs <feature...>   prints {feature: bool} and exits 0 iff all pass.
const expected = {
  mul: (m) => m.mul(2, 3) === 6,
  div: (m) => m.div(6, 3) === 2,
  neg: (m) => m.neg(2) === -2,
};
const features = process.argv.slice(2);
const result = {};
let mods = {};
try {
  const math = await import('../src/math.js');
  const util = await import('../src/util.js');
  mods = { ...math, ...util };
} catch {
  mods = {};
}
for (const f of features) {
  let ok = false;
  try { ok = typeof mods[f] === 'function' && expected[f](mods); } catch { ok = false; }
  result[f] = ok;
}
console.log(JSON.stringify(result));
process.exit(Object.values(result).every(Boolean) ? 0 : 1);
