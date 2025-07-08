import { openai } from "@ai-sdk/openai";
import BaseAITool, { type BaseAIToolConfig } from "@common/ai/tools/BaseAITool";
import type { MinimalSearchResult } from "@common/exa";
import { generateObject, tool, type LanguageModelV1 } from "ai";
import { z } from "zod";

// Parameters for the before/after execute hooks
type TParams = {
  query: string;
  pendingResult: MinimalSearchResult;
  accumulatedSources: MinimalSearchResult[];
};

// Hook function types
type TBeforeExecuteHook = (params: TParams) => any | Promise<any>;

type TAfterExecuteHook = (
  result: "relevant" | "irrelevant",
  params: TParams
) => any | Promise<any>;

// Context type for this tool - contains all the data needed for evaluation
type EvaluationContext = {
  model: LanguageModelV1;
  query: string;
  pendingResult: MinimalSearchResult;
  accumulatedSources: MinimalSearchResult[];
};

/**
 * Tool for evaluating search results relevance
 * Uses context injection to access dynamic evaluation data
 */
class SearchResultEvalTool extends BaseAITool<
  TBeforeExecuteHook,
  TAfterExecuteHook,
  EvaluationContext
> {
  constructor(
    config?: BaseAIToolConfig<
      TBeforeExecuteHook,
      TAfterExecuteHook,
      EvaluationContext
    >
  ) {
    super(config);
  }

  get tool() {
    return tool({
      description:
        "Evaluate whether search results are relevant to the query and don't duplicate existing results",
      parameters: z.object({}),
      execute: async () => {
        const context = await this.getContext();
        if (!context)
          throw new Error("SearchResultEvalTool requires context to be set.");
        const { model, query, pendingResult, accumulatedSources } = context;

        // Execute before hook if available
        if (this.beforeExecute)
          await this.beforeExecute({
            query,
            pendingResult,
            accumulatedSources,
          });

        const { object: evaluation } = await generateObject({
          model,
          prompt: `Evaluate whether the search results are relevant and will help answer the following query: ${query}. If the page already exists in the existing results, mark it as irrelevant.

                    <search_results>
                    ${JSON.stringify(pendingResult)}
                    </search_results>
        
                    <existing_results>
                    ${JSON.stringify(
                      accumulatedSources.map((result) => result.url)
                    )}
                    </existing_results>
        
                    `,
          output: "enum",
          enum: ["relevant", "irrelevant"],
        });

        // Execute after hook if available
        if (this.afterExecute) {
          await this.afterExecute(evaluation, {
            query,
            pendingResult,
            accumulatedSources,
          });
        }

        return evaluation === "irrelevant"
          ? "Search results are irrelevant. Please search again with a more specific query."
          : "Search results are relevant. End research for this query.";
      },
    });
  }
}

export default SearchResultEvalTool;
export type { EvaluationContext };
