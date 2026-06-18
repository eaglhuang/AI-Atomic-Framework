export function buildReleaseHygieneOperatorHint(): string {
  return [
    'Ordinary validators should prefer `npm run build:packages` so release mirrors stay clean.',
    'Use `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` only when intentionally publishing runner-sync release outputs.',
    'After accidental `npm run build`, run `node --strip-types scripts/build-release-hygiene.ts --mode cleanup` or `git restore -- release/atm-onefile/atm.mjs release/atm-onefile/release-manifest.json release/atm-root-drop/release-manifest.json`.'
  ].join(' ');
}
