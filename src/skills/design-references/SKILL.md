---
name: design-references
description: Design-reference lookup from VoltAgent's Awesome DESIGN.md collection. Use when the user asks for design references or inspiration, or wants a page/product to feel like a known site or brand (Linear, Stripe, Apple, etc.).
license: MIT
---

# Design References

[VoltAgent/awesome-design-md](https://github.com/voltagent/awesome-design-md) is a curated collection of `DESIGN.md` files extracted from real websites — color roles, typography, components, layout, depth, responsive rules, do/don'ts. Use it to ground design decisions in an analyzed real system instead of generic output.

## Procedure

1. **Fetch the collection index.** `grep_app_fetch` `README.md` from `voltagent/awesome-design-md`. Its Collection section is the single source of truth — never work from a memorized site list.
   Done when: the Collection section is in context, or the fetch failed twice and you say so, labelling anything after as unfetched.
   Locally vendored references (e.g. `references/clickhouse/DESIGN.md`) may be used in place of a fetch for those slugs.
2. **Select references.**
   - Named brand ("make it feel like X"): find that site's row; the link path is the slug (`getdesign.md/linear.app/design-md` → `linear.app`).
   - Open-ended ("give me references"): pick 2–3 whose category and one-line description match the brief's audience, industry, and interface density. Each pick needs a reason tied to the brief. If two candidates lead to genuinely different builds, ask one choice question.
   Done when: every pick has a stated reason (named branch: the named site, or a stated closest match).
3. **Fetch each `design-md/<slug>/DESIGN.md`** via `grep_app_fetch` (`repo: voltagent/awesome-design-md`).
   Done when: every recommended reference was fetched this session, or was confirmed absent — then offer the closest same-category alternatives instead.
4. **Distill, don't dump.** Extract only what transfers: palette roles, type hierarchy, spacing/layout, component treatment, depth/motion, do/don'ts. Never paste a whole DESIGN.md into chat or project files.
   Done when: you can state 2–3 principles per reference you will actually apply.
5. **Report, then build.** One-line direction; then per reference: why it fits, what to borrow, and its `https://getdesign.md/<slug>/design-md` URL. If the user named a site, deliver the distillation as an implementable mini-brief and build from it; otherwise present the options and proceed with the strongest fit.

## Guardrails

- Cite only references fetched this session — never claim you examined one you didn't.
- Adapt, don't imitate: transfer principles; never lift a brand's logo, imagery, or distinctive identity.
- Accessibility is non-negotiable: contrast, focus states, keyboard access, touch targets.
- Write a project-root `DESIGN.md` only if asked; if asked, author a project-specific one informed by the references, not a copy.
