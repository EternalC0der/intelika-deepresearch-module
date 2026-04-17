/**
 * Showcase script for the deep research module.
 *
 * Load the required API keys and model configuration in your shell or .env,
 * then run:
 *
 * bun run examples/showcase.ts "Your research topic"
 */

import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { DeepResearchEvent, DeepResearchResult } from "../index.ts";
import { createDeepResearchAgent } from "../index.ts";

type ProviderName = "openai" | "google";

const USAGE = [
  "Usage:",
  '  bun run examples/showcase.ts "Your research topic"',
  "",
  "Required environment variables:",
  "  EXA_API_KEY",
  "  AI_MODEL",
  "  and either OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY",
  "",
  "Optional environment variables:",
  "  AI_PROVIDER=<openai|google>    # optional if only one provider key is configured",
  "  AI_SYNTH_MODEL=<model-id>",
  "  RESEARCH_DEPTH=<positive integer>",
  "  RESEARCH_BREADTH=<positive integer>",
].join("\n");

function fail(message: string): never {
  console.error(`\n[showcase] ${message}\n`);
  console.error(USAGE);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${name} must be a positive integer. Received: ${value}`);
  }

  return parsed;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getProvider(): ProviderName {
  const provider = process.env.AI_PROVIDER?.trim();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  const hasGoogleKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());

  if (provider === "openai" || provider === "google") {
    return provider;
  }

  if (hasOpenAIKey && !hasGoogleKey) {
    return "openai";
  }

  if (hasGoogleKey && !hasOpenAIKey) {
    return "google";
  }

  if (!hasOpenAIKey && !hasGoogleKey) {
    fail(
      "Missing provider API key. Set either OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.",
    );
  }

  fail(
    "AI_PROVIDER must be set to 'openai' or 'google' when multiple provider API keys are configured.",
  );
}

function buildModels(provider: ProviderName, modelId: string, synthModelId?: string) {
  switch (provider) {
    case "openai":
      requireEnv("OPENAI_API_KEY");
      return {
        model: openai(modelId),
        synthesisModel: synthModelId ? openai(synthModelId) : openai(modelId),
      };
    case "google":
      requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");
      return {
        model: google(modelId),
        synthesisModel: synthModelId ? google(synthModelId) : google(modelId),
      };
  }
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
      console.log(
        `[learning-generated] ${truncate(event.learning.learning, 120)}`,
      );
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
      console.log(
        `[report-completed] reportLength=${event.report.length} characters`,
      );
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
  const topic = Bun.argv.slice(2).join(" ").trim();
  if (!topic) {
    fail("Missing research topic argument.");
  }

  const provider = getProvider();
  const modelId = requireEnv("AI_MODEL");
  const exaApiKey = requireEnv("EXA_API_KEY");
  const synthModelId = process.env.AI_SYNTH_MODEL?.trim() || undefined;
  const depth = parsePositiveInteger(process.env.RESEARCH_DEPTH, 2, "RESEARCH_DEPTH");
  const breadth = parsePositiveInteger(
    process.env.RESEARCH_BREADTH,
    2,
    "RESEARCH_BREADTH",
  );

  const { model, synthesisModel } = buildModels(provider, modelId, synthModelId);

  console.log(
    `[showcase] provider=${provider} model=${modelId} synthModel=${synthModelId ?? modelId}`,
  );

  const agent = createDeepResearchAgent({
    model,
    synthesisModel,
    exaApiKey,
    defaultDepth: depth,
    defaultBreadth: breadth,
  });

  const controller = new AbortController();
  let finalResult: DeepResearchResult | null = null;
  let sawRunError = false;

  const handleSigint = () => {
    if (controller.signal.aborted) {
      return;
    }

    console.error("\n[showcase] SIGINT received. Aborting research run...");
    controller.abort(new Error("Interrupted by user"));
  };

  process.once("SIGINT", handleSigint);

  try {
    for await (const event of agent.stream(topic, {
      depth,
      breadth,
      abortSignal: controller.signal,
    })) {
      const maybeResult = logEvent(event);
      if (maybeResult) {
        finalResult = maybeResult;
      }
      if (event.type === "run-error") {
        sawRunError = true;
      }
    }
  } finally {
    process.removeListener("SIGINT", handleSigint);
  }

  if (finalResult) {
    console.log(
      `\n[summary] completedAt=${finalResult.metadata.completedAt} learnings=${finalResult.learnings.length}`,
    );
    return;
  }

  if (controller.signal.aborted) {
    console.error("[showcase] Run aborted before completion.");
    process.exitCode = 130;
    return;
  }

  if (sawRunError) {
    process.exitCode = 1;
    return;
  }

  console.error("[showcase] Stream ended without a completed result.");
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[showcase] Fatal error: ${message}`);
  process.exit(1);
});
