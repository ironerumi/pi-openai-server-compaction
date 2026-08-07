import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localNodeModules = join(repoRoot, "node_modules");

function packagePathSegments(packageName) {
  return packageName.split("/");
}

function npmGlobalRoot() {
  try {
    return execFileSync("npm", ["root", "-g"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function candidateRoots() {
  const roots = new Set();
  roots.add(localNodeModules);

  const globalRoot = npmGlobalRoot();
  if (globalRoot) roots.add(globalRoot);

  const voltaPiRoot = join(
    homedir(),
    ".volta",
    "tools",
    "image",
    "packages",
    "@earendil-works",
    "pi-coding-agent",
    "lib",
    "node_modules",
  );
  roots.add(voltaPiRoot);
  roots.add(join(voltaPiRoot, "@earendil-works", "pi-coding-agent", "node_modules"));

  return [...roots];
}

function resolveInstalledPackageDir(packageName) {
  const segments = packagePathSegments(packageName);
  for (const root of candidateRoots()) {
    const dir = join(root, ...segments);
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      return dir;
    }
  }
  return undefined;
}

function ensureLocalPeerLink(packageName) {
  const localDir = join(localNodeModules, ...packagePathSegments(packageName));
  if (existsSync(join(localDir, "package.json"))) {
    return;
  }

  const targetDir = resolveInstalledPackageDir(packageName);
  if (!targetDir) {
    throw new Error(
      `Unable to locate peer dependency ${packageName}. Install Pi or add the package locally before running smoke.`,
    );
  }

  mkdirSync(dirname(localDir), { recursive: true });
  if (existsSync(localDir)) {
    const stat = lstatSync(localDir);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      rmSync(localDir, { recursive: true, force: true });
    }
  }
  symlinkSync(targetDir, localDir, "dir");
}

for (const packageName of [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
]) {
  ensureLocalPeerLink(packageName);
}

const {
  default: extensionFactory,
  resolveCompactionOutcome,
} = await import(pathToFileURL(join(repoRoot, "src", "index.ts")).href);
assert.equal(typeof extensionFactory, "function", "extension entrypoint should export a function");

const {
  buildCodexWebSocketHeaders,
  buildRemoteCompactionHeaders,
  buildRemoteCompactionDetails,
  buildRemoteCompactionRequestBody,
  buildRemoteCompactionV2History,
  extractRemoteCompactionDetails,
  normalizeResponseItemsForPrompt,
  parseRemoteCompactionV2Events,
  processCompactedHistory,
  reconstructRemoteCompactionStateFromBranch,
  remoteCompactionV2EndpointUrl,
} = await import(pathToFileURL(join(repoRoot, "src", "remote-compaction.ts")).href);
const {
  selectInputItemsForContinuation,
  buildEffectiveWsHeaders,
  computeWsHeaderSnapshot,
  resolveResponsesReasoning,
} = await import(pathToFileURL(join(repoRoot, "src", "openai-ws-stream.ts")).href);
const { getResponsesRequestShapeState, setResponsesRequestShapeState } = await import(
  pathToFileURL(join(repoRoot, "src", "state.ts")).href
);
const {
  thinkingLevelToResponsesReasoning,
} = await import(pathToFileURL(join(repoRoot, "src", "openai.ts")).href);
const { loadConfig } = await import(pathToFileURL(join(repoRoot, "src", "config.ts")).href);

const targetModelKey = "openai:openai-responses:gpt-5.4-nano";
const reconstructed = reconstructRemoteCompactionStateFromBranch({
  branchEntries: [
    {
      type: "compaction",
      id: "cmp-1",
      details: {
        remoteCompaction: {
          version: 1,
          provider: "openai-responses-compact",
          modelKey: targetModelKey,
          replacementHistory: [
            {
              type: "compaction",
              encrypted_content: "ENCRYPTED",
            },
          ],
        },
      },
    },
    {
      type: "message",
      id: "user-a1",
      message: {
        role: "user",
        content: [{ type: "text", text: "KEEP_ME_ONE" }],
      },
    },
    {
      type: "message",
      id: "assistant-a1",
      message: {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5.4-nano",
        content: [{ type: "text", text: "KEEP_REPLY_ONE" }],
      },
    },
    {
      type: "message",
      id: "user-b1",
      message: {
        role: "user",
        content: [{ type: "text", text: "DROP_ME" }],
      },
    },
    {
      type: "message",
      id: "assistant-b1",
      message: {
        role: "assistant",
        provider: "anthropic",
        api: "anthropic-messages",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "DROP_REPLY" }],
      },
    },
    {
      type: "message",
      id: "user-a2",
      message: {
        role: "user",
        content: [{ type: "text", text: "KEEP_ME_TWO" }],
      },
    },
    {
      type: "message",
      id: "assistant-a2",
      message: {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5.4-nano",
        content: [{ type: "text", text: "KEEP_REPLY_TWO" }],
      },
    },
  ],
});
assert.ok(reconstructed, "expected reconstructed remote compaction state");
const reconstructedJson = JSON.stringify(reconstructed.explicitHistory);
assert.match(reconstructedJson, /KEEP_ME_ONE/);
assert.match(reconstructedJson, /KEEP_REPLY_ONE/);
assert.match(reconstructedJson, /KEEP_ME_TWO/);
assert.match(reconstructedJson, /KEEP_REPLY_TWO/);
assert.doesNotMatch(reconstructedJson, /DROP_ME/);
assert.doesNotMatch(reconstructedJson, /DROP_REPLY/);

