import type { LanguageModel } from "ai";

export type DeepResearchInput = string | { topic: string };

export type DeepResearchStatus = "completed" | "aborted";

export interface MinimalSearchResult {
  title: string;
  url: string;
  content: string;
}

export interface Learning {
  query: string;
  sourceUrl: string;
  learning: string;
  followUpQuestions: string[];
}

export interface ModelReference {
  provider?: string;
  modelId: string;
}

export interface DeepResearchResultMetadata {
  status: DeepResearchStatus;
  depth: number;
  breadth: number;
  startedAt: string;
  completedAt: string;
  researchModel: ModelReference;
  synthesisModel: ModelReference;
  totalQueries: number;
  totalAcceptedResults: number;
}

export interface DeepResearchResult {
  status: DeepResearchStatus;
  topic: string;
  queries: string[];
  searchResults: MinimalSearchResult[];
  learnings: Learning[];
  report: string | null;
  metadata: DeepResearchResultMetadata;
}

export type DeepResearchEvent =
  | {
      type: "run-started";
      topic: string;
      depth: number;
      breadth: number;
    }
  | {
      type: "query-generated";
      topic: string;
      query: string;
      depth: number;
      index: number;
    }
  | {
      type: "search-started";
      query: string;
      numResults: number;
    }
  | {
      type: "search-completed";
      query: string;
      numResults: number;
      results: MinimalSearchResult[];
    }
  | {
      type: "result-evaluated";
      query: string;
      result: MinimalSearchResult;
      verdict: "relevant" | "irrelevant";
      reason: string;
    }
  | {
      type: "learning-generated";
      query: string;
      learning: Learning;
    }
  | {
      type: "depth-progress";
      topic: string;
      depth: number;
      remainingDepth: number;
      completedQueries: number;
      acceptedResults: number;
    }
  | {
      type: "report-started";
      topic: string;
    }
  | {
      type: "report-completed";
      topic: string;
      report: string;
    }
  | {
      type: "run-completed";
      result: DeepResearchResult;
    }
  | {
      type: "run-error";
      topic: string;
      stage: "research" | "report";
      aborted: boolean;
      error: string;
    };

export interface DeepResearchCallOptions {
  depth?: number;
  breadth?: number;
  abortSignal?: AbortSignal;
}

export type SearchExecutor = (args: {
  query: string;
  numResults: number;
  abortSignal?: AbortSignal;
}) => Promise<MinimalSearchResult[]>;

export interface CreateDeepResearchAgentConfig {
  model: LanguageModel;
  synthesisModel?: LanguageModel;
  exaApiKey?: string;
  search?: SearchExecutor;
  defaultDepth?: number;
  defaultBreadth?: number;
  maxResultsPerQuery?: number;
  maxQueriesPerRun?: number;
  maxFollowUpQuestions?: number;
  maxCharactersPerResult?: number;
}

export interface DeepResearchAgent {
  stream(
    input: DeepResearchInput,
    options?: DeepResearchCallOptions,
  ): AsyncIterable<DeepResearchEvent>;
  run(
    input: DeepResearchInput,
    options?: DeepResearchCallOptions,
  ): Promise<DeepResearchResult>;
}
