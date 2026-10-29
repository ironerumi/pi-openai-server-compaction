/**
 * Host-provided pi-ai helpers used by the vendored Responses modules.
 *
 * Pi serves these from its own `@earendil-works/pi-ai` copy, so the extension
 * never ships a second copy of the host module. The imports are root-level
 * specifiers, which Pi's extension loader maps to the host package.
 */
export {
	calculateCost,
	getSystemMessageText,
	parseStreamingJson,
	parseToolCallArguments,
	renderSystemMessageUpdate,
	resolveTranscript,
	resolveTranscriptTools,
} from "@earendil-works/pi-ai";
