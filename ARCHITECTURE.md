# Architecture

This document is a compact map of how the extension works.

It is written for both human readers and code-reading agents that need to answer questions like:

- where is provider payload patching done?
- where is remote compaction called?
- where is state persisted vs cached?
- how do normal turns differ from post-compaction turns?

## Design goal

The package adds **OpenAI-native continuity** to Pi for supported OpenAI-compatible Responses models while still preserving Pi's normal local session semantics.

In practice, that means keeping two representations of context alive at once:

1. **Portable Pi representation**
   - normal Pi session JSONL entries
   - a readable text compaction summary
   - used for Pi features like resume, branch/tree operations, model switching, and non-OpenAI replay

2. **OpenAI-native representation**
   - for direct `openai/*`: `previous_response_id` for live continuation when safe
   - for supported backends: opaque replacement history returned by Responses compaction v2
   - used only for compatible future OpenAI/OpenAI Codex turns

## High-level flow

### Normal supported turn

1. Pi prepares a provider request.
2. `src/index.ts` handles `before_provider_request`.
3. For direct `openai/*`, `src/openai.ts` patches the payload with:
   - `store: true`
   - `context_management`
   - maybe `previous_response_id`
4. For direct `openai/*`, the registered provider override in `src/custom-stream.ts` chooses the custom WS-backed stream.
5. `src/openai-ws-stream.ts` either:
   - sends the request over the OpenAI Responses WebSocket transport, or
   - falls back to Pi's default HTTP Responses streaming path.
6. For `openai-codex/*`, the extension mostly leaves the built-in Codex provider transport alone and only injects reconstructed remote-compaction history when needed.
7. When a compatible assistant message completes, `src/index.ts` records the new `responseId` as continuation state only for the backends that support `previous_response_id`.

### Compaction turn

1. Pi decides to compact or receives an explicit compact command.
2. `src/index.ts` handles `session_before_compact`.
3. In parallel, it tries to:
   - generate a **portable local summary**
   - request Responses compaction v2
4. `src/remote-compaction.ts` converts Pi messages to OpenAI Responses `input` items, appends a `compaction_trigger`, and streams the compaction response from the normal Responses endpoint.
5. If remote compaction succeeds, the returned opaque replacement history is stored in:
   - `CompactionEntry.details.remoteCompaction`
6. Pi still keeps a text summary so the session remains understandable and portable.

### Post-compaction continuation

For later direct OpenAI Responses turns, the extension prefers:

- the persisted/reconstructed remote replacement history, when model-compatible
- otherwise safe live continuation using `previous_response_id`
- otherwise ordinary full-input replay / Pi fallback behavior

## Persisted state vs runtime state

### Persisted in Pi session history

Persisted state lives in the session JSONL file and survives reloads:

- normal Pi `message` entries
- Pi `compaction` entries
- `compaction.details.remoteCompaction`

The persisted `remoteCompaction` payload is the important bridge to Codex-style behavior. Version 2 contains retained user messages plus the opaque `compaction` item returned by Responses compaction v2. Version 1 entries from the legacy `/responses/compact` implementation remain readable for session compatibility.

### Runtime-only state

Runtime-only state lives in memory and is rebuilt when needed:

- latest safe `responseId` for incremental continuation
- reconstructed remote compaction replay state for the active session
- active WebSocket session manager(s)

This state is managed by:

- `src/state.ts`
- `src/openai-ws-stream.ts`
- `src/index.ts`

## Key modules

### `src/index.ts`

The orchestration layer.

Responsibilities:
- register the custom provider override
- patch outgoing provider payloads
- hook into Pi compaction lifecycle
- merge local and remote compaction results
- reconstruct remote state on session start/tree/compaction, before requests, and before subsequent compactions
- clear ephemeral state on switch/fork/tree/model/thinking-level/shutdown

If you want to understand the extension as a whole, start here.

### `src/remote-compaction.ts`

The Codex-style compaction layer.

Responsibilities:
- convert Pi messages to OpenAI Responses-style input items
- call `POST /v1/responses` with a trailing `compaction_trigger`
- parse the Responses SSE stream and validate the returned `compaction` item
- retain recent user messages using Codex's 20K-token budget shape
- build portable text summaries
- rebuild replayable remote state from persisted compaction entries

This file is the core of the actual compaction-boundary behavior.

### `src/openai-ws-stream.ts`

The custom stream implementation.

