import type { LanguageModel } from "ai";
import type {
  DeepResearchInput,
  ModelReference,
  SupportedModelProvider,
} from "./types";

export function normalizeTopic(input: DeepResearchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if ("topic" in input) {
    return input.topic;
  }

  return input.prompt;
}

export function describeModel(model: LanguageModel): ModelReference {
  if (typeof model === "string") {
    const [provider, ...rest] = model.split("/");
    return {
      provider: rest.length > 0 ? provider : undefined,
      modelId: rest.length > 0 ? rest.join("/") : model,
    };
  }

  const candidate = model as { provider?: unknown; modelId?: unknown };
  return {
    provider:
      typeof candidate.provider === "string" ? candidate.provider : undefined,
    modelId:
      typeof candidate.modelId === "string" ? candidate.modelId : "unknown",
  };
}

export function createRunTimestamp(): string {
  return new Date().toISOString();
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function parseModelReference(model: string): {
  provider?: SupportedModelProvider;
  modelId: string;
} {
  const trimmed = model.trim();
  const [provider, ...rest] = trimmed.split("/");

  if (
    (provider === "anthropic" || provider === "google" || provider === "openai") &&
    rest.length > 0
  ) {
    return {
      provider,
      modelId: rest.join("/"),
    };
  }

  if (trimmed.startsWith("claude-")) {
    return { provider: "anthropic", modelId: trimmed };
  }

  if (trimmed.startsWith("gemini-")) {
    return { provider: "google", modelId: trimmed };
  }

  if (
    trimmed.startsWith("gpt-") ||
    trimmed.startsWith("o1") ||
    trimmed.startsWith("o3") ||
    trimmed.startsWith("o4")
  ) {
    return { provider: "openai", modelId: trimmed };
  }

  return { modelId: trimmed };
}

export function createFollowUpTopic(args: {
  topic: string;
  query: string;
  followUpQuestions: string[];
}): string {
  return [
    `Original topic: ${args.topic}`,
    `Previous query: ${args.query}`,
    `Follow-up questions: ${args.followUpQuestions.join(" | ")}`,
  ].join("\n");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}
