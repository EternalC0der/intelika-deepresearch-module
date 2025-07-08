import { tool } from "ai";
import { z } from "zod";
import { searchWeb } from "@common/exa";
import type { MinimalSearchResult } from "@common/exa";
import BaseAITool, { type BaseAIToolConfig } from "@common/ai/tools/BaseAITool";

const paramsObject = z.object({
  query: z.string().min(1),
});

// Hook function types
type TBeforeExecuteHook = (
  params: z.infer<typeof paramsObject>
) => any | Promise<any>;

type TAfterExecuteHook = (
  result: MinimalSearchResult[],
  params: z.infer<typeof paramsObject>
) => any | Promise<any>;

/**
 * Tool for searching the web
 */
class SearchWebTool extends BaseAITool<TBeforeExecuteHook, TAfterExecuteHook> {
  constructor(
    config?: BaseAIToolConfig<TBeforeExecuteHook, TAfterExecuteHook, any>
  ) {
    super(config);
  }

  get tool() {
    return tool({
      description: "Search the web for information about the given query",
      parameters: paramsObject,
      execute: async ({ query }) => {
        // Execute before hook if available
        if (this.beforeExecute) await this.beforeExecute({ query });

        // Perform the web search
        const results = await searchWeb(query);

        // Execute after hook if available
        if (this.afterExecute) await this.afterExecute(results, { query });

        return results;
      },
    });
  }
}

export default SearchWebTool;
