import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { generateObject, generateText, tool } from "ai";
import { z } from "zod";
import { type MinimalSearchResult } from "@common/exa";
import SearchWebTool from "@common/ai/tools/SearchWebTool";
import SearchResultEvalTool from "@common/ai/tools/SearchResultEvalTool";

// Config
// ------
const agentModel = openai("gpt-4.1-mini");
const synthModel = google("gemini-2.0-flash-lite");

// ---------------
type Learning = {
  learning: string;
  followUpQuestions: string[];
};

type Research = {
  query?: string;
  queries: string[];
  searchResults: MinimalSearchResult[];
  learnings: Learning[];
  completedQueries: string[];
};

const accumulatedResearch: Research = {
  query: undefined,
  queries: [],
  searchResults: [],
  learnings: [],
  completedQueries: [],
};

async function deepResearch(
  prompt: string,
  depth: number = 2,
  breadth: number = 2
) {
  // Set the initial query
  if (!accumulatedResearch.query) accumulatedResearch.query = prompt;

  // If depth is 0, deepResearch is complete
  if (depth <= 0) return accumulatedResearch;

  // Generate search queries
  const queries = await generateSearchQueries(prompt, breadth);
  accumulatedResearch.queries = queries;

  // Search and process each query
  for (const query of queries) {
    const searchResults = await searchAndProcess(query);
    accumulatedResearch.searchResults.push(...searchResults);
    for (const searchResult of searchResults) {
      console.log(`Processing search result: ${searchResult.url}`);
      const learnings = await generateLearnings(query, searchResult);
      accumulatedResearch.learnings.push(learnings);
      accumulatedResearch.completedQueries.push(query);

      // Call deepResearch recursively with decrementing depth and breadth
      const newQuery = `Overall research goal: ${prompt}
        Previous search queries: ${accumulatedResearch.completedQueries.join(
          ", "
        )}

        Follow-up questions: ${learnings.followUpQuestions.join(", ")}
        `;
      await deepResearch(newQuery, depth - 1, Math.ceil(breadth / 2));
    }
  }

  return accumulatedResearch;
}

async function searchAndProcess(query: string) {
  const pendingSearchResults: MinimalSearchResult[] = [];
  const finalSearchResults: MinimalSearchResult[] = [];

  // Instantiate the search web tool
  const { tool: searchWebTool } = new SearchWebTool({
    hooks: {
      beforeExecute: (params) => {
        console.log(`[AGENT: SearchWeb] Searching '${params.query}'`);
      },
      afterExecute: (result) => {
        console.log("[AGENT: SearchWeb] Found:", result.at(-1)?.url);
        pendingSearchResults.push(...result);
      },
    },
  });

  // Instantiate the evaluation tool
  const { tool: evaluateSearchResult } = new SearchResultEvalTool({
    hooks: {
      beforeExecute: ({ pendingResult }) => {
        console.log(
          `[AGENT: EvaluateSearchResult] Evaluating '${pendingResult.url}'`
        );
      },
      afterExecute: (result, { pendingResult }) => {
        console.log(
          `[AGENT: EvaluateSearchResult] Evaluated '${pendingResult.url}' as ${result}`
        );
        if (result === "relevant") finalSearchResults.push(pendingResult);
      },
    },
    contextProvider: {
      getContext: () => {
        return {
          model: agentModel,
          query,
          pendingResult: pendingSearchResults.pop()!,
          accumulatedSources: accumulatedResearch.searchResults,
        };
      },
    },
  });

  await generateText({
    model: agentModel,
    prompt: `Search the web for information about ${query}`,
    system:
      "You are a researcher, For each query, search the web and then evaluate if the results are relevant and will help answer the following query",
    maxSteps: 5,
    tools: {
      searchWeb: searchWebTool,
      evaluateSearchResult: evaluateSearchResult,
    },
  });

  return finalSearchResults;
}

const generateLearnings = async (
  query: string,
  searchResult: MinimalSearchResult
) => {
  const { object } = await generateObject({
    model: agentModel,
    prompt: `The user is researching "${query}". The following search result were deemed relevant.
    Generate a learning and a follow-up question from the following search result:

    <search_result>
    ${JSON.stringify(searchResult)}
    </search_result>
      `,
    schema: z.object({
      learning: z.string(),
      followUpQuestions: z.array(z.string()),
    }),
  });
  return object;
};

async function generateSearchQueries(query: string, n: number = 3) {
  const {
    object: { queries },
  } = await generateObject({
    model: agentModel,
    prompt: `Generate ${n} search queries for the following query: ${query}`,
    schema: z.object({
      queries: z.array(z.string()).min(1).max(5),
    }),
  });

  return queries;
}

async function generateReport(research: Research) {
  const SYSTEM_PROMPT = `You are an expert researcher. Today is ${new Date().toISOString()}. Follow these instructions when responding:
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
  - Use Markdown formatting.`;
  const { text } = await generateText({
    model: synthModel,
    system: SYSTEM_PROMPT,
    prompt:
      "Generate a report based on the following research data:\n\n" +
      JSON.stringify(research, null, 2),
  });
  return text;
}

// ---------------
const research = await deepResearch(`What is Longevity Escape Velocity? And how AI can help humans achieve it?`);
console.log("--------------------------------");
console.log('Research completed!')
console.log('Generating report...')
const report = await generateReport(research)
console.log('Report generated!')
const fileName = `report-${new Date().toISOString().split('T')[0]}.md`
Bun.write(fileName, report)
console.log(`Report written to ${fileName}`)
