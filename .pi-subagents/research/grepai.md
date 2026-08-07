# grepai integration research

**Date:** 2026-08-07
**Repository:** [`yoanbernabeu/grepai`](https://github.com/yoanbernabeu/grepai)
**Scope:** official binary release layout, configuration, OpenAI-compatible embeddings, and Selesai/TokenIn integration.

## Verified upstream facts

### Installation and release assets

- The upstream README documents Homebrew, the Unix installer, and the Windows PowerShell installer. The quick start is `grepai init`, `grepai watch`, then `grepai search <query>`. [README.md](https://github.com/yoanbernabeu/grepai/blob/main/README.md#installation)
- `install.sh` derives assets as `grepai_<version>_<os>_<arch>.tar.gz`, mapping `x86_64` to `amd64` and `aarch64/arm64` to `arm64`; Windows uses `.zip`. [install.sh](https://github.com/yoanbernabeu/grepai/blob/main/install.sh#L4-L44)
- `install.ps1` confirms the Windows asset name `grepai_<version>_windows_amd64.zip` and installs `grepai.exe`. [install.ps1](https://github.com/yoanbernabeu/grepai/blob/main/install.ps1#L9-L36)
- GoReleaser builds Linux, macOS, and Windows for amd64/arm64, uses `tar.gz` except Windows `zip`, and publishes `checksums.txt`. [.goreleaser.yaml](https://github.com/yoanbernabeu/grepai/blob/main/.goreleaser.yaml#L7-L40)

**Selesai implication:** extend `src/utils/tools-manager.ts` with a `grepai` managed tool using the official GitHub repo, `v` tag prefix, checksum verification, and the asset names above. This reuses the existing managed binary directory (`~/.selesai/agent/bin`) and offline/fail-open behavior.

### Configuration location and schema

- grepai is project-local. `config.Config` stores `Embedder`, `Store`, `Chunking`, `Watch`, `Search`, `Trace`, and other settings. `ConfigDir` is `.grepai`, `ConfigFileName` is `config.yaml`, and `GetConfigPath(projectRoot)` returns `<projectRoot>/.grepai/config.yaml`. [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L14-L18), [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L61-L74), [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L471-L477)
- The embedding block is:

  ```yaml
  embedder:
    provider: openai
    model: <model id>
    endpoint: <OpenAI-compatible base URL>
    api_key: <literal key, optional when OPENAI_API_KEY is present>
    dimensions: <optional integer>
    parallelism: <integer>
  ```

  [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L108-L115)
- `grepai init` supports `--provider`, `--model`, `--backend`, and `--yes`; it writes `.grepai/config.yaml` and adds `.grepai/` to `.gitignore`. [cli/init.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/init.go#L28-L47), [cli/init.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/init.go#L305-L325)
- The file-based store is selected with `store.backend: gob`; grepai's GOB store persists its index under the project `.grepai/` directory. [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L91-L106), [store/gob.go](https://github.com/yoanbernabeu/grepai/blob/main/store/gob.go#L17-L35)

### OpenAI-compatible embedding path and auth

- grepai's `openai` embedder constructs the request URL as `fmt.Sprintf("%s/embeddings", e.endpoint)`, sends JSON `{model,input,dimensions?}`, and sends `Authorization: Bearer <api_key>`. [embedder/openai.go](https://github.com/yoanbernabeu/grepai/blob/main/embedder/openai.go#L156-L179)
- The `openai` embedder accepts a configured `EmbedderConfig.APIKey`; when it is empty it falls back to `OPENAI_API_KEY`. [embedder/openai.go](https://github.com/yoanbernabeu/grepai/blob/main/embedder/openai.go#L112-L145)
- The provider factory has an explicit `openai` branch and passes through model, key, endpoint, parallelism, and optional dimensions. There is no separate `litellm` provider. [embedder/factory.go](https://github.com/yoanbernabeu/grepai/blob/main/embedder/factory.go#L9-L35)

**Selesai implication:** the correct endpoint for the user-provided LiteLLM host is `https://lite.andlet.me/v1`, producing the actual request path `https://lite.andlet.me/v1/embeddings`. Use `provider: openai` and `model: nomic-code`; do not invent a separate embedding model/provider registration in Selesai's `models.json`.

### Watch/search lifecycle

- `grepai watch` performs the initial scan, indexes changed files, and maintains a file watcher; it can run foreground or as a background daemon (`--background`, `--status`, `--stop`). [README.md](https://github.com/yoanbernabeu/grepai/blob/main/README.md#quick-start), [cli/watch.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/watch.go#L57-L95)
- `grepai search` loads the project config, creates the configured embedder, loads the selected vector store, embeds the query, and searches the index. [cli/search.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/search.go#L53-L74), [cli/search.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/search.go#L214-L231)
- No separate Selesai model registration is needed because grepai owns its own embedding HTTP client and project config.
- `grepai watch --background` performs the initial scan before declaring the watcher ready, then monitors create/modify/delete/rename events. Starting this command is the correct way to keep the file-based index current. [cli/watch.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/watch.go#L57-L85), [cli/watch.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/watch.go#L339-L417), [cli/watch.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/watch.go#L1051-L1102)

## TokenIn credential bridge

Selesai stores TokenIn credentials in `auth.json` under provider `tokenin`; the extension/runtime exposes `ModelRegistry.getApiKeyForProvider("tokenin")`, which resolves configured credentials. The grepai integration uses that resolved key and writes it only to `.grepai/config.yaml` with mode `0600`. It never logs or places the key in argv.

A direct `OPENAI_API_KEY` environment fallback is not enough for Selesai: the TokenIn key lives in Selesai auth storage, not the process environment. grepai's upstream config has no documented `$ENV` interpolation for `embedder.api_key`; therefore the integration must materialize the key into the project-local grepai config (which grepai itself treats as a secret-bearing file).

## Dimension note / residual uncertainty

The grepai source defaults OpenAI/OpenRouter dimensions to 1536 when `dimensions` is omitted, but it allows an explicit dimension. [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go#L117-L136)

The user supplied the proxy model id `nomic-code`. The upstream grepai repository does not define that model, and the proxy's model mapping/dimension was not publicly verifiable from the available sources. The implementation uses **768 dimensions**, the expected native width for Nomic code embeddings; verify against the proxy response/model metadata before using a Postgres or Qdrant store. The default GOB store is file-based and does not need a separately declared database collection dimension. A wrong embedding dimension can still make an index inconsistent if the backend is later changed to a database store.

## Implementation decision

1. Provision grepai as a verified managed binary from `yoanbernabeu/grepai` releases, with checksum verification and deferred startup installation.
2. Add a bundled `grepai` extension. It configures an existing project automatically after startup, starts `grepai watch --background` for the initial scan/live updates, and lazily initializes/configures the current project immediately before a config-dependent `grepai` Bash command.
3. Add `/setup-grepai` for explicit setup. It runs `grepai init --provider openai --model nomic-code --backend gob --yes` when needed, patches the embedding block to the LiteLLM endpoint and resolved TokenIn key, and starts the background watcher.
4. Force `store.backend: gob` so the default index remains file-based; preserve unrelated settings and `.grepai/config.yaml` as project-local, enforcing `0600` on writes.
5. `GREPAI_DISABLED=1` disables automatic provisioning; `SELESAI_SKIP_GREPAI_SETUP=1` disables automatic project configuration while leaving the explicit command available.

## Sources

- [grepai repository](https://github.com/yoanbernabeu/grepai)
- [README.md](https://github.com/yoanbernabeu/grepai/blob/main/README.md)
- [config/config.go](https://github.com/yoanbernabeu/grepai/blob/main/config/config.go)
- [embedder/openai.go](https://github.com/yoanbernabeu/grepai/blob/main/embedder/openai.go)
- [embedder/factory.go](https://github.com/yoanbernabeu/grepai/blob/main/embedder/factory.go)
- [cli/init.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/init.go)
- [cli/search.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/search.go)
- [cli/watch.go](https://github.com/yoanbernabeu/grepai/blob/main/cli/watch.go)
- [install.sh](https://github.com/yoanbernabeu/grepai/blob/main/install.sh)
- [install.ps1](https://github.com/yoanbernabeu/grepai/blob/main/install.ps1)
- [.goreleaser.yaml](https://github.com/yoanbernabeu/grepai/blob/main/.goreleaser.yaml)