const requestBody = buildRemoteCompactionRequestBody({
  model: {
    id: "gpt-5.4-nano",
  },
  input: [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
  instructions: "system",
  tools: [{ type: "function", name: "read" }],
  parallelToolCalls: true,
  reasoning: { effort: "high", summary: "auto" },
  text: { verbosity: "medium" },
});
assert.equal(requestBody.model, "gpt-5.4-nano");
assert.equal(requestBody.stream, true);
assert.equal(requestBody.store, false);
assert.equal(requestBody.tool_choice, "auto");
assert.deepEqual(requestBody.include, ["reasoning.encrypted_content"]);
assert.deepEqual(requestBody.input.at(-1), { type: "compaction_trigger" });
assert.deepEqual(requestBody.reasoning, { effort: "high", summary: "auto" });
assert.deepEqual(requestBody.text, { verbosity: "medium" });
assert.equal(
  remoteCompactionV2EndpointUrl({
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  }),
  "https://api.openai.com/v1/responses",
);
assert.equal(
  remoteCompactionV2EndpointUrl({
    provider: "openai-codex",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
  }),
  "https://chatgpt.com/backend-api/codex/responses",
);

const parsedV2Events = parseRemoteCompactionV2Events([
  {
    type: "response.output_item.done",
    item: { type: "compaction", encrypted_content: "V2_ENCRYPTED" },
  },
  {
    type: "response.completed",
    response: { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
  },
]);
assert.equal(parsedV2Events.compactionItem.type, "compaction");
const v2History = buildRemoteCompactionV2History(
  [
    { type: "message", role: "user", content: [{ type: "input_text", text: "retain user" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "summarize assistant" }] },
  ],
  parsedV2Events.compactionItem,
);
assert.deepEqual(v2History.map((item) => item.type), ["message", "compaction"]);
assert.equal(v2History[0].role, "user");

const normalizedPromptItems = normalizeResponseItemsForPrompt(
  [
    { type: "ghost_snapshot", data: "hidden" },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
    },
    { type: "function_call", name: "read", call_id: "call-1", arguments: "{}" },
    { type: "function_call_output", call_id: "orphan", output: "drop" },
    { type: "image_generation_call", result: "base64" },
  ],
  { input: ["text"] },
);
assert.equal(normalizedPromptItems[0].type, "message");
assert.deepEqual(normalizedPromptItems[0].content, [
  { type: "input_text", text: "image content omitted because you do not support image input" },
]);
assert.deepEqual(normalizedPromptItems[2], {
  type: "function_call_output",
  call_id: "call-1",
  output: "aborted",
});
assert.equal(normalizedPromptItems[3].result, "");
assert.doesNotMatch(JSON.stringify(normalizedPromptItems), /orphan|ghost_snapshot/);

const compactedHistory = processCompactedHistory([
  { type: "message", role: "developer", content: [{ type: "input_text", text: "drop developer" }] },
  { type: "message", role: "user", content: [] },
  { type: "message", role: "user", content: [{ type: "input_text", text: "keep user" }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "keep assistant" }] },
  { type: "function_call", name: "read", call_id: "call-2", arguments: "{}" },
  { type: "compaction", encrypted_content: "keep" },
]);
assert.deepEqual(compactedHistory.map((item) => item.type), ["message", "message", "compaction"]);
assert.equal(compactedHistory[0].role, "user");
assert.equal(compactedHistory[1].role, "assistant");

