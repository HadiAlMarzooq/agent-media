# Releasing

Agent Media has two distinct release channels:

1. a GitHub release bundle containing validated package tarballs and evidence; and
2. npm publication, which remains disabled until the owner makes the repository/publication decision.

Keeping those actions separate prevents a private release-candidate tag from silently publishing
packages to a public registry.

## Why earlier releases looked failed

Tags `v0.0.11` and `v0.0.12` were created as GitHub prereleases, but the repository had no release
workflow. `v0.0.12` therefore had zero attached assets. There was no failed Release workflow to retry.
The only nearby failed CI run was an older Windows `spawn ffmpeg ENOENT` failure, subsequently fixed by
putting Chocolatey's FFmpeg directory on `PATH`. All four npm package lookups returned 404 because npm
publication had never occurred.

## Automated GitHub release

Pushing a SemVer-like `v*` tag runs `.github/workflows/release.yml`. The job:

1. checks that the tag resolves to the checked-out commit;
2. installs FFmpeg and frozen dependencies;
3. runs formatting, linting, type checking, build, tests, reliability corpus, recovery demo, and
   production dependency audit;
4. packs all four workspace packages;
5. verifies each archive contains its manifest and built JavaScript/types but no source/test tree;
6. rejects packed manifests that still contain a `workspace:` dependency;
7. creates `release-manifest.json` and `SHA256SUMS.txt`; and
8. creates or updates a GitHub prerelease and attaches packages plus corpus/demo evidence.

The release train tag and individual package versions are separate. The manifest is authoritative for
the versions inside a bundle.

## Prepare a release

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm benchmark:reliability
pnpm demo
pnpm audit:prod
pnpm release:pack
```

Inspect `artifacts/release/release-manifest.json` and verify checksums locally:

```bash
cd artifacts/release
shasum -a 256 -c SHA256SUMS.txt
```

Then merge the release commit, create an annotated tag on the green main commit, and push it:

```bash
git tag -a v0.0.13 -m "Agent Media v0.0.13"
git push origin v0.0.13
```

Do not move or reuse a published tag. If a release job fails, fix the cause in a new commit and use a
new tag.

## Manual rebuild

The Release workflow supports `workflow_dispatch` with an existing tag. It checks out the tag—not the
current branch—and refuses a tag/commit mismatch. Use manual rebuild only when the tagged source
already contains the release workflow and packaging script.

## npm publication

npm publication requires a separate owner decision, confirmed scope access, package visibility, and
trusted publishing configuration. The current workflow has no package-registry permission, no npm
token, and no `npm publish` command by design.
