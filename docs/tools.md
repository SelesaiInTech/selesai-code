# Tools

The public tool surface is intentionally small now.

## `web_explore`

Use `web_explore` for web research questions:

- current docs lookups
- comparing sources
- checking discussions or issues
- getting a recommendation with citations
- finding practical context around a library or API

It runs a bounded research workflow instead of making the model manually chain separate search/fetch/browser tools.

Internally, `web_explore` can do a few things:

- read HTTP/HTTPS links from the prompt before search
- strip common tracking params from direct links
- plan search queries
- run web search through the configured search backend: DuckDuckGo, SearXNG, Brave, You.com, Exa, or Tavily
- read GitHub, PDF, and YouTube links through dedicated readers instead of scraping the page
- pick candidate pages
- prefer forum/thread sources when the query asks for discussions
- read pages over HTTP
- escalate selected pages to headless rendering
- keep explicit gaps for unreadable direct/thread sources
- rank evidence
- evaluate source quality and source diversity
- synthesize findings and caveats

The important bit: those internal steps are not separate public tools for normal model use. If more web evidence is needed, the model should call `web_explore` again with a narrower query.

## GitHub, PDF, and YouTube links

You don't do anything special for these. If a GitHub, PDF, or YouTube URL shows up, whether you pasted it or search surfaced it, `web_explore` reads the real content instead of the rendered page:

- GitHub: files come from the raw endpoint, issues and PRs come from the API with their comments, and a repo root gives you the README plus a top-level file listing. It's keyless; set `GITHUB_TOKEN` in the environment if you want the higher API rate limit.
- PDF: the text is extracted directly. A scanned PDF with no text layer can't be read, so you get a note saying so rather than a silent empty result.
- YouTube: you get the transcript from the captions. A video with no captions gets the same kind of note.

These run behind `web_explore`, so there's still nothing extra to call.

## What preview and verbose show

In compact mode, `web_explore` keeps the transcript short:

```text
Reviewed 3 sources · synthesized answer with 3 findings
```

In preview or verbose mode, findings include where the evidence came from internally:

```text
- [web_fetch] Official docs say ...
- [web_fetch_headless] Rendered docs show ...
- [github] The README describes ...

Internal research: web_search ×2, web_fetch ×5, web_fetch_headless ×1
```

The label reflects which reader produced the finding, so you'll also see `[github]`, `[pdf]`, or `[youtube]` when one of those handled a link.

That is meant to be transparent, not an invitation to call those internal steps directly.

## When evidence is weak

Sometimes a research pass finds nothing useful. In that case the output says:

```text
No usable evidence found.
```

That is expected. Web pages can be thin, blocked, duplicated, or irrelevant. Forum/thread pages can also render bot checks or noisy app shells. A follow-up `web_explore` call with a more specific query is usually the right next move.

Partial answers may explain the specific quality problem, for example:

```text
Evidence is partial: one or more thread sources could not be read reliably, and the source set was narrow.
```

## A practical rule

If the task is web research, use `web_explore`.

If you need another angle, call `web_explore` again with a better query. Do not switch to shell network commands like `curl`, `Invoke-WebRequest`, or `npm view` just to continue web research.