Responsibilities:
- decide between WS path and HTTP fallback
- reuse a live WebSocket session when safe
- send incremental post-turn deltas for direct OpenAI continuation when request shape is unchanged
- replay remote compaction history when available
- delegate tool conversion and WS stream decoding to Pi's native Responses helpers (including grammar tools and namespaces)
- compute usage/cost information for the WS path

### `src/openai-ws-connection.ts`

A thin OpenAI Responses WebSocket client.

Responsibilities:
- connect/authenticate
- emit parsed events
- remember latest completed `response.id`
- reconnect defensively

### `src/openai.ts`

Shared provider-specific helpers.

Responsibilities:
- identify direct OpenAI vs Azure OpenAI vs OpenAI Codex models
- build stable model keys
- patch Responses payloads
- extract assistant `responseId`

### `src/config.ts`

Loads and normalizes configuration from:

- `~/.pi/agent/openai-server-compaction.json`
- `.pi/openai-server-compaction.json`
- environment variables

### `src/state.ts`

Stores ephemeral per-session runtime state only.

It does **not** persist remote compaction artifacts itself. Those live in Pi session entries.

### `src/custom-stream.ts`

Small dispatch layer that enables the custom WS-backed stream only for direct OpenAI Responses models.

### `src/stream-message-shared.ts`

Shared message constructors used by the stream path so generated assistant messages match what Pi expects.

## Safety model

The extension intentionally avoids reusing provider-native continuity blindly.

Important safety rules:

- remote replacement history is only reused for compatible OpenAI/OpenAI Codex Responses models
- remote history is reconstructed from the persisted branch, including custom context, branch summaries, and unanswered turns
- reconstructed remote history only replays post-compaction turns whose assistant completions match the compaction model, avoiding cross-model pollution after resume/tree reload
- live `previous_response_id` state is cleared on key session/model lifecycle boundaries
- HTTP fallback remains available if the WS path is unavailable or unsafe
- remote replay replaces conversation items, not Pi's input-embedded tool declarations, system/developer instructions, or reasoning configuration
- direct WS requests read current tools and instructions from Pi 1.4 transcript system messages rather than obsolete `context.tools`/`context.systemPrompt` fields

## Why both local summary and remote compaction exist

A common question is: why not use only the OpenAI-native opaque artifact?

Because Pi still needs local, explicit state for:

- session tree and branch semantics
- readable/exportable session history
- reload/resume behavior that still makes sense outside one provider
- switching away from OpenAI-compatible models

So the package is intentionally hybrid:

- **Pi summary for portability and Pi semantics**
- **OpenAI opaque history for better continuity on compatible later turns**

## Testing strategy

### Runtime smoke

- `npm run smoke`

Verifies imports/loadability plus offline regression checks over exported pure helpers (state clearing, compaction outcome resolution, WebSocket header merge/rotation) and over extension event wiring (the compaction progress status/success-notification lifecycle registered on `session_before_compact` and `session_compact`).

It also enforces the loader constraint that shipped 0.2.0 broken: Pi resolves an extension's `@earendil-works/*` imports through a fixed allowlist (`VIRTUAL_MODULES`: the package roots plus `pi-ai/compat`, `/models`, `/oauth`, `/providers/all`), so any other host subpath must come from a physical `dependencies` copy or the extension throws at session start. The check fails on such an import, because importing the entrypoint from this repository cannot see the difference - `node_modules` here resolves the deep path regardless.

### Pi 1.4 regression suite

`npm test` also runs `tests/*.test.mjs`: actual Pi request serialization, local HTTP/WS SDK sessions, dynamic tool updates, grammar tool replay, idle custom-context preservation, repeated compaction/resume, and the live harness's request ceiling. Offline tests fix extension configuration explicitly and intercept HTTP at the network boundary.

`npm run test:live:tools` checks real JSON and grammar tool execution across two native compactions and a reopened session with synthetic context only. It is opt-in, not CI. The live backend and remaining limitations are recorded in `VALIDATION.md`.

### Live end-to-end test

- `npm run test:live`

Implemented in:
- `tests/live/openai-compaction-rpc-live.ts`

This is a black-box integration test that drives real `pi --mode rpc` sessions and validates:

- same-session continuity after compaction
- model switch away and back
- fork after compaction
- resume/reload after compaction

### Controlled native-vs-text benchmark

The reproducible benchmark, retained evidence, and standalone report live under:
- `benchmarks/native-vs-text/`

## Suggested reading order

If you are new to the repo, read in this order:

1. `README.md`
2. `ARCHITECTURE.md`
3. `src/index.ts`
4. `src/remote-compaction.ts`
5. `src/openai-ws-stream.ts`
6. `tests/live/openai-compaction-rpc-live.ts`
