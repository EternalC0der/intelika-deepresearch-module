import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { type MinimalSearchResult } from "@common/exa";
import SearchWebTool from "@common/ai/tools/SearchWebTool";
import SearchResultEvalTool from "@common/ai/tools/SearchResultEvalTool";

/**
 * Configuration options for the DeepResearch agent
 */
export interface DeepResearchConfig {
  /** Model to use for agent operations (default: gpt-4o-mini) */
  agentModel?: LanguageModel;
  /** Model to use for synthesis/report generation (default: gpt-4o) */
  synthModel?: LanguageModel;
  /** Default depth for research recursion (default: 2) */
  defaultDepth?: number;
  /** Default breadth for search queries (default: 2) */
  defaultBreadth?: number;
  /** Enable verbose logging (default: true) */
  verbose?: boolean;
}

/**
 * Represents a learning extracted from research
 */
export interface Learning {
  learning: string;
  followUpQuestions: string[];
}

/**
 * Represents accumulated research data
 */
export interface Research {
  query?: string;
  queries: string[];
  searchResults: MinimalSearchResult[];
  learnings: Learning[];
  completedQueries: string[];
}

/**
 * DeepResearch Agent - Orchestrates comprehensive research operations
 *
 * This class provides a reusable interface for conducting deep research
 * using AI agents, web search, and recursive query generation.
 */
export class DeepResearch {
  private agentModel: LanguageModel;
  private synthModel: LanguageModel;
  private defaultDepth: number;
  private defaultBreadth: number;
  private verbose: boolean;
  private accumulatedResearch!: Research;

  /**
   * Initialize the DeepResearch agent with configuration
   * @param config Configuration options for the agent
   */
  constructor(config: DeepResearchConfig = {}) {
    // Set default models and configuration
    this.agentModel = config.agentModel || openai("gpt-4o-mini");
    this.synthModel = config.synthModel || openai("gpt-4o");
    this.defaultDepth = config.defaultDepth || 2;
    this.defaultBreadth = config.defaultBreadth || 2;
    this.verbose = config.verbose ?? true;

    // Initialize research state
    this.resetResearch();
  }

  /**
   * Reset the accumulated research data
   */
  private resetResearch(): void {
    this.accumulatedResearch = {
      query: undefined,
      queries: [],
      searchResults: [],
      learnings: [],
      completedQueries: [],
    };
  }

  /**
   * Conduct comprehensive research on a given topic
   * @param prompt The research query/topic
   * @param depth How deep to recurse (optional, uses default)
   * @param breadth How many queries to generate per iteration (optional, uses default)
   * @returns Promise resolving to accumulated research data
   */
  async conductResearch(
    prompt: string,
    depth?: number,
    breadth?: number
  ): Promise<Research> {
    // Reset state for new research
    this.resetResearch();

    // Use provided values or defaults
    const researchDepth = depth ?? this.defaultDepth;
    const researchBreadth = breadth ?? this.defaultBreadth;

    if (this.verbose) {
      console.log(`🔍 Starting deep research on: "${prompt}"`);
      console.log(
        `📊 Configuration: depth=${researchDepth}, breadth=${researchBreadth}`
      );
    }

    // Start the recursive research process
    await this.deepResearch(prompt, researchDepth, researchBreadth);

    if (this.verbose) {
      console.log(
        `✅ Research completed! Found ${this.accumulatedResearch.searchResults.length} relevant sources`
      );
    }

    return this.accumulatedResearch;
  }

  /**
   * Generate a comprehensive report from research data
   * @param research Optional research data (uses accumulated if not provided)
   * @returns Promise resolving to generated report text
   */
  async generateReport(research?: Research): Promise<string> {
    const researchData = research || this.accumulatedResearch;

    const { text } = await generateText({
      model: this.synthModel,
      system: `You are an expert researcher. Today is ${new Date().toISOString()}. Follow these instructions when responding:
- You may be asked to research subjects that is after your knowledge cutoff, assume the user is right when presented with news.
- The user is a highly experienced analyst, no need to simplify it, be as detailed as possible and make sure your response is correct.
- Be highly organized.
- Suggest solutions that I didn't think about.
- Be proactive and anticipate my needs.
- Treat me as an expert in all subject matter.
- Mistakes erode my trust, so be accurate and thorough.
- Provide detailed explanations, I'm comfortable with lots of detail.
- Value good arguments over authorities, the source is irrelevant.
- Consider new technologies and contrarian ideas, not just the conventional wisdom.
- You may use high levels of speculation or prediction, just flag it for me.
- Use Markdown formatting.`,
      prompt:
        "Generate a comprehensive report based on the following research data:\n\n" +
        JSON.stringify(researchData, null, 2),
    });

    if (this.verbose) {
      console.log("✅ Report generated successfully!");
    }

    return text;
  }

  /**
   * Get the current accumulated research data
   * @returns Current research state
   */
  getResearchData(): Research {
    return { ...this.accumulatedResearch };
  }

