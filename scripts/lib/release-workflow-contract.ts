/** Bounded contract for the repository's named release steps, not a YAML parser. */
export function releaseCompatibilityGateIsRequired(workflow: string): boolean {
  const steps = workflow.split(/^\s+- name: /m);
  const setup = steps.findIndex((step) => step.startsWith('Set npm package versions from tag'));
  const gate = steps.findIndex((step) => step.startsWith('Validate release version compatibility'));
  const publish = steps.findIndex((step) => step.startsWith('Publish public workspace closure'));
  if (setup < 0 || gate <= setup || publish <= gate) return false;
  const gateStep = steps[gate];
  return steps[setup].includes('echo "ATM_RELEASE_TAG=v$version" >> "$GITHUB_ENV"')
    && gateStep.includes('scripts/validate-version-compatibility.ts --mode validate --release-tag "$ATM_RELEASE_TAG"')
    && !/^\s*(?:if|continue-on-error):/m.test(gateStep)
    && !/\|\|\s*(?:true|:)/.test(gateStep);
}
