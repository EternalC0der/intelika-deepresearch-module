import type { Learning, MinimalSearchResult } from "./types";

export function buildReportPrompt(args: {
  topic: string;
  queries: string[];
  searchResults: MinimalSearchResult[];
  learnings: Learning[];
}): string {
  const payload = {
    topic: args.topic,
    queries: args.queries,
    searchResults: args.searchResults,
    learnings: args.learnings,
  };

  return [
    "Generate a research report in Markdown.",
    "Use the following structure exactly:",
    "1. # Title",
    "2. ## Executive Summary",
    "3. ## Key Findings",
    "4. ## Evidence and Sources",
    "5. ## Open Questions",
    "6. ## Recommended Next Steps",
    "Cite source URLs inline where relevant.",
    "Base every claim on the supplied research context.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
