# Intelika Deep Research Module

A small TypeScript/Bun module for running iterative web research workflows with AI SDK models.

It generates search queries, retrieves sources, filters relevant results, extracts learnings, and synthesizes a final Markdown report.

## What It Does

- Generates research queries from a topic or prompt
- Searches the web through Exa or a custom search executor
- Evaluates and deduplicates sources
- Extracts structured learnings and follow-up questions
- Recurses by depth and breadth
- Produces a final Markdown report plus structured metadata
- Streams progress events while the run is executing

## Requirements

- Bun
- One model provider API key:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_GENERATIVE_AI_API_KEY`
- Search access:
  - `EXA_API_KEY`, or
  - a custom `search` implementation

## Installation

```bash
bun install
```

## Exports

```ts
import {
  createDeepResearchAgent,
  createDeepResearchAgentFromConfig,
  runDeepResearchFromConfig,
  streamDeepResearchFromConfig,
  createExaSearchExecutor,
} from "intelika-deepresearch-module";
```

## Quick Start

### 1. Run with model instances

Use this when you already construct AI SDK models yourself.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createDeepResearchAgent } from "./index.ts";

const agent = createDeepResearchAgent({
  model: anthropic("claude-haiku-4-5-20251001"),
  synthesisModel: anthropic("claude-haiku-4-5-20251001"),
  exaApiKey: process.env.EXA_API_KEY,
  defaultDepth: 1,
  defaultBreadth: 1,
});

const result = await agent.run("Analyze trends in enterprise AI adoption for 2026");

console.log(result.report);
```

### 2. Run with a config object

Use this when you want to pass model ids and runtime settings directly.

```ts
import { runDeepResearchFromConfig } from "./index.ts";

const result = await runDeepResearchFromConfig({
  prompt: "Analyze trends in enterprise AI adoption for 2026",
  researchModel: "claude-haiku-4-5-20251001",
  synthesisModel: "claude-haiku-4-5-20251001",
  depth: 1,
  breadth: 1,
});

console.log(result.metadata);
console.log(result.report);
```

The config-based helpers support:

- plain model ids such as `claude-haiku-4-5-20251001`, `gpt-4.1`, or `gemini-2.5-pro`
- prefixed model ids such as `anthropic/claude-haiku-4-5-20251001`
- explicit `modelProvider` values: `anthropic`, `openai`, `google`

If the model id does not include a provider prefix, the module will infer the provider from the model name or from the single configured provider key in the environment.

## CLI Examples

### Showcase script

This script expects a topic string and explicit environment variables.

```bash
AI_PROVIDER=openai \
AI_MODEL=gpt-4.1-mini \
AI_SYNTH_MODEL=gpt-4.1-mini \
RESEARCH_DEPTH=2 \
RESEARCH_BREADTH=2 \
EXA_API_KEY=... \
OPENAI_API_KEY=... \
bun run examples/showcase.ts "Your research topic"
```

### JSON config script

This script accepts one JSON argument.

```bash
bun run examples/run-config.ts '{"prompt":"Analyze trends in enterprise AI adoption for 2026","researchModel":"claude-haiku-4-5-20251001","synthesisModel":"claude-haiku-4-5-20251001","depth":1,"breadth":1}'
```

This exact config has been smoke-tested in this repo.

## Input Shapes

### `createDeepResearchAgent(config)`

```ts
type CreateDeepResearchAgentConfig = {
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
};
```

### `runDeepResearchFromConfig(config)` and `streamDeepResearchFromConfig(config)`

```ts
type DeepResearchRunConfig = {
  prompt: string;
  researchModel: LanguageModel | string;
  synthesisModel?: LanguageModel | string;
  modelProvider?: "anthropic" | "google" | "openai";
  exaApiKey?: string;
  search?: SearchExecutor;
  depth?: number;
  breadth?: number;
  maxResultsPerQuery?: number;
  maxQueriesPerRun?: number;
  maxFollowUpQuestions?: number;
  maxCharactersPerResult?: number;
};
```

### Search executor

If you do not want to use Exa, provide your own search function:

```ts
type SearchExecutor = (args: {
  query: string;
  numResults: number;
  abortSignal?: AbortSignal;
}) => Promise<Array<{
  title: string;
  url: string;
  content: string;
}>>;
```

## Streaming Events

`agent.stream(...)` and `streamDeepResearchFromConfig(...)` return an async iterable of events:

- `run-started`
- `query-generated`
- `search-started`
- `search-completed`
- `result-evaluated`
- `learning-generated`
- `depth-progress`
- `report-started`
- `report-completed`
- `run-completed`
- `run-error`

Example:

```ts
for await (const event of agent.stream({ prompt: "Analyze trends in enterprise AI adoption for 2026" })) {
  if (event.type === "query-generated") {
    console.log(event.query);
  }

  if (event.type === "run-completed") {
    console.log(event.result.report);
  }
}
```

## Result Shape

Successful runs return:

```ts
type DeepResearchResult = {
  status: "completed" | "aborted";
  topic: string;
  queries: string[];
  searchResults: Array<{
    title: string;
    url: string;
    content: string;
  }>;
  learnings: Array<{
    query: string;
    sourceUrl: string;
    learning: string;
    followUpQuestions: string[];
  }>;
  report: string | null;
  metadata: {
    status: "completed" | "aborted";
    depth: number;
    breadth: number;
    startedAt: string;
    completedAt: string;
    researchModel: {
      provider?: string;
      modelId: string;
    };
    synthesisModel: {
      provider?: string;
      modelId: string;
    };
    totalQueries: number;
    totalAcceptedResults: number;
  };
};
```

## Notes

- `createDeepResearchAgent` requires either `config.search` or an Exa API key.
- Input can be passed as a string, `{ topic: string }`, or `{ prompt: string }`.
- Defaults are `depth=2` and `breadth=3` unless overridden.
- The final report is Markdown.
- If the run is aborted, the result status becomes `aborted` and `report` is `null`.

## Development

```bash
bun test
bun x tsc --noEmit
```
