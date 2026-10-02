# OpenRouter client

This package configures the OpenAI SDK for OpenRouter's API origin. Callers own
model selection, prompts, schemas, provider routing, retention policy, request
budgets, and retry policy.

AI review disables SDK retries for paid completion requests because OpenRouter
does not provide an idempotency key. Recipe parsing uses the SDK default.
