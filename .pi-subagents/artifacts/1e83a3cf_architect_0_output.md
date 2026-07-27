# Build Plan: Selesai Documentation Site

## 1. Discovery and boundaries

### Source of truth
Inspect only the Selesai repository for capability facts:

- `package.json`: package/version/install commands/repository URL.
- `README.md`: public positioning, Pi-compatible baseline, and documented feature groups.
- `src/extensions/package.json`: authoritative bundled extension manifest.
- Each referenced extension’s `README.md`, `package.json`, entry module, and tests: setup, configuration, commands, limitations, and examples.
- `src/skills/`: bundled skill inventory and descriptions.
- `CHANGELOG.md` when present: initial changelog content/version references.

The authoritative bundled-extension manifest currently names these entries:

1. caveman
2. copy-turn
3. context-compaction-reminder
4. pi-intercom
5. ponytail
6. question
7. grep-app
8. handoff-new
9. inline-skills
10. rtk
11. tokenin-onboarding
12. undo
13. workflow
14. pi-subagents
15. pi-web-agent
16. web-agent-onboarding
17. pi-powerline-footer

Do not document internal helper files as independent product extensions.

### Modification boundary
Create the site only in:

`/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs`

Do not modify `/Users/andrewanggada/Documents/workdir/js_proj/selesai`. It is the documentation source/evidence repository, not the website implementation target.

## 2. Technical approach

Use **Astro + Starlight**:

- Static-site-first and compatible with GitHub Pages.
- Built-in documentation navigation, responsive layout, dark/light themes, accessible baseline, and local Pagefind-powered search.
- Native locale support for English and Indonesian.
- Use Starlight styling/custom Astro components; do not add Tailwind, a CMS, analytics, a backend, or hosted search.

Install only required site dependencies:

- `astro`
- `@astrojs/starlight`
- `@astrojs/check`
- `typescript`

Use Markdown/MDX documentation files rather than building a custom documentation renderer.

## 3. Site structure

Create:

```text
selesai-docs/
  package.json
  astro.config.mjs
  tsconfig.json
  src/
    content/
      docs/
        en/
        id/
    components/
      CapabilityCard.astro
      ComparisonCallout.astro
      InstallCommand.astro
      SourceEvidence.astro
    data/
      capabilities.ts
      navigation.ts
    styles/
      custom.css
  public/
    favicon.svg
  scripts/
    validate-content.mjs
    check-built-links.mjs
  .github/
    workflows/
      deploy-pages.yml
  README.md
```

### `astro.config.mjs`
Configure:

- Starlight integration.
- Locales `en` and `id`, with `en` as default.
- GitHub Pages-compatible `base`: `/` locally and `/${repository-name}/` in GitHub Actions.
- Static output.
- Starlight local search.
- Custom CSS.
- Sidebar/navigation imported from `src/data/navigation.ts`.

### `src/data/capabilities.ts`
Create one typed metadata record per user-facing capability. Each record includes:

- stable slug;
- English and Indonesian display names;
- category;
- short benefit statement;
- Pi-comparison relevance;
- Selesai source paths;
- public GitHub source links;
- linked guide routes.

This data drives the catalogue page and prevents differences between sidebar, cards, and guide URLs.

Do not attempt to generate guide prose from this data. Deep guide content remains authored MDX, because configuration, examples, edge cases, and comparisons require capability-specific writing.

## 4. Pages and navigation

Create the same information architecture under both `/en/` and `/id/`.

### Top-level pages
1. **Home**
   - What Selesai is: maintained, extension-first Pi fork.
   - Primary install CTA:
     ```sh
     npm install -g --ignore-scripts @selesai/code
     selesai
     ```
   - Feature-group overview.
   - Link to the central comparison and extension catalogue.
   - Clear language switcher.

2. **Get started**
   - Install, one-off `npx` use, first command, configuration locations.
   - Explain `~/.selesai/agent` and project `.selesai/`.
   - Explain prerequisites and safe handling of provider credentials.

