# Handoff — Selesai Bilingual Documentation Website

## Objective

Build a static bilingual (English/Indonesian) documentation website in `/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs`. It must demonstrate every bundled, user-facing Selesai capability and credibly explain Selesai's advantages over the original Pi coding agent. Its primary visitor action is installing and trying Selesai.

## Immutable decisions

- **Target:** `/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs`, currently empty. Do not modify `/Users/andrewanggada/Documents/workdir/js_proj/selesai`.
- **Stack:** Astro + Starlight, Markdown/MDX. Do not add Tailwind, a CMS, analytics, a backend, or hosted search.
- **Languages:** EN + ID at first release, English default, locale-specific URLs. EN is source; ID is reviewed parity. CLI commands, code, and identifiers stay untranslated.
- **Demonstrations:** copyable terminal/code snippets only. No video, GIF, screenshot, or interactive sandbox dependency.
- **Positioning:** benefit-oriented marketing with auditable linked evidence; make no unverified Pi claims.
- **Search/privacy:** Starlight local search (Pagefind); no tracking or cookie banner.
- **Docs lifecycle:** current/latest docs plus changelog; no multi-version archive.
- **Accessibility:** practical WCAG 2.2 AA, responsive and usable in dark/light modes.
- **Deployment:** configure GitHub Pages via GitHub Actions and validate locally. Publishing is not required until a remote and Pages permissions exist. Use the default Pages URL; no custom domain.
- **Release gates:** complete EN/ID content, verifiable claims, responsive/accessibility/theme quality, clean build, and working links.

## Source of truth

The Selesai repository at `/Users/andrewanggada/Documents/workdir/js_proj/selesai` is the read-only evidence/content source:

| Evidence | Paths |
| --- | --- |
| package, version, install | `package.json`, `README.md` |
| bundled extension manifest | `src/extensions/package.json` |
| capability behavior | each extension's README, package manifest, entry module, and tests |
| skills | `src/skills/` |
| release/documentation history | `CHANGELOG.md` when present |

The authoritative manifest contains 17 bundled extensions: caveman, copy-turn, context-compaction-reminder, pi-intercom, ponytail, question, grep-app, handoff-new, inline-skills, rtk, tokenin-onboarding, undo, workflow, pi-subagents, pi-web-agent, web-agent-onboarding, and pi-powerline-footer.

Document user-facing bundled capabilities—including relevant skills and workspace UX—not internal helper modules as independent products.

## Architecture

Use static Astro + Starlight with `en` and `id` locales, Starlight local search, custom CSS, and GitHub Pages base-path support (`/` locally; repository base in CI).

Create:

```text
selesai-docs/
  package.json
  astro.config.mjs
  tsconfig.json
  .gitignore
  README.md
  public/favicon.svg
  src/
    content/docs/en/
    content/docs/id/
    components/
      CapabilityCard.astro
      ComparisonCallout.astro
      InstallCommand.astro
      SourceEvidence.astro
    data/
      capabilities.ts
      navigation.ts
    styles/custom.css
  scripts/
    validate-content.mjs
    check-built-links.mjs
  .github/workflows/deploy-pages.yml
```

`src/data/capabilities.ts` defines typed metadata for every capability: stable slug, EN/ID names, category, benefit, comparison relevance, source paths/links, and guide route. It drives catalogue cards and cross-links; guide prose remains curated MDX.

## Required pages in both locales

1. **Home:** Selesai positioning, install CTA (`npm install -g --ignore-scripts @selesai/code` then `selesai`), feature overview, catalogue/comparison links, language switcher.
2. **Get started:** global install, `npx` one-off use, first command, `~/.selesai/agent` vs project `.selesai/`, provider credentials.
3. **Why Selesai / Compare with Pi:** evidence-backed benefit matrix separating Pi baseline from Selesai additions/bundling.
4. **Capabilities catalogue:** category-filtered cards from metadata, grouped into delegation/workflows, research/interaction, continuity/recovery, terminal workspace, and skills/productivity.
5. **Evidence and methodology:** evidence process/table, sources, comparison basis, and initial current version `0.5.22`.
6. **Changelog:** current documentation history and future entry format.
7. **Accessibility and privacy:** local search, no tracking, keyboard support, and theme behavior.

Create deep EN/ID guide pages for all manifest capabilities, organized by category. Every guide must state:

1. overview and user benefit;
2. bundled availability/onboarding;
3. quick start;
4. configuration, commands, or invocation syntax;
5. copyable examples;
6. prerequisites, limitations, safety constraints, and common failures;
7. contextual “Why Selesai” comparison where relevant; and
8. source/evidence links.

Explicitly say when a capability has no separate configuration.

## Content and comparison rules

1. Build evidence records from `src/extensions/package.json` first.
2. Before authoring any guide, inspect its README, manifest, entry module, and tests to confirm commands/options.
3. Write English then reviewed Indonesian parity immediately.
4. Add comparison claims only after linking them to source/documentation/release evidence.
5. Use Selesai source-link form `https://github.com/SelesaiInTech/selesai-code/blob/main/<source-path>` when applicable.
6. Refer to upstream Pi only where needed and never assert it lacks a feature without evidence.

## Components and UX constraints

- `InstallCommand.astro`: semantic `pre/code`, accessible copy button and announced success state.
- `CapabilityCard.astro`: one full-card link; no nested interactive elements.
- `ComparisonCallout.astro`: visibly distinct, citation-required comparison block.
- `SourceEvidence.astro`: visible source/version evidence and safe external-link attributes.
- Custom CSS: restrained accent over high-contrast neutral surfaces, system fonts only, comfortable long-form typography, visible focus, keyboard support, reduced-motion support, skip-link and mobile-sidebar validation.

## Verification and scripts

Add package scripts:

```json
{
  "dev": "astro dev",
  "build": "astro check && astro build",
  "preview": "astro preview",
  "validate:content": "node scripts/validate-content.mjs",
  "check:links": "node scripts/check-built-links.mjs",
  "verify": "npm run validate:content && npm run build && npm run check:links"
}
```

`validate-content.mjs` must fail with actionable errors for missing EN/ID guides, required localized headings, evidence links, or valid catalogue-guide routes.

`check-built-links.mjs` must scan built `dist/` HTML, resolve internal links under the deployed base path, ignore valid external schemes/fragments, and fail on broken internal targets.

## Implementation order

1. Scaffold Astro/Starlight project, locales, scripts, base-path behavior, and README.
2. Build metadata, navigation, reusable components, and accessibility-focused styling.
3. Build core EN/ID pages and conversion/navigation paths.
4. Produce evidence-backed full EN/ID guide inventory for all 17 manifest entries.
5. Implement content and built-link validation; test deliberate failures, then run `npm run verify`.
6. Add Pages workflow and document repository/Pages setup.

## GitHub Pages workflow

`.github/workflows/deploy-pages.yml` should trigger on `main` push and `workflow_dispatch`; use `contents: read`, `pages: write`, and `id-token: write`; run `npm ci` and `npm run verify`; configure Pages, upload `dist/`, deploy, and cancel stale concurrent deploys.

## Definition of done

- Every user-facing bundled capability is catalogued and has full EN/ID guides.
- Every material Selesai/Pi comparison claim is traceable to evidence.
- Navigation and local full-text search work.
- EN/ID parity validation, clean build, and link validation pass through `npm run verify`.
- The site is responsive, keyboard-accessible, practical WCAG 2.2 AA, and supports dark/light mode.
- Pages CI exists and is documented, without claiming a live URL.

WORKFLOW_HANDOFF_STATUS: ready