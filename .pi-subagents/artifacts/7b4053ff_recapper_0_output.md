The `write_workflow_artifact` tool is not available in this session. Per tooling constraints, I'll return the complete handoff inline for the runtime to persist.

---

# Handoff — Selesai Bilingual Documentation Website

## Objective and core proposition

Build a static, bilingual (EN/ID) documentation website at `/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs` that demonstrates every bundled, user-facing Selesai capability and credibly explains its advantages over the original Pi coding agent. The primary visitor action is installing and trying Selesai.

## Immutable decisions (do not re-grill)

- **Target directory:** `/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs` (currently empty). Do not modify `/Users/andrewanggada/Documents/workdir/js_proj/selesai`.
- **Tech stack:** Astro + Starlight. No Tailwind, CMS, analytics, backend, or hosted search. Use Markdown/MDX.
- **Languages:** EN + ID from first release. English default, locale-specific URLs. EN is source; ID is reviewed parity. Do not translate CLI commands, code, or identifiers.
- **Demo medium:** Copyable terminal/code snippets only. No videos, GIFs, screenshots, or interactive sandboxes.
- **Comparison tone:** Benefit-oriented marketing, every claim auditable and linked to source evidence. No unverified claims about Pi.
- **Search:** Starlight local search (Pagefind). No hosting dependency.
- **Analytics/privacy:** None. No tracking or cookie banner.
- **Domain/URL:** Default GitHub Pages URL. No custom domain.
- **Versioning:** Current/latest docs plus changelog. No multi-version archive.
- **Accessibility:** Practical WCAG 2.2 AA.
- **Deployment:** Configure GitHub Actions workflow for Pages. Validate locally. Live publishing requires a GitHub remote and Pages-enable permission—this work does not require it.
- **Release gates:** complete content (all EN/ID guides), verifiable claims, site quality (responsive, dark/light, WCAG AA, clean build, working links).

## Source-of-truth evidence repository

The Selesai repository at `/Users/andrewanggada/Documents/workdir/js_proj/selesai` supplies all capability facts. Key evidence locations:

| What | Path |
|------|------|
| Package/version/install | `package.json`, `README.md` |
| Bundled extension manifest | `src/extensions/package.json` |
| Extension docs/tests/config | Per-extension: `src/extensions/<name>/README.md`, `package.json`, entry module, tests |
| Skills inventory | `src/skills/` |
| Changelog | `CHANGELOG.md` (if present) |

### Authoritative bundled-extension manifest (17 entries)

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

Do not document internal helper files as independent product capabilities.

## Architecture and site structure

```
selesai-docs/
├── package.json
├── astro.config.mjs      # Starlight, locales en/id, static, Pages base
├── tsconfig.json
├── .gitignore
├── README.md
├── public/
│   └── favicon.svg
├── src/
│   ├── content/docs/
│   │   ├── en/            # EN guide MDX pages
│   │   └── id/            # ID guide MDX pages (parity with en/)
│   ├── components/
│   │   ├── CapabilityCard.astro      # Catalogue card from metadata
│   │   ├── ComparisonCallout.astro   # "Why Selesai" block
│   │   ├── InstallCommand.astro      # Copyable CLI command
│   │   └── SourceEvidence.astro      # Source/version evidence link
│   ├── data/
│   │   ├── capabilities.ts           # Typed metadata per capability
│   │   └── navigation.ts             # Sidebar nav config
│   └── styles/
│       └── custom.css                # Restrained Selesai brand over Starlight
├── scripts/
│   ├── validate-content.mjs          # Guide completeness checker
│   └── check-built-links.mjs         # Built-link integrity checker
└── .github/workflows/
    └── deploy-pages.yml              # GitHub Actions Pages deploy
```

### astro.config.mjs key decisions
- Starlight integration with locales `en` (default) and `id`.
- Base path: `/` locally, `/${repository-name}/` in CI via environment variable or config.
- Static output, Starlight local search, custom CSS imported.
- Sidebar driven from `src/data/navigation.ts`.

### src/data/capabilities.ts metadata record
Each record: slug, en/displayName, id/displayName, category, benefit, piComparisonRelevance, sourcePaths[], sourceLinks[], guideRoute. This drives the catalogue page and cross-references guides.

## Pages (both locales)

### Top-level pages
1. **Home** — What Selesai is (maintained extension-first Pi fork), primary install CTA, feature-group overview, link to comparison and catalogue, language switcher.
2. **Get started** — Install (`npm install -g --ignore-scripts @selesai/code`), `npx` one-off, first command, `~/.selesai/agent` vs `.selesai/` project config, provider credentials.
3. **Why Selesai / Compare with Pi** — Benefit-oriented evidence-backed comparison matrix. Separate "Pi keeps" from "Selesai adds/bundles." Every claim links to source.
4. **Capabilities catalogue** — Category-filtered card grid from `capabilities.ts`. Categories: Delegation and workflows, Research and interaction, Continuity and recovery, Terminal workspace, Skills and productivity.
5. **Evidence and methodology** — Source code evidence base, mapping table, documented version (0.5.22 at initial implementation).
6. **Changelog** — Documentation change history.
7. **Accessibility and privacy** — Local search, no tracking, WCAG AA, keyboard/theme behavior.