3. **Why Selesai / Compare with Pi**
   - Benefit-oriented but evidence-backed comparison matrix.
   - Separate “Pi keeps” from “Selesai adds or bundles.”
   - Link every material Selesai claim to a source-evidence row and source code/documentation.
   - Avoid absolute or unverified claims about Pi.

4. **Capabilities catalogue**
   - Category-filtered card grid generated from `capabilities.ts`.
   - Each card has its benefit, category, Pi comparison indicator, and guide link.
   - Categories:
     - Delegation and workflows
     - Research and interaction
     - Continuity and recovery
     - Terminal workspace
     - Skills and productivity

5. **Evidence and methodology**
   - Explain that source code, package manifests, README, tests, and changelog are the evidence base.
   - Include a table mapping every catalogued capability to Selesai source paths and its comparison basis.
   - State the documented Selesai version (`0.5.22` at initial implementation) and that docs represent current/latest.

6. **Changelog**
   - Current documentation change history.
   - Include initial version/source baseline and future release-entry format.

7. **Accessibility and privacy**
   - State local search, no tracking/cookies, keyboard support, theme behavior, and accessibility contact/reporting guidance.

### Capability guide pages
Create a deep page for every catalogued user-facing capability in both languages. Organize guide directories by category, for example:

```text
src/content/docs/en/capabilities/delegation/pi-subagents.mdx
src/content/docs/id/capabilities/delegation/pi-subagents.mdx
```

Every guide must include, in its locale:

1. What it is and the user benefit.
2. Bundled availability and any installation/onboarding requirement.
3. Quick-start steps.
4. Configuration, commands, or invocation syntax.
5. Copyable terminal/code examples.
6. Prerequisites, limits, safety boundaries, and common failure cases.
7. A contextual `Why Selesai` comparison when applicable.
8. Source/evidence links.

For non-configuration-oriented capabilities, explicitly state that no separate configuration is required rather than omitting the section.

## 5. Reusable components

### `InstallCommand.astro`
- Renders copyable installation/CLI commands.
- Use semantic `<pre><code>` markup and an accessible copy button.
- Button must expose an understandable accessible label and success state.

### `CapabilityCard.astro`
- Renders catalogue cards from capability metadata.
- Use a single full-card link; do not nest interactive controls.

### `ComparisonCallout.astro`
- Reusable, visually distinct “Why Selesai” block.
- Accepts only explicit, cited claims.
- Never renders unsupported comparison language.

### `SourceEvidence.astro`
- Renders source links and version/evidence labels.
- Uses external-link safety attributes where appropriate.
- Makes evidence visible rather than hiding it in implementation metadata.

## 6. Content production order

1. Create evidence records for all manifest entries from `src/extensions/package.json`.
2. Inspect each extension before writing its guide; use tests and entry modules to confirm commands/options.
3. Write English guide content first.
4. Write reviewed Indonesian parity content immediately after each English guide.
5. Add central comparison entries only after their claim/source links are established.
6. Run content validation before considering content complete.

Use source links such as:

```text
https://github.com/SelesaiInTech/selesai-code/blob/main/<source-path>
```

For upstream Pi references, link to the original Pi repository/documentation only where a comparison needs it. Do not invent a missing upstream capability claim.

## 7. Styling and accessibility

Implement `src/styles/custom.css` with restrained Selesai branding layered over Starlight:

- High-contrast neutral surfaces with one restrained Selesai accent color.
- Readable system-font stack; no remote font requirement.
- Comfortable long-form code/documentation typography.
- Both dark and light modes.
- Respect `prefers-reduced-motion`.
- No auto-playing media, because demonstrations are code/terminal-only.
- Ensure navigation, locale selector, search, copy buttons, and expandable controls work by keyboard.
- Verify visible focus, heading hierarchy, color contrast, skip link behavior, and mobile sidebar behavior.

