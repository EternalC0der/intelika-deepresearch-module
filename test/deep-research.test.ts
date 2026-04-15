import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { buildReportPrompt } from "../common/deep-research/report";
import {
  executeDeepResearchWorkflow,
  streamDeepResearchWorkflow,
  type WorkflowDependencies,
} from "../common/deep-research/workflow";
import type { DeepResearchEvent, Learning, MinimalSearchResult } from "../common/deep-research/types";

const mockModel = new MockLanguageModelV3({
  provider: "mock-provider",
  modelId: "mock-model",
});

function createDeps(): WorkflowDependencies {
  const resultByQuery = new Map<string, MinimalSearchResult[]>([
    [
      "root-query",
      [
        {
          title: "Root source",
          url: "https://example.com/root",
          content: "Root content",
        },
        {
          title: "Duplicate source",
          url: "https://example.com/root",
          content: "Duplicate content",
        },
      ],
    ],
    [
      "follow-up-query",
      [
        {
          title: "Follow-up source",
          url: "https://example.com/follow-up",
          content: "Follow-up content",
        },
      ],
    ],
  ]);

  return {
    model: mockModel,
    synthesisModel: mockModel,
    maxResultsPerQuery: 3,
    maxQueriesPerRun: 10,
    maxFollowUpQuestions: 2,
    async generateQueries({ topic }) {
      if (topic.startsWith("Original topic:")) {
        return ["follow-up-query"];
      }

      return ["root-query"];
    },
    async runSearchCoordinator({ query, accumulatedUrls, emit }) {
      const results = resultByQuery.get(query) ?? [];
      await emit({
        type: "search-started",
        query,
        numResults: results.length,
      });
      await emit({
        type: "search-completed",
        query,
        numResults: results.length,
        results,
      });

      const accepted: MinimalSearchResult[] = [];
      for (const result of results) {
        const duplicate = accumulatedUrls.has(result.url);
        await emit({
          type: "result-evaluated",
          query,
          result,
          verdict: duplicate ? "irrelevant" : "relevant",
          reason: duplicate ? "duplicate" : "accepted",
        });

        if (!duplicate) {
          accepted.push(result);
        }
      }

      return accepted;
    },
    async generateLearning({ query, searchResult }) {
      const followUpQuestions =
        query === "root-query" ? ["What changed after the initial source?"] : [];

      return {
        query,
        sourceUrl: searchResult.url,
        learning: `Learning for ${searchResult.title}`,
        followUpQuestions,
      } satisfies Learning;
    },
    async generateReport({ queries, searchResults, learnings }) {
      return [
        "# Report",
        `Queries: ${queries.length}`,
        `Sources: ${searchResults.length}`,
        `Learnings: ${learnings.length}`,
      ].join("\n");
    },
  };
}

describe("deep research workflow", () => {
  test("stream emits progress and completion events", async () => {
    const deps = createDeps();
    const events: DeepResearchEvent[] = [];

    for await (const event of streamDeepResearchWorkflow({
      topic: "topic",
      options: { depth: 2, breadth: 2, abortSignal: undefined },
      deps,
    })) {
      events.push(event);
    }

    expect(events[0]?.type).toBe("run-started");
    expect(events.some((event) => event.type === "query-generated")).toBe(true);
    expect(events.some((event) => event.type === "search-started")).toBe(true);
    expect(events.some((event) => event.type === "result-evaluated")).toBe(true);
    expect(events.some((event) => event.type === "learning-generated")).toBe(true);
    expect(events.at(-1)?.type).toBe("run-completed");
  });

  test("run aggregates deduped results and follow-up research", async () => {
    const result = await executeDeepResearchWorkflow({
      topic: "topic",
      options: { depth: 2, breadth: 2, abortSignal: undefined },
      deps: createDeps(),
    });

    expect(result.status).toBe("completed");
    expect(result.queries).toEqual(["root-query", "follow-up-query"]);
    expect(result.searchResults.map((result) => result.url)).toEqual([
      "https://example.com/root",
      "https://example.com/follow-up",
    ]);
    expect(result.learnings).toHaveLength(2);
    expect(result.report).toContain("# Report");
  });

  test("respects maxQueriesPerRun and stops recursion growth", async () => {
    const deps = createDeps();
    deps.maxQueriesPerRun = 1;

    const result = await executeDeepResearchWorkflow({
      topic: "topic",
      options: { depth: 4, breadth: 4, abortSignal: undefined },
      deps,
    });

    expect(result.queries).toEqual(["root-query"]);
    expect(result.searchResults).toHaveLength(1);
  });

  test("returns a controlled aborted result and emits run-error", async () => {
    const deps = createDeps();
    const controller = new AbortController();
    const events: DeepResearchEvent[] = [];

    deps.generateQueries = async ({ abortSignal }) => {
      controller.abort();
      if (abortSignal?.aborted) {
        throw abortSignal.reason;
      }
      return ["root-query"];
    };

    const stream = streamDeepResearchWorkflow({
      topic: "topic",
      options: { depth: 2, breadth: 2, abortSignal: controller.signal },
      deps,
    });

    for await (const event of stream) {
      events.push(event);
    }

    const result = await executeDeepResearchWorkflow({
      topic: "topic",
      options: { depth: 2, breadth: 2, abortSignal: controller.signal },
      deps,
    });

    expect(events.at(-1)?.type).toBe("run-error");
    expect(result.status).toBe("aborted");
    expect(result.report).toBeNull();
  });

  test("buildReportPrompt includes the expected markdown sections", () => {
    const prompt = buildReportPrompt({
      topic: "topic",
      queries: ["root-query"],
      searchResults: [
        {
          title: "Root source",
          url: "https://example.com/root",
          content: "Root content",
        },
      ],
      learnings: [
        {
          query: "root-query",
          sourceUrl: "https://example.com/root",
          learning: "Something happened.",
          followUpQuestions: ["Why?"],
        },
      ],
    });

    expect(prompt).toContain("## Executive Summary");
    expect(prompt).toContain("## Key Findings");
    expect(prompt).toContain("## Evidence and Sources");
    expect(prompt).toContain('"topic": "topic"');
  });
});
