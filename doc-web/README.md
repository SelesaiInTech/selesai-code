# Selesai Docs

Bilingual documentation website for Selesai, the maintained, extension-first fork of the Pi coding agent.

## Development

```sh
npm install
npm run dev
```

## Verification

```sh
npm run verify
```

This runs content validation, `astro check`, a full static build, and a built-link check.

## Deployment

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) that builds and deploys to GitHub Pages on pushes to `main`.

Before publishing, set this repository's GitHub Pages source to **Deploy from a branch**: `gh-pages` / **(root)**. The workflow builds `doc-web` and force-pushes its static output to that branch on every push to `main`.

Published site: <https://selesaiintech.github.io/selesai-code/>.

## License

The content and code in this repository are part of the Selesai project documentation.
