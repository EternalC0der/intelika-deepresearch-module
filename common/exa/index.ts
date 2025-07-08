import { EXA_API_KEY } from "@common/config";
import { Exa } from "exa-js";

const exa = new Exa(EXA_API_KEY);
export default exa;

export type MinimalSearchResult = {
  title: string;
  url: string;
  content: string;
};

export async function searchWeb(query: string, numResults: number = 1) {
  const { results } = await exa.searchAndContents(query, {
    numResults,
    livecrawl: "always",
  });
  return results.map(
    (r): MinimalSearchResult => ({
      title: r.title ?? "[No title]",
      url: r.url,
      content: r.text
    })
  );
}
