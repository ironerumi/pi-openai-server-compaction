/**
 * Typed facade over the vendored pi-ai Responses helpers.
 *
 * The implementations live in `./constrained-sampling.ts` and
 * `./openai-responses-shared.ts`, copied from `@earendil-works/pi-ai` by
 * `scripts/vendor-pi-ai.mjs`. Their signatures are taken from pi-ai's own type
 * declarations, so callers keep pi-ai's types without a runtime dependency on
 * pi-ai's internals.
 */
import type * as PiAiConstrainedSampling from "@earendil-works/pi-ai/api/constrained-sampling";
import type * as PiAiOpenAiResponsesShared from "@earendil-works/pi-ai/api/openai-responses-shared";
import { createGrammarToolInputProperties as vendoredCreateGrammarToolInputProperties } from "./constrained-sampling.ts";
import {
	convertResponsesTools as vendoredConvertResponsesTools,
	processResponsesStream as vendoredProcessResponsesStream,
} from "./openai-responses-shared.ts";

export const createGrammarToolInputProperties =
	vendoredCreateGrammarToolInputProperties as typeof PiAiConstrainedSampling.createGrammarToolInputProperties;

export const convertResponsesTools =
	vendoredConvertResponsesTools as typeof PiAiOpenAiResponsesShared.convertResponsesTools;

export const processResponsesStream =
	vendoredProcessResponsesStream as typeof PiAiOpenAiResponsesShared.processResponsesStream;
