export function buildReleaseHygieneOperatorHint() {
    return [
        'Ordinary validators should prefer `npm run build:packages` so release mirrors stay clean.',
        'Use `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` only when intentionally publishing runner-sync release outputs.',
        'After accidental `npm run build`, run `node --strip-types scripts/build-release-hygiene.ts --mode cleanup`; do not use raw `git restore` unless a governed destructive-override lease has been granted.'
    ].join(' ');
}
