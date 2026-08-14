# Releases

## Normal release flow

1. update `CHANGELOG.md` under `## Unreleased`
2. run `npm run release:dry-run`
3. run `npm run release`
4. push `main` and the new tag, for example `git push origin main v1.8.0`
5. let GitHub Actions publish the tagged release to npm and rebuild the docs site

The bump is inferred from what's under `## Unreleased`: a `### Breaking` entry makes it major, `### Added` makes it minor, otherwise it's a patch. `npm run release` moves the Unreleased notes into a dated version section, bumps `package.json`, commits, and tags. The tag is lightweight, so if `git push --follow-tags` skips it, push the tag by name.

On the tag push, the publish workflow runs two jobs. The first creates the GitHub release, pulling that version's notes out of `CHANGELOG.md` via `scripts/release-notes.mjs`. The second builds, tests, and publishes to npm with provenance.

## Trusted publishing

This repo uses npm Trusted Publishing from GitHub Actions.

That replaced the older `NPM_TOKEN` secret flow.

If the publish job fails with a transient Sigstore/Rekor provenance error, rerun the failed job before changing code. The package may have built and tested cleanly while the transparency-log request failed outside the repo.

## Docs publishing

The docs site publishes through GitHub Pages.

With Pages enabled for the repo, pushes to `main` should rebuild and redeploy the docs automatically through the docs workflow.