const compactionHeaders = buildRemoteCompactionHeaders({
  model: {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.4-nano",
  },
  apiKey: "sk-test",
  sessionId: "session-123",
  headers: { "x-extra": "yes" },
});
assert.equal(compactionHeaders.authorization, "Bearer sk-test");
assert.equal(compactionHeaders.session_id, "session-123");
assert.equal(compactionHeaders["x-codex-window-id"], "session-123:0");
assert.match(compactionHeaders["x-codex-installation-id"], /^[0-9a-f-]{36}$/);
assert.equal(compactionHeaders["x-extra"], "yes");
assert.equal(compactionHeaders["x-codex-beta-features"], "remote_compaction_v2");
assert.equal(compactionHeaders.accept, "text/event-stream");

const websocketHeaders = buildCodexWebSocketHeaders("session-123");
assert.equal(websocketHeaders["x-client-request-id"], "session-123");
assert.equal(websocketHeaders.session_id, "session-123");
assert.equal(websocketHeaders["x-codex-window-id"], "session-123:0");

// Custom, organization, project, and model-registry headers must reach the
// WebSocket handshake alongside the extension's required Codex headers.
const { headers: wsEffectiveHeaders } = buildEffectiveWsHeaders({
  sessionId: "session-123",
  modelHeaders: { "openai-organization": "org-registry", "x-model-registry": "from-registry" },
  managerHeaders: { "openai-beta-extra": "manager-default" },
  requestHeaders: {
    "openai-organization": "org-override",
    "openai-project": "proj-456",
    "x-custom-header": "custom-value",
  },
});
assert.equal(wsEffectiveHeaders["x-model-registry"], "from-registry");
assert.equal(wsEffectiveHeaders["openai-organization"], "org-override");
assert.equal(wsEffectiveHeaders["openai-project"], "proj-456");
assert.equal(wsEffectiveHeaders["x-custom-header"], "custom-value");
assert.equal(wsEffectiveHeaders["openai-beta-extra"], "manager-default");
// Required built-in headers stay correct even when a custom header tries to
// clobber the same key.
assert.equal(wsEffectiveHeaders["x-client-request-id"], "session-123");
assert.equal(wsEffectiveHeaders.session_id, "session-123");
assert.equal(wsEffectiveHeaders["x-codex-window-id"], "session-123:0");
assert.match(wsEffectiveHeaders["x-codex-installation-id"], /^[0-9a-f-]{36}$/);

const { headers: wsHeadersWithHijackAttempt } = buildEffectiveWsHeaders({
  sessionId: "session-123",
  requestHeaders: { session_id: "attacker-session", "x-client-request-id": "attacker-session" },
});
assert.equal(wsHeadersWithHijackAttempt.session_id, "session-123");
assert.equal(wsHeadersWithHijackAttempt["x-client-request-id"], "session-123");

// A null request header suppresses a same-named default instead of sending
// the literal string "null" over the wire.
const { headers: wsHeadersWithSuppression } = buildEffectiveWsHeaders({
  sessionId: "session-123",
  managerHeaders: { "x-drop-me": "should-be-suppressed" },
  requestHeaders: { "x-drop-me": null },
});
assert.equal("x-drop-me" in wsHeadersWithSuppression, false);

// A changed effective header snapshot must not resolve to the same value as
// the prior snapshot, so a cached WebSocket session gets rotated rather than
// reused with stale/leaked headers.
const { snapshot: snapshotBefore } = buildEffectiveWsHeaders({
  sessionId: "session-123",
  requestHeaders: { "x-org": "org-a" },
});
const { snapshot: snapshotAfterOrgChange } = buildEffectiveWsHeaders({
  sessionId: "session-123",
  requestHeaders: { "x-org": "org-b" },
});
assert.notEqual(snapshotBefore, snapshotAfterOrgChange);
// The snapshot must exclude the required Codex headers: x-codex-installation-id
// is regenerated per call when the id file cannot be persisted, which would
// otherwise rotate the cached session on every request.
assert.equal(snapshotBefore.includes("x-codex-installation-id"), false);
assert.equal(snapshotBefore.includes("session-123"), false);
const { snapshot: snapshotSameHeadersRepeated } = buildEffectiveWsHeaders({
  sessionId: "session-456",
  requestHeaders: { "x-org": "org-a" },
});
assert.equal(snapshotBefore, snapshotSameHeadersRepeated);
assert.equal(
  computeWsHeaderSnapshot({ "x-b": "2", "x-a": "1" }),
  computeWsHeaderSnapshot({ "x-a": "1", "x-b": "2" }),
);

