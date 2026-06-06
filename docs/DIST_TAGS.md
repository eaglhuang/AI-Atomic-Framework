# npm Dist-Tag Policy

ATM publishes npm packages with explicit dist-tags. The tag is part of the release contract because downstream agents often install through `npx create-atm` or an npm tag instead of a pinned version.

## Tag Table

| npm dist-tag | Release tier | Version shape | Intended audience | Promotion rule |
| --- | --- | --- | --- | --- |
| `latest` | stable | `x.y.z` | default adopters | only stable releases; never alpha or beta prereleases |
| `next` | beta | `x.y.z-beta.n` | early adopters validating the next stable line | may promote to `latest` only after a stable release is cut |
| `beta` | experimental | `x.y.z-alpha.n` | framework contributors and experimental adopters | must not promote directly to `latest` |
| `lts` | lts | `x.y.z` or `x.y.z-lts.n` | long-term support adopters | may also be compatible with `latest`, but must be published with the `lts` tag when the release tier is lts |

## create-atm Defaults

`create-atm` defaults to `latest`.

Users can request another channel explicitly:

```bash
npx create-atm my-app --tag next
npx create-atm my-app --tag beta
npx create-atm my-app --tag lts
```

The selected tag is recorded in `.atm/runtime/dist-tag.json` so `atm welcome` can show the tag and tier used during first-touch onboarding.

## Release Workflow Rule

The release workflow resolves `NPM_DIST_TAG` before publishing any package:

- `x.y.z` with tier `auto` or `stable` -> `latest`
- `x.y.z-beta.n` -> `next`
- `x.y.z-alpha.n` -> `beta`
- `x.y.z-lts.n` or tier `lts` -> `lts`

The workflow must pass `--tag "$NPM_DIST_TAG"` to every `npm publish` command. A beta or alpha prerelease must fail validation if it would publish as `latest`.
