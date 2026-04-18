import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createDeepResearchAgent } from "./createDeepResearchAgent";
import type {
  DeepResearchAgent,
  DeepResearchResult,
  DeepResearchRunConfig,
  SupportedModelProvider,
} from "./types";
import { parseModelReference } from "./utils";

function requireValue(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function resolveProviderFromEnvironment(): SupportedModelProvider | undefined {
  const configuredProviders: SupportedModelProvider[] = [];

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    configuredProviders.push("anthropic");
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    configuredProviders.push("google");
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    configuredProviders.push("openai");
  }

  return configuredProviders.length === 1 ? configuredProviders[0] : undefined;
}

function resolveLanguageModel(
  model: string | LanguageModel,
  preferredProvider?: SupportedModelProvider,
): LanguageModel {
  if (typeof model !== "string") {
    return model;
  }

  const parsed = parseModelReference(model);
  const provider =
    parsed.provider ?? preferredProvider ?? resolveProviderFromEnvironment();

  if (!provider) {
    throw new Error(
      [
        `Unable to determine the provider for model "${model}".`,
        "Use a prefixed model id such as \"anthropic/claude-...\",",
        "pass modelProvider explicitly, or configure exactly one provider API key.",
      ].join(" "),
    );
  }

  switch (provider) {
    case "anthropic":
      requireValue("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
      return anthropic(parsed.modelId);
    case "google":
      requireValue(
        "GOOGLE_GENERATIVE_AI_API_KEY",
        process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      );
      return google(parsed.modelId);
    case "openai":
      requireValue("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
      return openai(parsed.modelId);
  }
}

export function createDeepResearchAgentFromConfig(
  config: Omit<DeepResearchRunConfig, "prompt">,
): DeepResearchAgent {
  return createDeepResearchAgent({
    model: resolveLanguageModel(config.researchModel, config.modelProvider),
    synthesisModel: resolveLanguageModel(
      config.synthesisModel ?? config.researchModel,
      config.modelProvider,
    ),
    exaApiKey: config.exaApiKey,
    search: config.search,
    defaultDepth: config.depth,
    defaultBreadth: config.breadth,
    maxResultsPerQuery: config.maxResultsPerQuery,
    maxQueriesPerRun: config.maxQueriesPerRun,
    maxFollowUpQuestions: config.maxFollowUpQuestions,
    maxCharactersPerResult: config.maxCharactersPerResult,
  });
}

export function streamDeepResearchFromConfig(config: DeepResearchRunConfig) {
  return createDeepResearchAgentFromConfig(config).stream(
    { prompt: config.prompt },
    {
      depth: config.depth,
      breadth: config.breadth,
    },
  );
}

export function runDeepResearchFromConfig(
  config: DeepResearchRunConfig,
): Promise<DeepResearchResult> {
  return createDeepResearchAgentFromConfig(config).run(
    { prompt: config.prompt },
    {
      depth: config.depth,
      breadth: config.breadth,
    },
  );
}