  /**
   * Recursive function that performs deep research
   * @param prompt The research query
   * @param depth Remaining depth for recursion
   * @param breadth Number of queries to generate
   */
  private async deepResearch(
    prompt: string,
    depth: number,
    breadth: number
  ): Promise<Research> {
    // Set the initial query if not set
    if (!this.accumulatedResearch.query) {
      this.accumulatedResearch.query = prompt;
    }

    // Base case: if depth is 0, research is complete
    if (depth <= 0) {
      return this.accumulatedResearch;
    }

    if (this.verbose) {
      console.log(`🔎 Research depth ${depth}: generating ${breadth} queries`);
    }

    // Generate search queries for this iteration
    const queries = await this.generateSearchQueries(prompt, breadth);
    this.accumulatedResearch.queries.push(...queries);

    // Process each query
    for (const query of queries) {
      if (this.verbose) {
        console.log(`🔍 Processing query: "${query}"`);
      }

      // Search and evaluate results
      const searchResults = await this.searchAndProcess(query);
      this.accumulatedResearch.searchResults.push(...searchResults);

      // Generate learnings from each relevant result
      for (const searchResult of searchResults) {
        if (this.verbose) {
          console.log(`📚 Extracting learnings from: ${searchResult.url}`);
        }

        const learnings = await this.generateLearnings(query, searchResult);
        this.accumulatedResearch.learnings.push(learnings);
        this.accumulatedResearch.completedQueries.push(query);

        // Recursively research follow-up questions
        const followUpQuery = `Overall research goal: ${prompt}
Previous search queries: ${this.accumulatedResearch.completedQueries.join(", ")}

Follow-up questions: ${learnings.followUpQuestions.join(", ")}`;

        await this.deepResearch(
          followUpQuery,
          depth - 1,
          Math.ceil(breadth / 2)
        );
      }
    }

    return this.accumulatedResearch;
  }

  /**
   * Search the web and evaluate results for relevance
   * @param query The search query
   * @returns Array of relevant search results
   */
  private async searchAndProcess(
    query: string
  ): Promise<MinimalSearchResult[]> {
    const pendingSearchResults: MinimalSearchResult[] = [];
    const finalSearchResults: MinimalSearchResult[] = [];

    // Create search web tool with hooks
    const { tool: searchWebTool } = new SearchWebTool({
      hooks: {
        beforeExecute: (params) => {
          if (this.verbose) {
            console.log(`[AGENT: SearchWeb] Searching '${params.query}'`);
          }
        },
        afterExecute: (result) => {
          if (this.verbose) {
            console.log("[AGENT: SearchWeb] Found:", result.at(-1)?.url);
          }
          pendingSearchResults.push(...result);
        },
      },
    });

    // Create evaluation tool with hooks
    const { tool: evaluateSearchResult } = new SearchResultEvalTool({
      hooks: {
        beforeExecute: ({ pendingResult }) => {
          if (this.verbose) {
            console.log(
              `[AGENT: EvaluateSearchResult] Evaluating '${pendingResult.url}'`
            );
          }
        },
        afterExecute: (result, { pendingResult }) => {
          if (this.verbose) {
            console.log(
              `[AGENT: EvaluateSearchResult] Evaluated '${pendingResult.url}' as ${result}`
            );
          }
          if (result === "relevant") {
            finalSearchResults.push(pendingResult);
          }
        },
      },
      contextProvider: {
        getContext: () => {
          const pendingResult = pendingSearchResults.pop();
          if (!pendingResult) return null;

          return {
            model: this.agentModel,
            query,
            pendingResult,
            accumulatedSources: this.accumulatedResearch.searchResults,
          };
        },
      },
    });

    // Execute search and evaluation with better error handling
    try {
      await generateText({
        model: this.agentModel,
        prompt: `Research the topic: "${query}"

Follow this exact workflow:
1. First, call the searchWeb tool to find relevant information
2. Then, call the evaluate tool to determine if the result is relevant
3. Only call evaluate if there is a search result to evaluate

Start by searching for information about: ${query}`,
        system:
          "You are a research assistant. Follow the two-step process: FIRST search the web, THEN evaluate the result. If you get an error about no result to evaluate, or if the evaluation tool indicates there is no result, STOP calling the evaluation tool and finish the task.",
        maxSteps: 10,
        tools: {
          searchWeb: searchWebTool,
          evaluate: evaluateSearchResult,
        },
      });
    } catch (error) {
      // Log the error but don't crash the entire process
      if (this.verbose) {
        console.log(
          `[AGENT: SearchAndProcess] Handled error gracefully: ${error}`
        );
      }
    }

    return finalSearchResults;
  }

  /**
   * Generate learnings and follow-up questions from a search result
   * @param query The original search query
   * @param searchResult The search result to analyze
   * @returns Promise resolving to Learning object
   */
  private async generateLearnings(
    query: string,
    searchResult: MinimalSearchResult
  ): Promise<Learning> {
    const { object } = await generateObject({
      model: this.agentModel,
      prompt: `The user is researching "${query}". The following search result was deemed relevant.
Generate a learning and follow-up questions from this search result:

<search_result>
${JSON.stringify(searchResult)}
</search_result>`,
      schema: z.object({
        learning: z.string(),
        followUpQuestions: z.array(z.string()),
      }),
    });

    return object;
  }

  /**
   * Generate search queries for a given research topic
   * @param query The research topic
   * @param n Number of queries to generate
   * @returns Promise resolving to array of search queries
   */
  private async generateSearchQueries(
    query: string,
    n: number = 3
  ): Promise<string[]> {
    const {
      object: { queries },
    } = await generateObject({
      model: this.agentModel,
      prompt: `Generate ${n} diverse and comprehensive search queries for the following research topic: ${query}`,
      schema: z.object({
        queries: z.array(z.string()).min(1).max(5),
      }),
    });

    return queries;
  }
}

export default DeepResearch;
