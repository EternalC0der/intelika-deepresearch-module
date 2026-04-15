import { Exa } from "exa-js";
import type { SearchExecutor } from "./types";

export function createExaSearchExecutor(args: {
  apiKey: string;
  maxCharactersPerResult?: number;
}): SearchExecutor {
  const exa = new Exa(args.apiKey);
  const maxCharactersPerResult = args.maxCharactersPerResult ?? 4_000;

  return async ({ query, numResults }) => {
    const response = await exa.search(query, {
      numResults,
      contents: {
        livecrawl: "preferred",
        text: {
          maxCharacters: maxCharactersPerResult,
        },
      },
    });

    return response.results.map((result) => ({
      title: result.title ?? "[Untitled]",
      url: result.url,
      content: "text" in result && typeof result.text === "string"
        ? result.text
        : "",
    }));
  };
}
