# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- Two independent header-building paths exist for OpenAI Responses requests: the HTTP/SSE fallback (`@earendil-works/pi-ai`'s own `openai-responses` client) and this extension's WebSocket path (`src/openai-ws-stream.ts` + `src/openai-ws-connection.ts`). Custom/org/project headers arrive via `options.headers` (`StreamOptions.headers`, `ProviderHeaders`), model-registry headers via `model.headers`. Both paths must merge these in, with the extension's own required identity/session headers (`buildCodexWebSocketHeaders` in `src/remote-compaction.ts`) always winning last so a caller-supplied header can't hijack session routing. WS sessions are cached per `sessionId` in `wsRegistry`; any change to the effective header snapshot must rotate (close + recreate) the cached session, not just the model-key change — see `buildEffectiveWsHeaders`/`computeWsHeaderSnapshot` in `src/openai-ws-stream.ts`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