### Capability guide pages (17 × 2 locales)
Organized by category, e.g. `src/content/docs/en/capabilities/delegation/pi-subagents.mdx`.

Every guide must include:
1. What it is and user benefit
2. Bundled availability / onboarding
3. Quick-start steps
4. Configuration / commands / invocation syntax
5. Copyable terminal/code examples
6. Prerequisites, limits, safety boundaries, failure cases
7. Contextual "Why Selesai" comparison (where applicable)
8. Source/evidence links

If a capability has no configuration, state that explicitly.

## Content production rules

1. Create evidence records from `src/extensions/package.json` first.
2. Inspect each extension before writing—check its README, package.json, entry module, and tests for commands/options.
3. Write EN guide first, then reviewed ID parity immediately after.
4. Add central comparison entries only after claim/source links are established.
5. Run `npm run validate:content` before declaring content complete.
6. Source link pattern: `https://github.com/SelesaiInTech/selesai-code/blob/main/<source-path>`
7. Reference upstream Pi only when comparison requires it. Do not invent missing upstream capability claims.

## Validation

### scripts/validate-content.mjs
Dependency-free Node script that:
- Loads capability list from `capabilities.ts` (or maintained list)
- Verifies each capability has EN + ID guide
- Verifies required headings present in each locale guide
- Verifies source/evidence links exist in every guide
- Verifies catalogue metadata points to existing guide routes
- Exits non-zero with actionable errors

### scripts/check-built-links.mjs
After `astro build`, scan `dist/` HTML for internal `href` targets, confirm resolution under deployed base path. Ignore `https:`, `mailto:`, fragments. Exit non-zero for missing targets.

### Package scripts
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

## Implementation task order

| Task | Files | Verify |
|------|-------|--------|
| **1. Scaffold** | `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `README.md` | `npm install`, `npm run build`, `npm run dev` |
| **2. Metadata, nav, components, styling** | `src/data/capabilities.ts`, `src/data/navigation.ts`, `src/components/*.astro`, `src/styles/custom.css` | Components render, keyboard focus in both themes |
| **3. Core bilingual pages** | EN/ID home, get-started, comparison, catalogue, evidence, changelog, accessibility/privacy | Locale switcher works, install/comparison/nav routes work |
| **4. Complete guide inventory** | EN/ID MDX guides for all 17 manifest entries by category | All guides meet template, catalog entries resolve |
| **5. Content/link validation** | `scripts/validate-content.mjs`, `scripts/check-built-links.mjs` | Deliberate breakage fails; `npm run verify` passes after restore |
| **6. Pages deployment config** | `.github/workflows/deploy-pages.yml`, `README.md` | YAML valid, uses `npm ci` + `npm run verify`, uploads `dist` |

## Reusable components contract

### InstallCommand.astro
- Semantic `<pre><code>` stack with accessible copy button.
- Button: understandable aria-label, success-state announcement.

### CapabilityCard.astro
- Single full-card `<a>` link; no nested interactive controls.

### ComparisonCallout.astro
- Visually distinct block. Accepts only explicit cited claims. Never renders unsupported comparison language.

### SourceEvidence.astro
- Renders source links and version/evidence labels. Uses `rel="noopener noreferrer"` for external links.

## Styling constraints (custom.css over Starlight defaults)
- High-contrast neutral surfaces, one restrained Selesai accent.
- System font stack; no remote fonts.
- Comfortable long-form documentation typography.
- Both dark and light modes.
- `prefers-reduced-motion` respected.
- No auto-playing media.
- Visible focus, heading hierarchy, color contrast, skip-link, mobile sidebar verified.

## Deployment

`.github/workflows/deploy-pages.yml`:
- Trigger: push to `main`, `workflow_dispatch`
- Permissions: `contents: read`, `pages: write`, `id-token: write`
- Steps: `npm ci`, `npm run verify`, Pages configure, upload `dist/`, deploy
- Concurrency: cancel-in-progress
- Document in README that the workflow needs a GitHub remote and Pages configured for GitHub Actions before publishing.

## Constraints and risks

- **No Selesai repo modification.** All evidence reading, no writing to the source repo.
- **Target directory is empty.** Everything must be created from scratch.
- **No live deployment required.** The workflow completes with local build validation and configured CI.
- **Version pinning.** Document version `0.5.22` at initial implementation. Docs represent current/latest; update version with each release.
- **No upstream Pi claims without evidence.** The comparison must not assert Pi lacks something unless the evidence supports that exact claim.
- **Translation parity is reviewed, not machine-only.** ID content must be written/reviewed to match EN completeness and accuracy.
- **No interactive/visual demonstrations.** All demonstrations are copyable code and terminal snippets.

## Definition of done

The implementation is complete when:
1. All 17 manifest entries have complete EN and ID guides meeting the full template.
2. All Pi/Selesai comparison claims are traceable to evidence (source code, docs, release notes).
3. Local full-text search and structured navigation work.
4. EN and ID content are validated for completeness and parity.
5. The site builds cleanly (`npm run build`).
6. Internal/external links are checked and valid.
7. WCAG 2.2 AA practical requirements are satisfied (responsive, dark/light, keyboard, focus, contrast, semantic structure).
8. A GitHub Pages Actions workflow exists and is documented.
9. `npm run verify` passes.

---

WORKFLOW_HANDOFF_STATUS: ready

⧉ copy assistant: /cp 199cda