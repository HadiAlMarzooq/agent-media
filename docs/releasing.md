# Releasing

Agent Media has two release channels:

1. a GitHub release bundle containing validated package tarballs and evidence; and
2. npm publication to `@hadialmarzooq`.

## Automated GitHub release

Pushing a SemVer-like `v*` tag runs `.github/workflows/release.yml`. The job:

1. checks that the tag resolves to the checked-out commit;
2. installs FFmpeg and frozen dependencies;
3. runs formatting, linting, type checking, build, tests, reliability corpus, recovery demo, and
   production dependency audit;
4. packs all four workspace packages;
5. verifies each archive contains its manifest and built JavaScript/types but no source/test tree;
6. rejects packed manifests that still contain a `workspace:` dependency;
7. installs the tarballs into an empty project and imports SDK/MCP exports plus the CLI binary;
8. creates `release-manifest.json` and `SHA256SUMS.txt`; and
9. creates or updates a GitHub prerelease and attaches packages plus corpus/demo evidence.

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
pnpm check:sizes
pnpm release:pack
pnpm release:smoke
```

Inspect `artifacts/release/release-manifest.json` and verify checksums locally:

```bash
cd artifacts/release
shasum -a 256 -c SHA256SUMS.txt
```

Then merge the release commit, create an annotated tag on the green main commit, and push it:

```bash
git tag -a v0.1.0 -m "Agent Media v0.1.0"
git push origin v0.1.0
```

Do not move or reuse a published tag. If a release job fails, fix the cause in a new commit and use a
new tag.

## npm publication

All four packages include `publishConfig: { access: "public" }` and publish under the
`@hadialmarzooq` scope.

### Automated (recommended)

The `.github/workflows/publish.yml` workflow runs on `workflow_dispatch` with a tag input. It reruns
all gates, then publishes with `NODE_AUTH_TOKEN` from the `npm` environment secret.

1. Create an npm access token at https://www.npmjs.com/settings/tokens (type: Automation).
2. Add it as a repository secret named `NPM_TOKEN` in a `npm` environment
   (Settings → Environments → New environment → `npm` → Add secret).
3. Trigger the workflow: Actions → Publish → Run workflow → enter the tag (e.g. `v0.1.0`).

### Manual

```bash
npm login
pnpm build
pnpm -r --filter './packages/*' publish --access public
```

### After publishing

- Make the repository public on GitHub if not already.
- Verify packages appear on npm: `npm view @hadialmarzooq/agent-media-core version`
- Tag and push the release so the release workflow attaches artifacts.
