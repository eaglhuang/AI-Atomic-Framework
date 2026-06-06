import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'create-map',
  summary: 'Create and register an atomic map through the provisioning facade.',
  options: [
    commonCwdOption,
    { flag: '--map-version', value: 'semver', summary: 'Map version, defaults to 0.1.0.' },
    { flag: '--spec', value: 'path', summary: 'Create from an existing atm.atomicMap document instead of inline JSON members/entrypoints/quality-targets input.' },
    { flag: '--from-plan', value: 'path', summary: 'Create from an atm.decompositionPlan document.' },
    { flag: '--members', value: 'json', summary: 'JSON member list.' },
    { flag: '--edges', value: 'json', summary: 'JSON dependency edge list.' },
    { flag: '--entrypoints', value: 'json', summary: 'JSON entrypoint list.' },
    { flag: '--quality-targets', value: 'json', summary: 'JSON quality targets object.' },
    { flag: '--dry-run', summary: 'Preview generated paths and IDs without writing files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs create-map --members "[{\\"atomId\\":\\"ATM-CORE-0001\\",\\"version\\":\\"1.0.0\\"}]" --entrypoints "[\\"ATM-CORE-0001\\"]" --quality-targets "{\\"latency\\":\\"p95<100ms\\"}" --dry-run',
    'node atm.mjs create-map --spec samples/checkout-mini.map.json --json',
    'node atm.mjs create-map --from-plan samples/checkout-mini.plan.json --json'
  ]
});
