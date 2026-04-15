import { generateText, Output, ToolLoopAgent, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { buildReportPrompt } from "./report";
import type {
  DeepResearchCallOptions,
  DeepResearchEvent,
  DeepResearchResult,
  Learning,
  MinimalSearchResult,
  SearchExecutor,
} from "./types";
import {
  createFollowUpTopic,
  createRunTimestamp,
  dedupeStrings,
  describeModel,
  isAbortError,
  throwIfAborted,
} from "./utils";

type EventEmitter = (event: DeepResearchEvent) => Promise<void> | void;

export interface WorkflowDependencies {
  model: LanguageModel;
  synthesisModel: LanguageModel;
  maxResultsPerQuery: number;
  maxQueriesPerRun: number;
  maxFollowUpQuestions: number;
  generateQueries: (args: {
    topic: string;
    breadth: number;
    abortSignal?: AbortSignal;
  }) => Promise<string[]>;
  runSearchCoordinator: (args: {
    query: string;
    accumulatedUrls: Set<string>;
    emit: EventEmitter;
    abortSignal?: AbortSignal;
  }) => Promise<MinimalSearchResult[]>;
  generateLearning: (args: {
    query: string;
    searchResult: MinimalSearchResult;
    maxFollowUpQuestions: number;
    abortSignal?: AbortSignal;
  }) => Promise<Learning>;
  generateReport: (args: {
    topic: string;
    queries: string[];
    searchResults: MinimalSearchResult[];
    learnings: Learning[];
    abortSignal?: AbortSignal;
  }) => Promise<string>;
}

export function createWorkflowDependencies(args: {
  model: LanguageModel;
  synthesisModel: LanguageModel;
  search: SearchExecutor;
  maxResultsPerQuery: number;
  maxQueriesPerRun: number;
  maxFollowUpQuestions: number;
}): WorkflowDependencies {
  return {
    model: args.model,
    synthesisModel: args.synthesisModel,
    maxResultsPerQuery: args.maxResultsPerQuery,
    maxQueriesPerRun: args.maxQueriesPerRun,
    maxFollowUpQuestions: args.maxFollowUpQuestions,
    async generateQueries({ topic, breadth, abortSignal }) {
      throwIfAborted(abortSignal);

      const { output } = await generateText({
        model: args.model,
        abortSignal,
        output: Output.object({
          schema: z.object({
            queries: z.array(z.string().min(1)).min(1).max(Math.max(1, breadth)),
          }),
        }),
        prompt: [
          `Generate up to ${breadth} web research queries.`,
          "Return only queries that would help investigate the topic deeply.",
          "Prefer diverse, source-seeking queries over rephrasings.",
          `Topic: ${topic}`,
        ].join("\n"),
      });

      return dedupeStrings(output.queries).slice(0, Math.max(1, breadth));
    },
    async runSearchCoordinator({
      query,
      accumulatedUrls,
      emit,
      abortSignal,
    }) {
      let pendingResults: MinimalSearchResult[] = [];
      const acceptedResults: MinimalSearchResult[] = [];
      const seenCandidateUrls = new Set<string>();

      const searchWebTool = tool({
        description: "Search the web for research material relevant to a query.",
        inputSchema: z.object({
          query: z.string().min(1),
          numResults: z
            .number()
            .int()
            .min(1)
            .max(args.maxResultsPerQuery)
            .default(args.maxResultsPerQuery),
        }),
        execute: async ({ query: toolQuery, numResults }) => {
          throwIfAborted(abortSignal);
          await emit({
            type: "search-started",
            query: toolQuery,
            numResults,
          });
          pendingResults = await args.search({
            query: toolQuery,
            numResults,
            abortSignal,
          });
          await emit({
            type: "search-completed",
            query: toolQuery,
            numResults,
            results: pendingResults,
          });
          return {
            found: pendingResults.length,
            urls: pendingResults.map((result) => result.url),
          };
        },
      });

      const evaluateSearchResultsTool = tool({
        description:
          "Evaluate all pending search results and keep only relevant non-duplicate sources.",
        inputSchema: z.object({}),
        execute: async () => {
          const evaluations: Array<{
            url: string;
            verdict: "relevant" | "irrelevant";
            reason: string;
          }> = [];

          for (const candidate of pendingResults) {
            throwIfAborted(abortSignal);

            if (
              accumulatedUrls.has(candidate.url) ||
              seenCandidateUrls.has(candidate.url)
            ) {
              const duplicateReason =
                "Skipped because this source URL was already accepted earlier in the run.";
              await emit({
                type: "result-evaluated",
                query,
                result: candidate,
                verdict: "irrelevant",
                reason: duplicateReason,
              });
              evaluations.push({
                url: candidate.url,
                verdict: "irrelevant",
                reason: duplicateReason,
              });
              continue;
            }

            seenCandidateUrls.add(candidate.url);

            const { output } = await generateText({
              model: args.model,
              abortSignal,
              output: Output.object({
                schema: z.object({
                  verdict: z.enum(["relevant", "irrelevant"]),
                  reason: z.string().min(1),
                }),
              }),
              prompt: [
                `Evaluate whether this search result is useful for the query "${query}".`,
                "Mark it irrelevant if it is redundant, too generic, or clearly off-topic.",
                "",
                "<search_result>",
                JSON.stringify(candidate, null, 2),
                "</search_result>",
                "",
                "<accepted_urls>",
                JSON.stringify([...accumulatedUrls], null, 2),
                "</accepted_urls>",
              ].join("\n"),
            });

            await emit({
              type: "result-evaluated",
              query,
              result: candidate,
              verdict: output.verdict,
              reason: output.reason,
            });

            evaluations.push({
              url: candidate.url,
              verdict: output.verdict,
              reason: output.reason,
            });

            if (output.verdict === "relevant") {
              acceptedResults.push(candidate);
            }
          }

          return {
            acceptedUrls: acceptedResults.map((result) => result.url),
            evaluations,
          };
        },
      });

      const searchAgent = new ToolLoopAgent({
        model: args.model,
        instructions: [
          "You coordinate a two-step deep research process.",
          "Step 1: call searchWeb exactly once.",
          "Step 2: call evaluateSearchResults exactly once.",
          "Step 3: finish with a short confirmation.",
        ].join("\n"),
        tools: {
          searchWeb: searchWebTool,
          evaluateSearchResults: evaluateSearchResultsTool,
        },
        stopWhen: stepCountIs(3),
        prepareStep: async ({ stepNumber }) => {
          if (stepNumber === 0) {
            return {
              activeTools: ["searchWeb"],
              toolChoice: { type: "tool", toolName: "searchWeb" },
            };
          }

          if (stepNumber === 1) {
            return {
              activeTools: ["evaluateSearchResults"],
              toolChoice: { type: "tool", toolName: "evaluateSearchResults" },
            };
          }

          return {
            activeTools: [],
            toolChoice: "none",
          };
        },
      });

      await searchAgent.generate({
        prompt: `Research this query: ${query}`,
        abortSignal,
      });

      return acceptedResults;
    },
    async generateLearning({
      query,
      searchResult,
      maxFollowUpQuestions,
      abortSignal,
    }) {
      throwIfAborted(abortSignal);

      const { output } = await generateText({
        model: args.model,
        abortSignal,
        output: Output.object({
          schema: z.object({
            learning: z.string().min(1),
            followUpQuestions: z
              .array(z.string().min(1))
              .max(Math.max(1, maxFollowUpQuestions)),
          }),
        }),
        prompt: [
          `Extract one high-value learning from this relevant source for the query "${query}".`,
          "Also propose concise follow-up questions that would deepen the investigation.",
          "",
          JSON.stringify(searchResult, null, 2),
        ].join("\n"),
      });

      return {
        query,
        sourceUrl: searchResult.url,
        learning: output.learning,
        followUpQuestions: dedupeStrings(output.followUpQuestions).slice(
          0,
          Math.max(1, maxFollowUpQuestions),
        ),
      };
    },
    async generateReport({
      topic,
      queries,
      searchResults,
      learnings,
      abortSignal,
    }) {
      throwIfAborted(abortSignal);

      const { text } = await generateText({
        model: args.synthesisModel,
        abortSignal,
        system:
          "You write precise Markdown research reports for technical users. Stay grounded in the provided sources.",
        prompt: buildReportPrompt({
          topic,
          queries,
          searchResults,
          learnings,
        }),
      });

      return text.trim();
    },
  };
}

export async function executeDeepResearchWorkflow(args: {
  topic: string;
  options: Required<Pick<DeepResearchCallOptions, "depth" | "breadth">> &
    Pick<DeepResearchCallOptions, "abortSignal">;
  deps: WorkflowDependencies;
  emit?: EventEmitter;
}): Promise<DeepResearchResult> {
  const { topic, deps } = args;
  const { depth, breadth, abortSignal } = args.options;
  const emit = args.emit ?? (() => undefined);

  const startedAt = createRunTimestamp();
  const queries: string[] = [];
  const learnings: Learning[] = [];
  const searchResults: MinimalSearchResult[] = [];
  const seenQueries = new Set<string>();
  const seenUrls = new Set<string>();
  let completedQueries = 0;
  let currentStage: "research" | "report" = "research";

  await emit({
    type: "run-started",
    topic,
    depth,
    breadth,
  });

  async function researchTopic(
    currentTopic: string,
    remainingDepth: number,
    currentBreadth: number,
  ): Promise<void> {
    throwIfAborted(abortSignal);

    if (remainingDepth <= 0 || queries.length >= deps.maxQueriesPerRun) {
      return;
    }

    const generatedQueries = await deps.generateQueries({
      topic: currentTopic,
      breadth: currentBreadth,
      abortSignal,
    });

    const uniqueQueries = generatedQueries
      .map((query) => query.trim())
      .filter(Boolean)
      .filter((query) => !seenQueries.has(query))
      .slice(0, currentBreadth);

    for (const [index, query] of uniqueQueries.entries()) {
      if (queries.length >= deps.maxQueriesPerRun) {
        break;
      }

      seenQueries.add(query);
      queries.push(query);
      await emit({
        type: "query-generated",
        topic: currentTopic,
        query,
        depth: remainingDepth,
        index,
      });

      const acceptedForQuery = await deps.runSearchCoordinator({
        query,
        accumulatedUrls: seenUrls,
        emit,
        abortSignal,
      });

      for (const result of acceptedForQuery) {
        throwIfAborted(abortSignal);

        if (seenUrls.has(result.url)) {
          continue;
        }

        seenUrls.add(result.url);
        searchResults.push(result);

        const learning = await deps.generateLearning({
          query,
          searchResult: result,
          maxFollowUpQuestions: deps.maxFollowUpQuestions,
          abortSignal,
        });

        learnings.push(learning);
        await emit({
          type: "learning-generated",
          query,
          learning,
        });

        if (remainingDepth > 1 && learning.followUpQuestions.length > 0) {
          await researchTopic(
            createFollowUpTopic({
              topic,
              query,
              followUpQuestions: learning.followUpQuestions,
            }),
            remainingDepth - 1,
            Math.max(1, Math.ceil(currentBreadth / 2)),
          );
        }
      }

      completedQueries += 1;
      await emit({
        type: "depth-progress",
        topic,
        depth,
        remainingDepth,
        completedQueries,
        acceptedResults: searchResults.length,
      });
    }
  }

  try {
    await researchTopic(topic, depth, breadth);
    throwIfAborted(abortSignal);

    await emit({
      type: "report-started",
      topic,
    });

    currentStage = "report";
    const report = await deps.generateReport({
      topic,
      queries,
      searchResults,
      learnings,
      abortSignal,
    });

    await emit({
      type: "report-completed",
      topic,
      report,
    });

    const result: DeepResearchResult = {
      status: "completed",
      topic,
      queries,
      searchResults,
      learnings,
      report,
      metadata: {
        status: "completed",
        depth,
        breadth,
        startedAt,
        completedAt: createRunTimestamp(),
        researchModel: describeModel(deps.model),
        synthesisModel: describeModel(deps.synthesisModel),
        totalQueries: queries.length,
        totalAcceptedResults: searchResults.length,
      },
    };

    await emit({
      type: "run-completed",
      result,
    });

    return result;
  } catch (error) {
    const aborted = isAbortError(error);
    await emit({
      type: "run-error",
      topic,
      stage: currentStage,
      aborted,
      error: error instanceof Error ? error.message : String(error),
    });

    if (aborted) {
      return {
        status: "aborted",
        topic,
        queries,
        searchResults,
        learnings,
        report: null,
        metadata: {
          status: "aborted",
          depth,
          breadth,
          startedAt,
          completedAt: createRunTimestamp(),
          researchModel: describeModel(deps.model),
          synthesisModel: describeModel(deps.synthesisModel),
          totalQueries: queries.length,
          totalAcceptedResults: searchResults.length,
        },
      };
    }

    throw error;
  }
}

function createAsyncEventQueue<T>() {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const flush = (result: IteratorResult<T>) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(result);
      return true;
    }
    return false;
  };

  return {
    push(value: T) {
      if (closed) {
        return;
      }

      if (!flush({ value, done: false })) {
        values.push(value);
      }
    },
    end() {
      if (closed) {
        return;
      }

      closed = true;
      while (waiters.length > 0) {
        flush({ value: undefined as T, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (values.length > 0) {
          yield values.shift() as T;
          continue;
        }

        if (closed) {
          return;
        }

        const nextValue = await new Promise<IteratorResult<T>>((resolve) => {
          waiters.push(resolve);
        });

        if (nextValue.done) {
          return;
        }

        yield nextValue.value;
      }
    },
  };
}

export function streamDeepResearchWorkflow(args: {
  topic: string;
  options: Required<Pick<DeepResearchCallOptions, "depth" | "breadth">> &
    Pick<DeepResearchCallOptions, "abortSignal">;
  deps: WorkflowDependencies;
}): AsyncIterable<DeepResearchEvent> {
  const queue = createAsyncEventQueue<DeepResearchEvent>();

  void executeDeepResearchWorkflow({
    topic: args.topic,
    options: args.options,
    deps: args.deps,
    emit: async (event) => {
      queue.push(event);
    },
  })
    .catch(() => undefined)
    .finally(() => {
      queue.end();
    });

  return queue;
}
