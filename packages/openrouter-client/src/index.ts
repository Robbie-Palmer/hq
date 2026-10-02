import OpenAI from "openai";

export { OpenAI };

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterClientOptions {
  maxRetries?: number;
  fetch?: typeof fetch;
}

export function openRouterClient(
  apiKey: string,
  options: OpenRouterClientOptions = {},
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    ...(options.maxRetries === undefined
      ? {}
      : { maxRetries: options.maxRetries }),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
