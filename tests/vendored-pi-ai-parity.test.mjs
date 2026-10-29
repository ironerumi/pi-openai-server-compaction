import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  createGrammarToolInputProperties as referenceCreateGrammarToolInputProperties,
} from "@earendil-works/pi-ai/api/constrained-sampling";
import {
  convertResponsesTools as referenceConvertResponsesTools,
  processResponsesStream as referenceProcessResponsesStream,
} from "@earendil-works/pi-ai/api/openai-responses-shared";
import {
  createGrammarToolInputProperties,
  convertResponsesTools,
  processResponsesStream,
} from "../src/vendor/pi-ai/index.ts";

// The extension vendors pi-ai's Responses internals because Pi's extension loader
// maps only the package roots plus `pi-ai/compat`, `/models`, `/oauth` and
// `/providers/all`. These tests compare the vendored copy against the pi-ai
// release it was copied from, so a pi-ai upgrade that changes Responses
// behavior fails here instead of silently diverging in the extension.

const plainTool = {
  name: "read",
  description: "Read a test file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, optional: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
};

const strictTool = {
  name: "strict_tool",
  description: "Strict JSON schema tool",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  constrainedSampling: { type: "json_schema", strict: "require" },
};

const grammarTool = {
  name: "grammar_tool",
  description: "Grammar constrained tool",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
    additionalProperties: false,
  },
  constrainedSampling: {
    type: "grammar",
    variants: { openai_lark: "start: /[a-z]+/\n" },
  },
};

const model = {
  id: "gpt-6.1-sol",
  name: "GPT test",
  api: "openai-responses",
  provider: "openai",
  reasoning: true,
  input: ["text"],
  contextWindow: 500000,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function* events() {
  yield { type: "response.created", response: { id: "resp_parity" } };
  yield { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1" } };
  yield { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "thinking" };
  yield { type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "thinking" }], encrypted_content: "ENC" } };
  yield { type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_1" } };
  yield { type: "response.output_text.delta", output_index: 1, delta: "hello" };
  yield { type: "response.output_item.done", output_index: 1, item: { type: "message", id: "msg_1", phase: "final_answer", content: [{ type: "output_text", text: "hello" }] } };
  yield { type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read" } };
  yield { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"path":"a.txt"}' };
  yield { type: "response.function_call_arguments.done", output_index: 2, arguments: '{"path":"a.txt"}' };
  yield { type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", arguments: '{"path":"a.txt"}' } };
  yield {
    type: "response.completed",
    response: {
      id: "resp_parity",
      status: "completed",
      output: [],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 7 },
      },
    },
  };
}

async function runStream(processor) {
  const output = {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  };
  const stream = createAssistantMessageEventStream();
  const pushed = [];
  const originalPush = stream.push.bind(stream);
  stream.push = (event) => {
    pushed.push({ type: event.type, contentIndex: event.contentIndex, delta: event.delta });
    return originalPush(event);
  };
  await processor(events(), output, stream, model, {});
  return { output, pushed };
}

test("vendored tool conversion matches the pi-ai release it was copied from", () => {
  const tools = [plainTool, strictTool, grammarTool];
  for (const options of [
    { supportsOpenAIGrammarTools: true, supportsStrictMode: true },
    { supportsOpenAIGrammarTools: true, supportsStrictMode: false },
  ]) {
    const strictness = options.supportsStrictMode ? "require" : "prefer";
    const comparable = [plainTool, { ...strictTool, constrainedSampling: { type: "json_schema", strict: strictness } }, grammarTool];
    assert.deepEqual(
      convertResponsesTools(comparable, options),
      referenceConvertResponsesTools(comparable, options),
    );
  }

  // A tool that requires strict sampling fails on a backend without strict mode.
  // Both implementations must fail the same way.
  const unsupported = { supportsOpenAIGrammarTools: true, supportsStrictMode: false };
  const captureError = (fn) => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error;
    }
  };
  const vendoredError = captureError(() => convertResponsesTools(tools, unsupported));
  const referenceError = captureError(() => referenceConvertResponsesTools(tools, unsupported));
  assert.ok(vendoredError && referenceError, "both implementations must reject a required strict tool");
  assert.equal(vendoredError.message, referenceError.message);
});

test("vendored grammar tool input properties match the pi-ai release", () => {
  const tools = [plainTool, strictTool, grammarTool];
  const vendored = createGrammarToolInputProperties(tools, true);
  const reference = referenceCreateGrammarToolInputProperties(tools, true);
  assert.deepEqual([...vendored.entries()], [...reference.entries()]);
  assert.deepEqual(
    [...createGrammarToolInputProperties(tools, false).entries()],
    [...referenceCreateGrammarToolInputProperties(tools, false).entries()],
  );
});

test("vendored stream decoding matches the pi-ai release", async () => {
  const vendored = await runStream(processResponsesStream);
  const reference = await runStream(referenceProcessResponsesStream);
  assert.deepEqual(vendored.output, reference.output);
  assert.deepEqual(vendored.pushed, reference.pushed);
});