## 8. Validation scripts

### `scripts/validate-content.mjs`
Add a dependency-free Node script that:

- loads `capabilities.ts` or a maintained capability list;
- verifies each capability has an English and Indonesian guide;
- verifies each guide has required headings for its locale;
- verifies every guide includes source/evidence links;
- verifies catalogue metadata points to existing guide routes;
- exits non-zero with actionable missing-content errors.

### `scripts/check-built-links.mjs`
After `astro build`, scan generated `dist/` HTML for internal `href` targets and confirm they resolve under the deployed base path. Ignore valid external schemes (`https:`, `mailto:`, fragments). Exit non-zero for missing internal targets.

Add scripts:

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

## 9. GitHub Pages deployment

Create `.github/workflows/deploy-pages.yml`:

- Trigger on pushes to `main` and `workflow_dispatch`.
- Use least-privilege Pages permissions:
  - `contents: read`
  - `pages: write`
  - `id-token: write`
- Install dependencies with `npm ci`.
- Run `npm run verify`.
- Configure Pages, upload `dist/`, and deploy through official Pages actions.
- Add concurrency so a newer deployment cancels a stale one.
- Document that the workflow requires a GitHub remote and Pages configured for GitHub Actions before publishing.

Do not claim a live URL exists while the target directory has no Git repository/remote.

## 10. Ordered implementation tasks

### Task 1 — Scaffold the documentation project
**Files:** `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `README.md`.

Create the Astro/Starlight project, scripts, locale configuration, base-path behavior, and local development instructions.

**Verify:** `npm install`, `npm run build`, and `npm run dev` succeed.

### Task 2 — Build shared metadata, navigation, and components
**Files:** `src/data/capabilities.ts`, `src/data/navigation.ts`, `src/components/*.astro`, `src/styles/custom.css`.

Implement capability metadata, bilingual navigation, catalogue cards, install snippet, evidence rendering, comparison callout, themes, and accessibility styling.

**Verify:** components render with representative data; keyboard focus is visible in both themes.

### Task 3 — Implement core bilingual pages
**Files:** EN/ID home, getting-started, comparison, catalogue, evidence, changelog, accessibility/privacy MDX pages.

Build the conversion path from landing page to installation, then catalogue and comparison discovery.

**Verify:** locale switcher preserves equivalent page when available; install commands, comparison links, and all nav routes work.

### Task 4 — Produce complete bilingual guide inventory
**Files:** EN/ID MDX guides for all 17 manifest entries, organized by category.

For each entry, inspect source evidence first, author the complete English guide, then the equivalent reviewed Indonesian guide. Add evidence links and contextual Pi comparisons where relevant.

**Verify:** all guides meet the standard template and catalog entries resolve to them.

### Task 5 — Add automated content/link validation
**Files:** `scripts/validate-content.mjs`, `scripts/check-built-links.mjs`, package scripts.

Ensure omitted locales, missing guides, unsupported routes, missing evidence, and broken generated links fail validation.

**Verify:** deliberately remove one guide/link locally to confirm each script fails clearly; restore it and run `npm run verify`.

### Task 6 — Add Pages deployment configuration
**Files:** `.github/workflows/deploy-pages.yml`, `README.md`.

Add the Pages workflow and document the required GitHub repository/Pages setup.

**Verify:** workflow YAML is valid, uses `npm ci` plus `npm run verify`, uploads `dist`, and uses the configured repository base path.

## 11. Finished prototype

The completed site is a polished, static bilingual documentation portal. A new visitor can understand Selesai’s value, compare it credibly with Pi, install it from the home page, search the full capability catalog locally, and open a complete English or Indonesian deep guide for every bundled user-facing capability. It is responsive, keyboard accessible, dark/light capable, has no tracking, validates content and links in CI, and is ready to deploy to default GitHub Pages once the repository and permissions exist.

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 63bf4c