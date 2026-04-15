import type {
  CreateDeepResearchAgentConfig,
  DeepResearchAgent,
  DeepResearchCallOptions,
  DeepResearchInput,
} from "./types";
import { createExaSearchExecutor } from "./exa";
import {
  createWorkflowDependencies,
  executeDeepResearchWorkflow,
  streamDeepResearchWorkflow,
} from "./workflow";
import { normalizeTopic } from "./utils";

export function createDeepResearchAgent(
  config: CreateDeepResearchAgentConfig,
): DeepResearchAgent {
  const search =
    config.search ??
    (config.exaApiKey ?? process.env.EXA_API_KEY
      ? createExaSearchExecutor({
          apiKey: config.exaApiKey ?? process.env.EXA_API_KEY ?? "",
          maxCharactersPerResult: config.maxCharactersPerResult,
        })
      : undefined);

  if (!search) {
    throw new Error(
      "createDeepResearchAgent requires either config.search or an Exa API key.",
    );
  }

  const deps = createWorkflowDependencies({
    model: config.model,
    synthesisModel: config.synthesisModel ?? config.model,
    search,
    maxResultsPerQuery: config.maxResultsPerQuery ?? 3,
    maxQueriesPerRun: config.maxQueriesPerRun ?? 20,
    maxFollowUpQuestions: config.maxFollowUpQuestions ?? 3,
  });

  function resolveOptions(options?: DeepResearchCallOptions) {
    return {
      depth: options?.depth ?? config.defaultDepth ?? 2,
      breadth: options?.breadth ?? config.defaultBreadth ?? 3,
      abortSignal: options?.abortSignal,
    };
  }

  return {
    stream(input: DeepResearchInput, options?: DeepResearchCallOptions) {
      return streamDeepResearchWorkflow({
        topic: normalizeTopic(input),
        options: resolveOptions(options),
        deps,
      });
    },
    run(input: DeepResearchInput, options?: DeepResearchCallOptions) {
      return executeDeepResearchWorkflow({
        topic: normalizeTopic(input),
        options: resolveOptions(options),
        deps,
      });
    },
  };
}
