# Requirements — Selesai Documentation Website

## Objective
Build a bilingual documentation website that demonstrates Selesai’s bundled, user-facing capabilities and persuasively—but verifiably—explains its advantages over the original Pi coding agent. The primary conversion is that a visitor installs and tries Selesai.

## Delivery
- Implement the website in `/Users/andrewanggada/Documents/workdir/js_proj/selesai-docs`.
- The target directory is presently empty.
- Prepare GitHub Pages deployment through GitHub Actions and validate the site build locally.
- Do not require a live deployment in this work: publishing awaits a GitHub repository and permissions.
- Use the default GitHub Pages URL initially; no custom domain is required.

## Audience and information architecture
Serve a mixed audience through clear paths for:
- developers evaluating Selesai against Pi;
- current Selesai users learning setup and capabilities; and
- contributors/extension authors needing technical context.

The site should use a modern, developer-documentation visual direction: code-first, readable, responsive, and usable in dark and light themes. It must include structured navigation and local client-side full-text search, with no hosted search dependency.

## Languages
- Publish all pages in English and Indonesian from the first release.
- English is the default locale, with locale-specific URLs.
- English is the source content; Indonesian must be reviewed and remain at feature/content parity.
- Do not translate CLI commands, code, identifiers, or other technical tokens unnecessarily.

## Content scope
Document every bundled, user-facing Selesai capability—not every internal source module. This includes user-facing extensions, bundled skills, and workspace UX features. The catalogue must be grounded in the actual repository, especially `src/extensions/`, bundled skills, and documented host behavior.

Known Selesai capability groups include delegation/orchestration, durable workflows, web research, interactive questions, richer terminal workspace features, session coordination, recovery/continuity tools, RTK integration, and bundled skills. The final catalogue must validate the current inventory from source rather than treating this list as exhaustive.

Every documented capability gets a deep guide using a consistent full template:
1. overview and user benefit;
2. availability/installation;
3. quick start;
4. configuration;
5. copyable terminal/code examples;
6. limitations, prerequisites, and edge cases; and
7. a Pi comparison where relevant.

Demonstrations use copyable code and terminal snippets only; videos, screenshots, GIFs, and browser-interactive demos are not required.

## Selesai vs Pi positioning
- Use benefit-oriented marketing copy, but every claim must be auditable and non-misleading.
- Provide one central Selesai-vs-Pi comparison page plus contextual “Why Selesai” sections in relevant guides.
- Tie comparison claims to source code, documentation, or release evidence and identify the applicable version/current state.
- Emphasize Selesai’s extension-first bundled experience without claiming that Pi lacks a capability unless the evidence supports that exact comparison.

## Quality, privacy, and documentation lifecycle
- Target practical WCAG 2.2 AA: semantic structure, keyboard operation, visible focus, appropriate contrast, and reduced-motion support.
- Meet responsive behavior, dark/light usability, valid build, and working-link quality requirements.
- Include no analytics, tracking, or cookie banner in the initial release.
- Publish current/latest documentation plus a changelog, rather than versioned documentation archives.

## Acceptance criteria
The implementation is ready when:
- every current user-facing bundled capability is inventoried and has the promised full EN/ID guide;
- Pi/Selesai claims are traceable to evidence;
- EN and ID content are complete and reviewed for parity;
- local full-text search and structured navigation work;
- responsive, dark/light, and practical WCAG 2.2 AA requirements are satisfied;
- the site builds cleanly and internal/external links are checked; and
- a GitHub Pages Actions deployment configuration exists and is documented, with local build validation complete.