const detailsRoundTrip = extractRemoteCompactionDetails({
  remoteCompaction: buildRemoteCompactionDetails(
    {
      provider: "openai",
      api: "openai-responses",
      id: "gpt-5.4-nano",
    },
    [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
    {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    },
  ),
});
assert.ok(detailsRoundTrip, "expected remote compaction details round trip");
assert.equal(detailsRoundTrip.usage?.cacheWrite, 40);
assert.equal(detailsRoundTrip.usage?.cost.total, 10);

const incrementalInput = selectInputItemsForContinuation({
  context: {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "old user" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "old assistant" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "new user" }],
      },
    ],
  },
  model: { input: ["text"] },
  session: { lastContextLength: 2 },
  currentModelKey: targetModelKey,
  remoteCompactionState: undefined,
  previousResponseId: "resp_123",
});
assert.deepEqual(incrementalInput, [
  {
    type: "message",
    role: "user",
    content: "new user",
  },
]);

const registeredHandlers = {};
extensionFactory({
  registerProvider() {},
  on(eventName, handler) {
    registeredHandlers[eventName] = handler;
  },
});
const modelSwitchSessionId = "session-model-switch-test";
setResponsesRequestShapeState(modelSwitchSessionId, {
  updatedAt: 1,
  reasoning: { effort: "high", summary: "auto" },
  text: { verbosity: "medium" },
});
assert.ok(
  getResponsesRequestShapeState(modelSwitchSessionId),
  "expected request shape to be cached before model switch",
);
registeredHandlers.model_select(undefined, {
  sessionManager: {
    getSessionId: () => modelSwitchSessionId,
    getBranch: () => [],
  },
});
assert.equal(
  getResponsesRequestShapeState(modelSwitchSessionId),
  undefined,
  "model switch must clear cached request shape so an immediate compaction cannot reuse the previous model's reasoning/text config",
);

const thinkingSwitchSessionId = "session-thinking-switch-test";
setResponsesRequestShapeState(thinkingSwitchSessionId, {
  updatedAt: 1,
  reasoning: { effort: "high", summary: "auto" },
  text: { verbosity: "medium" },
});
registeredHandlers.thinking_level_select(
  { type: "thinking_level_select", level: "low", previousLevel: "high" },
  {
    sessionManager: {
      getSessionId: () => thinkingSwitchSessionId,
      getBranch: () => [],
    },
  },
);
assert.equal(
  getResponsesRequestShapeState(thinkingSwitchSessionId)?.reasoning,
  undefined,
  "thinking level switch must drop the cached reasoning config so an immediate compaction cannot reuse the previous level's effort",
);
assert.deepEqual(
  getResponsesRequestShapeState(thinkingSwitchSessionId)?.text,
  { verbosity: "medium" },
  "thinking level switch must keep the level-independent cached text config so compaction still mirrors surrounding requests",
);

// --- a thinking-level change must invalidate the cached request shape so an
// immediate /compact uses the newly selected level, not the previous one ---
{
  const compactHandlers = {};
  const capturedBodies = [];
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return "low"; },
  });

  const reasoningModel = {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.4-nano",
    input: ["text"],
    reasoning: true,
    thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high" },
  };
  const compactCtx = {
    hasUI: false,
    cwd: repoRoot,
    ui: { notify() {}, setStatus() {} },
    model: reasoningModel,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }) },
    getSystemPrompt: () => "system prompt",
    sessionManager: { getSessionId: () => "sess-thinking-change", getBranch: () => [] },
  };

  const remoteCompactionSse =
    'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"SMOKE_ENCRYPTED"}}\n\n' +
    'data: {"type":"response.completed","response":{}}\n\n' +
    "data: [DONE]\n\n";
  const isRemoteCompactionRequest = (init) =>
    typeof init?.body === "string" && init.body.includes("compaction_trigger");

  const originalFetch = globalThis.fetch;
  const originalEnabledEnv = process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = "true";

    // A completed request at "high" caches its Responses reasoning/text shape.
    compactHandlers.before_provider_request(
      {
        type: "before_provider_request",
        payload: {
          model: "gpt-5.4-nano",
          input: [{ role: "user", content: "hello" }],
          reasoning: { effort: "high", summary: "auto" },
          text: { verbosity: "high" },
        },
      },
      compactCtx,
    );

    // The user switches thinking to "low" before the next model turn; pi emits
    // thinking_level_select for this.
    compactHandlers.thinking_level_select?.(
      { type: "thinking_level_select", level: "low", previousLevel: "high" },
      compactCtx,
    );

    globalThis.fetch = async (_url, init) => {
      if (!isRemoteCompactionRequest(init)) throw new Error("smoke: local summary model call is not stubbed");
      capturedBodies.push(JSON.parse(init.body));
      return new Response(remoteCompactionSse, { status: 200 });
    };

    const outcome = await compactHandlers.session_before_compact(
      {
        type: "session_before_compact",
        branchEntries: [],
        preparation: { firstKeptEntryId: "entry-1", tokensBefore: 1234 },
        signal: new AbortController().signal,
      },
      compactCtx,
    );
    assert.ok(
      outcome?.compaction?.details?.remoteCompaction,
      "remote compaction should produce remote details after a thinking-level change",
    );
    assert.equal(capturedBodies.length, 1, "the remote compaction endpoint should be called exactly once");
    assert.deepEqual(
      capturedBodies[0].reasoning,
      { effort: "low", summary: "auto" },
      "compaction after a thinking-level change must use the newly selected level, not the cached shape from the previous level",
    );
    assert.deepEqual(
      capturedBodies[0].text,
      { verbosity: "high" },
      "compaction after a thinking-level change must still mirror the cached, level-independent text config",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabledEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
    else process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = originalEnabledEnv;
  }
}

