# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- Two independent header-building paths exist for OpenAI Responses requests: the HTTP/SSE fallback (`@earendil-works/pi-ai`'s own `openai-responses` client, plus this repo's `buildRemoteCompactionHeaders` in `src/remote-compaction.ts`) and this extension's WebSocket path (`src/openai-ws-stream.ts` + `src/openai-ws-connection.ts`). Custom/org/project headers arrive via `options.headers` (`StreamOptions.headers`, `ProviderHeaders`), model-registry headers via `model.headers`. Both paths must merge these in. The two paths currently differ on precedence, and the difference is deliberate to note, not to assume away: the WS path applies the required identity/session headers (`buildCodexWebSocketHeaders`) last so a caller header can never hijack session routing, and `createSocket` applies `Authorization`/`OpenAI-Beta` last for the same reason; `buildRemoteCompactionHeaders` still spreads `params.headers` *after* `buildCodexIdentityHeaders`, so a caller header can override `session_id`/`x-codex-window-id` there. Treat required-headers-win as the target convention and check, don't assume, before relying on it on the HTTP side.
- WS sessions are cached per `sessionId` in `wsRegistry`; the cached session must rotate (close + recreate) whenever the effective header set changes, not only on a model-key change — see `buildEffectiveWsHeaders`/`computeWsHeaderSnapshot` in `src/openai-ws-stream.ts`. The rotation snapshot deliberately covers only caller-derived headers (model + manager + request): the required Codex headers derive from `sessionId`, which already keys the registry, and `x-codex-installation-id` is regenerated per call when the id file cannot be read or written, so snapshotting it would rebuild the socket on every request.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
