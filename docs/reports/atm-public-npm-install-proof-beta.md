# Public npm install proof

- Status: **BLOCKED / INCONCLUSIVE**
- Package: `@ai-atomic-framework/cli@0.1.0-beta.5`
- Registry: https://registry.npmjs.org

```json
{
  "schemaId": "atm.publicNpmInstallProof.v1",
  "package": "@ai-atomic-framework/cli",
  "version": "0.1.0-beta.5",
  "registry": "https://registry.npmjs.org",
  "status": "blocked",
  "publicRegistry": false,
  "temporaryRootRemoved": true,
  "blockedReason": "npm registry metadata lookup failed or package/version is not published",
  "error": "Error: Command failed: npm.cmd view @ai-atomic-framework/cli@0.1.0-beta.5 version dist.tarball dist.integrity dist.unpackedSize dist.fileCount _id --json\nnpm error code E404\nnpm error 404 No match found for version 0.1.0-beta.5\nnpm error 404\nnpm error 404  The requested resource '@ai-atomic-framework/cli@0.1.0-beta.5' could not be found or you do not have permission to access it.\nnpm error 404\nnpm error 404 Note that you can also install from a\nnpm error 404 tarball, folder, http url, or git url.\nnpm error A complete log of this run can be found in: C:\\Users\\User\\AppData\\Local\\npm-cache\\_logs\\2026-09-11T23_54_19_622Z-debug-0.log\n"
}
```

## Published baseline check

`@ai-atomic-framework/cli@0.1.0-beta.4` is present in the public registry, but it
does not satisfy the slim-runtime artifact contract. The same validator reported:

```json
{
  "version": "0.1.0-beta.4",
  "status": "blocked",
  "blockedReason": "public clean-consumer install proof failed",
  "error": "public tarball exceeds artifact byte budget: 7599532/3365772 unpacked bytes"
}
```

This establishes the baseline: a published version exists, but the required
small-package proof still depends on publishing beta5 (or a later slim release).

## External release prerequisite

The release workflow already has an `NPM_TOKEN` secret, but the tag run
`34659077708` failed at the registry `PUT` with npm `E404` (permission denied).
The next operator action is external to this repository: replace that secret with
a token that can publish `@ai-atomic-framework/cli` (and satisfies the account's
2FA policy), or configure npm trusted publishing for this GitHub repository and
workflow. After that change, rerun the existing release workflow and regenerate
this proof against the newly published version; do not treat beta4 as a valid
slim-runtime substitute.