// "max" thinking level: a model that only maps it to an existing effort tier still gets that tier.
const maxToXhighModel = {
  reasoning: true,
  provider: "openai",
  thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
};
assert.deepEqual(
  thinkingLevelToResponsesReasoning(maxToXhighModel, "max"),
  { effort: "xhigh", summary: "auto" },
  "max should clamp down to the model's highest mapped tier, not disappear",
);

// "max" thinking level: a model with a native max tier passes it through untouched.
const nativeMaxModel = {
  reasoning: true,
  provider: "openai",
  thinkingLevelMap: { off: "none", high: "high", xhigh: "xhigh", max: "max" },
};
assert.deepEqual(
  thinkingLevelToResponsesReasoning(nativeMaxModel, "max"),
  { effort: "max", summary: "auto" },
  "max should pass through for models that natively support it",
);

// Clamping also applies to "xhigh" for models that don't support it.
const noXhighModel = {
  reasoning: true,
  provider: "openai",
  thinkingLevelMap: { off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high" },
};
assert.deepEqual(
  thinkingLevelToResponsesReasoning(noXhighModel, "xhigh"),
  { effort: "high", summary: "auto" },
  "xhigh should clamp down to high when a model has no xhigh mapping",
);

// The default WebSocket path must not degrade an unmapped "max" request to "none".
assert.deepEqual(
  resolveResponsesReasoning(maxToXhighModel, { reasoning: "max" }),
  { effort: "xhigh", summary: "auto" },
  "WebSocket path should clamp max instead of dropping it to none",
);

// Model-specific "off" mapping: an explicit off effort is sent when reasoning is unset.
assert.deepEqual(
  resolveResponsesReasoning(maxToXhighModel, {}),
  { effort: "none" },
  "unset reasoning should use the model's mapped off effort",
);

// Model-specific "off" mapping: off: null means no reasoning field is sent at all.
const noOffFieldModel = {
  reasoning: true,
  provider: "some-other-provider",
  thinkingLevelMap: { off: null, high: "high" },
};
assert.equal(
  resolveResponsesReasoning(noOffFieldModel, {}),
  undefined,
  "off: null should omit the reasoning field entirely",
);

// Existing GitHub Copilot behavior: never send a reasoning field when unset, regardless of off mapping.
const copilotModel = {
  reasoning: true,
  provider: "github-copilot",
  thinkingLevelMap: { off: "none", high: "high" },
};
assert.equal(
  resolveResponsesReasoning(copilotModel, {}),
  undefined,
  "GitHub Copilot should never receive an explicit off reasoning field",
);

// --- ordinary provider requests produce no compaction notification ---
{
  const notifyCalls = [];
  const statusCalls = [];
  const testHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { testHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const testModel = {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.4-nano",
    input: ["text"],
  };
  const testCtx = {
    hasUI: true,
    cwd: repoRoot,
    ui: {
      notify: (msg, level) => notifyCalls.push({ msg, level }),
      setStatus: (key, text) => statusCalls.push({ key, text }),
    },
    model: testModel,
    sessionManager: {
      getSessionId: () => "sess-provider-req",
      getBranch: () => [],
    },
  };

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  const originalEnabledEnv = process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";
    process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = "true";
    const patched = testHandlers.before_provider_request(
      {
        type: "before_provider_request",
        payload: { model: "gpt-5.4-nano", input: [{ role: "user", content: "hello" }] },
      },
      testCtx,
    );
    assert.ok(patched, "the request handler must have run its full patch path, not returned early");
    assert.ok(
      Array.isArray(patched.context_management),
      "expected the patched payload that proves the handler reached the end of the request path",
    );
    assert.equal(notifyCalls.length, 0, "ordinary provider request must not emit a compaction notification");
    assert.equal(statusCalls.length, 0, "ordinary provider request must not set compaction status");
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
    if (originalEnabledEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
    else process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = originalEnabledEnv;
  }
}

// --- session_compact with fromExtension + valid remote details emits success ---
{
  const notifyCalls = [];
  const compactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const validRemoteDetails = buildRemoteCompactionDetails(
    { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
    [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
  );

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";

    compactHandlers.session_compact(
      {
        type: "session_compact",
        compactionEntry: {
          type: "compaction", id: "cmp-1", summary: "test",
          firstKeptEntryId: "e-1", tokensBefore: 100,
          details: { remoteCompaction: validRemoteDetails },
        },
        fromExtension: true,
        reason: "threshold",
        willRetry: false,
      },
      {
        hasUI: true,
        cwd: repoRoot,
        ui: { notify: (msg, level) => notifyCalls.push({ msg, level }), setStatus() {} },
        model: { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
        sessionManager: { getSessionId: () => "sess-compact-ok", getBranch: () => [] },
      },
    );
    assert.equal(notifyCalls.length, 1, "fromExtension + valid remote details should emit exactly one success notification");
    assert.equal(notifyCalls[0].level, "info");
    assert.match(notifyCalls[0].msg, /remote compaction applied/i);
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
  }
}

// --- session_compact without fromExtension emits no success notification ---
{
  const notifyCalls = [];
  const compactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";

    compactHandlers.session_compact(
      {
        type: "session_compact",
        compactionEntry: {
          type: "compaction", id: "cmp-2", summary: "pi default",
          firstKeptEntryId: "e-2", tokensBefore: 200,
          details: {},
        },
        fromExtension: false,
        reason: "threshold",
        willRetry: false,
      },
      {
        hasUI: true,
        cwd: repoRoot,
        ui: { notify: (msg, level) => notifyCalls.push({ msg, level }), setStatus() {} },
        model: { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
        sessionManager: { getSessionId: () => "sess-compact-noext", getBranch: () => [] },
      },
    );
    assert.equal(notifyCalls.length, 0, "local/default compaction (fromExtension=false) must not emit remote-success notification");
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
  }
}

// --- session_compact with fromExtension but no valid remote details emits no success ---
{
  const notifyCalls = [];
  const compactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";

    compactHandlers.session_compact(
      {
        type: "session_compact",
        compactionEntry: {
          type: "compaction", id: "cmp-3", summary: "local fallback only",
          firstKeptEntryId: "e-3", tokensBefore: 300,
          details: { localSummaryDetails: { something: true } },
        },
        fromExtension: true,
        reason: "threshold",
        willRetry: false,
      },
      {
        hasUI: true,
        cwd: repoRoot,
        ui: { notify: (msg, level) => notifyCalls.push({ msg, level }), setStatus() {} },
        model: { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
        sessionManager: { getSessionId: () => "sess-compact-noremote", getBranch: () => [] },
      },
    );
    assert.equal(notifyCalls.length, 0, "fromExtension with no valid remote details (local fallback) must not emit remote-success notification");
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
  }
}

// --- disabled notify suppresses success notification even on valid remote compaction ---
{
  const notifyCalls = [];
  const compactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const validRemoteDetails = buildRemoteCompactionDetails(
    { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
    [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
  );

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "false";

    compactHandlers.session_compact(
      {
        type: "session_compact",
        compactionEntry: {
          type: "compaction", id: "cmp-4", summary: "test",
          firstKeptEntryId: "e-4", tokensBefore: 100,
          details: { remoteCompaction: validRemoteDetails },
        },
        fromExtension: true,
        reason: "threshold",
        willRetry: false,
      },
      {
        hasUI: true,
        cwd: repoRoot,
        ui: { notify: (msg, level) => notifyCalls.push({ msg, level }), setStatus() {} },
        model: { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
        sessionManager: { getSessionId: () => "sess-compact-nonotify", getBranch: () => [] },
      },
    );
    assert.equal(notifyCalls.length, 0, "notify:false must suppress success notification");
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
  }
}

// --- absent UI suppresses success notification ---
{
  const notifyCalls = [];
  const compactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { compactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const validRemoteDetails = buildRemoteCompactionDetails(
    { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
    [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
  );

  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";

    compactHandlers.session_compact(
      {
        type: "session_compact",
        compactionEntry: {
          type: "compaction", id: "cmp-5", summary: "test",
          firstKeptEntryId: "e-5", tokensBefore: 100,
          details: { remoteCompaction: validRemoteDetails },
        },
        fromExtension: true,
        reason: "threshold",
        willRetry: false,
      },
      {
        hasUI: false,
        cwd: repoRoot,
        ui: { notify: (msg, level) => notifyCalls.push({ msg, level }), setStatus() {} },
        model: { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" },
        sessionManager: { getSessionId: () => "sess-compact-noui", getBranch: () => [] },
      },
    );
    assert.equal(notifyCalls.length, 0, "absent UI (hasUI=false) must suppress success notification");
  } finally {
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
  }
}

// --- session_before_compact sets a transient status and clears it on every exit path ---
{
  const beforeCompactHandlers = {};
  extensionFactory({
    registerProvider() {},
    on(eventName, handler) { beforeCompactHandlers[eventName] = handler; },
    getAllTools() { return []; },
    getActiveTools() { return []; },
    getThinkingLevel() { return undefined; },
  });

  const compactionModel = {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.4-nano",
    input: ["text"],
  };

  const makeCompactCtx = (statusCalls, notifyCalls, overrides = {}) => ({
    hasUI: true,
    cwd: repoRoot,
    ui: {
      notify: (msg, level) => notifyCalls.push({ msg, level }),
      setStatus: (key, text) => statusCalls.push({ key, text }),
    },
    model: compactionModel,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }) },
    getSystemPrompt: () => "system prompt",
    sessionManager: { getSessionId: () => "sess-before-compact", getBranch: () => [] },
    ...overrides,
  });

  const compactEvent = {
    type: "session_before_compact",
    branchEntries: [],
    preparation: { firstKeptEntryId: "entry-1", tokensBefore: 1234 },
    signal: new AbortController().signal,
  };

  // The local-summary leg is intentionally left to fail; only the remote leg is
  // stubbed, so the status lifecycle is what these assertions pin down.
  const remoteCompactionSse =
    'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"SMOKE_ENCRYPTED"}}\n\n' +
    'data: {"type":"response.completed","response":{}}\n\n' +
    "data: [DONE]\n\n";
  const isRemoteCompactionRequest = (init) =>
    typeof init?.body === "string" && init.body.includes("compaction_trigger");

  const originalFetch = globalThis.fetch;
  const originalNotifyEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  const originalEnabledEnv = process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";
    process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = "true";

    globalThis.fetch = async (_url, init) => {
      if (!isRemoteCompactionRequest(init)) throw new Error("smoke: local summary model call is not stubbed");
      return new Response(remoteCompactionSse, { status: 200 });
    };
    const okStatus = [];
    const okNotify = [];
    const outcome = await beforeCompactHandlers.session_before_compact(
      compactEvent,
      makeCompactCtx(okStatus, okNotify),
    );
    assert.ok(outcome?.compaction?.details?.remoteCompaction, "remote compaction should produce remote details");
    assert.equal(okStatus.length, 2, "status must be set once and cleared once on the success path");
    assert.equal(okStatus[0].key, okStatus[1].key, "set and clear must use the same status key");
    assert.match(okStatus[0].text, /remote compaction in progress/i);
    assert.equal(okStatus[1].text, undefined, "status must be cleared after a successful remote compaction");

    globalThis.fetch = async () => { throw new Error("smoke: remote compaction endpoint unreachable"); };
    const failStatus = [];
    const failNotify = [];
    await beforeCompactHandlers.session_before_compact(compactEvent, makeCompactCtx(failStatus, failNotify));
    assert.equal(failStatus.length, 2, "status must be set once and cleared once on the failure path");
    assert.equal(failStatus[0].key, failStatus[1].key);
    assert.match(failStatus[0].text, /remote compaction in progress/i);
    assert.equal(failStatus[1].text, undefined, "finally must clear the status when remote compaction throws");

    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "false";
    const quietStatus = [];
    const quietNotify = [];
    await beforeCompactHandlers.session_before_compact(compactEvent, makeCompactCtx(quietStatus, quietNotify));
    assert.equal(quietStatus.length, 0, "notify:false must not write a footer status");

    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";
    const headlessStatus = [];
    const headlessNotify = [];
    await beforeCompactHandlers.session_before_compact(
      compactEvent,
      makeCompactCtx(headlessStatus, headlessNotify, { hasUI: false }),
    );
    assert.equal(headlessStatus.length, 0, "absent UI must not write a footer status");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNotifyEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalNotifyEnv;
    if (originalEnabledEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED;
    else process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = originalEnabledEnv;
  }
}

// --- notify config/env-var plumbing is unchanged ---
{
  // The env var must win over any global/project config file regardless of this
  // machine's ~/.pi/agent/openai-server-compaction.json, so we don't assert a
  // "no env var" default here — only the override, which is deterministic.
  const originalEnv = process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
  try {
    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "true";
    assert.equal(loadConfig(repoRoot).notify, true, "PI_OPENAI_SERVER_COMPACTION_NOTIFY=true should enable notify");

    process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = "false";
    assert.equal(loadConfig(repoRoot).notify, false, "PI_OPENAI_SERVER_COMPACTION_NOTIFY=false should disable notify");
  } finally {
    if (originalEnv === undefined) delete process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY;
    else process.env.PI_OPENAI_SERVER_COMPACTION_NOTIFY = originalEnv;
  }
}

// --- meaningful compaction outcome reporting is preserved ---
{
  const outcomeModel = { provider: "openai", api: "openai-responses", id: "gpt-5.4-nano" };

  // Remote fails but the local fallback summary succeeds: falls back silently, exactly as before.
  {
    const calls = [];
    const ui = { notify: (msg, level) => calls.push({ msg, level }) };
    const localValue = { summary: "local summary", firstKeptEntryId: "entry-1", tokensBefore: 500 };
    const outcome = resolveCompactionOutcome({
      model: outcomeModel,
      preparation: { firstKeptEntryId: "entry-1", tokensBefore: 500 },
      localResult: { status: "fulfilled", value: localValue },
      remoteResult: { status: "rejected", reason: new Error("remote down") },
      aborted: false,
      hasUI: true,
      ui,
    });
    assert.deepEqual(outcome, { compaction: localValue }, "remote failure with a working local summary should fall back silently");
    assert.equal(calls.length, 0, "silent single-failure fallback must not notify");
  }

  // Both remote and local fail: Pi's default compaction takes over and the opt-in outcome warning still fires.
  {
    const calls = [];
    const ui = { notify: (msg, level) => calls.push({ msg, level }) };
    const outcome = resolveCompactionOutcome({
      model: outcomeModel,
      preparation: { firstKeptEntryId: "entry-1", tokensBefore: 500 },
      localResult: { status: "rejected", reason: new Error("local failed too") },
      remoteResult: { status: "rejected", reason: new Error("remote down") },
      aborted: false,
      hasUI: true,
      ui,
    });
    assert.equal(outcome, undefined, "double failure defers to Pi's default compaction");
    assert.equal(calls.length, 1, "double failure must still surface a meaningful outcome warning");
    assert.equal(calls[0].level, "warning");
    assert.match(calls[0].msg, /remote down/);
  }

  // An aborted compaction adds no notice, even on double failure.
  {
    const calls = [];
    const ui = { notify: (msg, level) => calls.push({ msg, level }) };
    const outcome = resolveCompactionOutcome({
      model: outcomeModel,
      preparation: { firstKeptEntryId: "entry-1", tokensBefore: 500 },
      localResult: { status: "rejected", reason: new Error("local failed too") },
      remoteResult: { status: "rejected", reason: new Error("remote down") },
      aborted: true,
      hasUI: true,
      ui,
    });
    assert.equal(outcome, undefined);
    assert.equal(calls.length, 0, "an aborted compaction must not emit an outcome notice");
  }

  // Remote succeeds: returns the merged compaction result, and success is not itself a spam notice.
  {
    const calls = [];
    const ui = { notify: (msg, level) => calls.push({ msg, level }) };
    const localValue = { summary: "local summary", firstKeptEntryId: "entry-1", tokensBefore: 500 };
    const outcome = resolveCompactionOutcome({
      model: outcomeModel,
      preparation: { firstKeptEntryId: "entry-1", tokensBefore: 500 },
      localResult: { status: "fulfilled", value: localValue },
      remoteResult: {
        status: "fulfilled",
        value: {
          output: [{ type: "compaction", encrypted_content: "ENCRYPTED" }],
          usage: {
            input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      },
      aborted: false,
      hasUI: true,
      ui,
    });
    assert.equal(outcome.compaction.summary, "local summary");
    assert.ok(outcome.compaction.details.remoteCompaction, "successful remote compaction should attach remoteCompaction details");
    assert.equal(calls.length, 0, "a successful remote compaction must not also fire an activation-style notice");
  }
}

console.log("smoke ok");
