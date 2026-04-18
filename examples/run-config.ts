/**
 * Run the deep research module with a single JSON config argument.
 *
 * Example:
 * bun run examples/run-config.ts '{"prompt":"Analyze trends in enterprise AI adoption for 2026","researchModel":"claude-haiku-4-5-20251001","synthesisModel":"claude-haiku-4-5-20251001","depth":1,"breadth":1}'
 */

import type { DeepResearchEvent, DeepResearchResult, DeepResearchRunConfig } from "../index.ts";
import { streamDeepResearchFromConfig } from "../index.ts";

function fail(message: string): never {
  console.error(`\n[run-config] ${message}\n`);
  process.exit(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function parseConfig(raw: string | undefined): DeepResearchRunConfig {
  if (!raw?.trim()) {
    fail("Missing JSON config argument.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Invalid JSON config: ${message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    fail("Config must be a JSON object.");
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.prompt !== "string" || candidate.prompt.trim() === "") {
    fail('Config must include a non-empty "prompt" string.');
  }
  if (
    typeof candidate.researchModel !== "string" ||
    candidate.researchModel.trim() === ""
  ) {
    fail('Config must include a non-empty "researchModel" string.');
  }
  if (
    candidate.synthesisModel != null &&
    (typeof candidate.synthesisModel !== "string" ||
      candidate.synthesisModel.trim() === "")
  ) {
    fail('"synthesisModel" must be a non-empty string when provided.');
  }
  if (candidate.depth != null && !Number.isInteger(candidate.depth)) {
    fail('"depth" must be an integer when provided.');
  }
  if (candidate.breadth != null && !Number.isInteger(candidate.breadth)) {
    fail('"breadth" must be an integer when provided.');
  }

  return {
    prompt: candidate.prompt,
    researchModel: candidate.researchModel,
    synthesisModel:
      typeof candidate.synthesisModel === "string"
        ? candidate.synthesisModel
        : undefined,
    modelProvider:
      candidate.modelProvider === "anthropic" ||
      candidate.modelProvider === "google" ||
      candidate.modelProvider === "openai"
        ? candidate.modelProvider
        : undefined,
    depth: typeof candidate.depth === "number" ? candidate.depth : undefined,
    breadth:
      typeof candidate.breadth === "number" ? candidate.breadth : undefined,
  };
}

function logEvent(event: DeepResearchEvent): DeepResearchResult | null {
  switch (event.type) {
    case "run-started":
      console.log(
        `\n[run-started] topic="${event.topic}" depth=${event.depth} breadth=${event.breadth}`,
      );
      return null;
    case "query-generated":
      console.log(
        `[query-generated] depth=${event.depth} #${event.index + 1}: ${event.query}`,
      );
      return null;
    case "search-started":
      console.log(
        `[search-started] query="${event.query}" numResults=${event.numResults}`,
      );
      return null;
    case "search-completed":
      console.log(
        `[search-completed] query="${event.query}" results=${event.results.length}`,
      );
      return null;
    case "result-evaluated":
      console.log(
        `[result-evaluated] ${event.verdict.toUpperCase()} ${event.result.url} :: ${truncate(event.reason, 100)}`,
      );
      return null;
    case "learning-generated":
      console.log(`[learning-generated] ${truncate(event.learning.learning, 120)}`);
      return null;
    case "depth-progress":
      console.log(
        `[depth-progress] completedQueries=${event.completedQueries} acceptedResults=${event.acceptedResults} remainingDepth=${event.remainingDepth}`,
      );
      return null;
    case "report-started":
      console.log(`[report-started] Synthesizing final report for "${event.topic}"`);
      return null;
    case "report-completed":
      console.log(`[report-completed] reportLength=${event.report.length} characters`);
      return null;
    case "run-error":
      console.error(
        `[run-error] stage=${event.stage} aborted=${event.aborted} message=${event.error}`,
      );
      return null;
    case "run-completed":
      console.log(
        `\n[run-completed] status=${event.result.status} queries=${event.result.metadata.totalQueries} acceptedSources=${event.result.metadata.totalAcceptedResults}`,
      );
      console.log("\n=== Final Report ===\n");
      console.log(event.result.report ?? "[no report]");
      return event.result;
  }
}

async function main() {
  const config = parseConfig(Bun.argv[2]);
  let finalResult: DeepResearchResult | null = null;

  for await (const event of streamDeepResearchFromConfig(config)) {
    const maybeResult = logEvent(event);
    if (maybeResult) {
      finalResult = maybeResult;
    }
  }

  if (!finalResult) {
    fail("Run ended without a completed result.");
  }

  console.log(
    `\n[summary] completedAt=${finalResult.metadata.completedAt} learnings=${finalResult.learnings.length}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run-config] Fatal error: ${message}`);
  process.exit(1);
});
