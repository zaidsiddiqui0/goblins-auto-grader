import { Duration, Effect } from "effect";
import type { z } from "zod";
import { llmSpend, recordLlmUsage } from "../db";

export class BudgetExceeded extends Error {
  readonly _tag = "BudgetExceeded";
  constructor(message = "LLM budget exceeded") {
    super(message);
    this.name = this._tag;
  }
}

export class ProviderError extends Error {
  readonly _tag = "ProviderError";
  constructor(message: string, readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = this._tag;
  }
}

export class InvalidOutput extends Error {
  readonly _tag = "InvalidOutput";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this._tag;
  }
}

export class Timeout extends Error {
  readonly _tag = "Timeout";
  constructor(message = "Model request timed out") {
    super(message);
    this.name = this._tag;
  }
}

export type Message = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

type ApiResult = { status: number; body: string };

const timeoutMs = () => Number(process.env.LLM_TIMEOUT_MS ?? 45_000);
const budgetUsd = () => Number(process.env.LLM_BUDGET_USD ?? 2);

function request(messages: Message[], model: string): Effect.Effect<ApiResult, ProviderError | Timeout> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Effect.fail(new ProviderError("OPENROUTER_API_KEY is not configured", false));
  return Effect.tryPromise({
    try: async (): Promise<ApiResult> => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      });
      return { status: response.status, body: await response.text() };
    },
    catch: (error) => new ProviderError("Model provider network error", true, { cause: error }),
  }).pipe(
    Effect.timeout(Duration.millis(timeoutMs())),
    Effect.mapError((error) => error._tag === "TimeoutException" ? new Timeout() : error),
  );
}

function usageFrom(body: unknown): { promptTokens: number; completionTokens: number; costUsd: number } {
  const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } } | null)?.usage;
  return {
    promptTokens: Number(usage?.prompt_tokens ?? 0),
    completionTokens: Number(usage?.completion_tokens ?? 0),
    costUsd: Number(usage?.cost ?? 0),
  };
}

function stripJsonFences(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

/** One guarded, validated OpenRouter JSON call. */
export async function callJson<T>(
  stage: "rubric" | "reader" | "grader",
  model: string,
  initialMessages: Message[],
  schema: z.ZodType<T>,
): Promise<T> {
  const messages = [...initialMessages];
  let providerRetries = 0;
  let outputRetries = 0;

  return Effect.runPromise(Effect.gen(function* () {
    while (true) {
      if (llmSpend() >= budgetUsd()) return yield* Effect.fail(new BudgetExceeded());
      const started = Date.now();
      const result = yield* Effect.either(request(messages, model));
      const elapsed = Date.now() - started;
      let usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
      let parsedBody: unknown = null;

      if (result._tag === "Right") {
        try {
          parsedBody = JSON.parse(result.right.body);
          usage = usageFrom(parsedBody);
        } catch {
          // A non-JSON provider response is handled as invalid output below.
        }
      }

      const finish = (ok: boolean) => {
        recordLlmUsage({ stage, model, ...usage, ms: elapsed, ok });
        console.log(JSON.stringify({ stage, model, ms: elapsed, ...usage, ok }));
      };

      if (result._tag === "Left") {
        const error = result.left;
        finish(false);
        if (error instanceof ProviderError && error.retryable && providerRetries < 2) {
          providerRetries += 1;
          yield* Effect.sleep(Duration.millis(250 * 2 ** (providerRetries - 1) + Math.random() * 250));
          continue;
        }
        return yield* Effect.fail(error);
      }

      const response = result.right;
      if (response.status < 200 || response.status >= 300) {
        finish(false);
        const retryable = response.status === 429 || response.status >= 500;
        const error = new ProviderError(`Model provider returned HTTP ${response.status}`, retryable);
        if (retryable && providerRetries < 2) {
          providerRetries += 1;
          yield* Effect.sleep(Duration.millis(250 * 2 ** (providerRetries - 1) + Math.random() * 250));
          continue;
        }
        return yield* Effect.fail(error);
      }

      try {
        const content = (parsedBody as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("Missing message content");
        const parsedJson: unknown = JSON.parse(stripJsonFences(content));
        const validated = schema.safeParse(parsedJson);
        if (!validated.success) throw new Error(validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
        finish(true);
        return validated.data;
      } catch (cause) {
        finish(false);
        const message = cause instanceof Error ? cause.message : "Invalid model output";
        if (outputRetries < 1) {
          outputRetries += 1;
          messages.push({ role: "user", content: `The previous response was invalid. Validation error: ${message}. Return only corrected JSON in the requested shape.` });
          continue;
        }
        return yield* Effect.fail(new InvalidOutput(message, { cause }));
      }
    }
  }));
}
