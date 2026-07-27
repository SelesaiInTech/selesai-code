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

Before the workflow can publish, you must:

1. Create a GitHub repository for `selesai-docs`.
2. Enable GitHub Pages with the **GitHub Actions** source.
3. Push the repository to the remote.

Until those steps are done, the workflow will not run successfully because there is no remote or Pages environment.

## License

The content and code in this repository are part of the Selesai project documentation.
