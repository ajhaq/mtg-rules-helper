import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { resolveCard } from "../retrieval/cardLookup.js";
import { getRulingsForOracleId } from "../retrieval/rulings.js";
import { getRuleByNumber } from "../retrieval/rulesSearch.js";
import { verifyAnswer, type VerifiedAnswer } from "./citations.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { AnswerSchema } from "./schema.js";
import { createToolContext, createTools } from "./tools.js";

const MODEL = process.env.MTG_RULES_MODEL ?? "claude-sonnet-5-5";
const MAX_ITERATIONS = 16;

export interface AnswerResult extends VerifiedAnswer {
  /** The model that produced the final message (differs from the requested model if a refusal fallback ran). */
  model: string;
  /** Number of API requests in the tool loop. */
  iterations: number;
  /** Tool calls the model made, in order. */
  toolCalls: { tool: string; input: unknown }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export async function answerQuestion(question: string, client: Anthropic = new Anthropic()): Promise<AnswerResult> {
  const ctx = createToolContext();

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: createTools(ctx),
    messages: [{ role: "user", content: question }],
    max_iterations: MAX_ITERATIONS,
    cache_control: { type: "ephemeral" },
    output_config: { effort: "high", format: zodOutputFormat(AnswerSchema) },
    // If a safety classifier declines the request, re-run it server-side on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  let final: Anthropic.Beta.BetaMessage | undefined;
  let iterations = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for await (const message of runner) {
    final = message;
    iterations++;
    // Out of tool budget: forbid tools on the last request so the model has to answer from what it has gathered.
    if (iterations === MAX_ITERATIONS - 1 && message.stop_reason === "tool_use") {
      runner.setMessagesParams((params) => ({ ...params, tool_choice: { type: "none" } }));
    }
    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
  }

  if (!final) throw new Error("No response received from the model.");
  if (final.stop_reason === "refusal") {
    throw new Error(`The model declined to answer (category: ${final.stop_details?.category ?? "unknown"}).`);
  }
  if (final.stop_reason === "max_tokens") {
    throw new Error("The answer was cut off at max_tokens.");
  }
  if (final.stop_reason === "tool_use") {
    throw new Error(`The model was still searching after ${MAX_ITERATIONS} iterations; no answer produced.`);
  }

  const textBlock = final.content.findLast((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  if (!textBlock) throw new Error("The final response contained no text.");

  const parsed = AnswerSchema.safeParse(JSON.parse(textBlock.text));
  if (!parsed.success) {
    throw new Error(`The final response did not match the answer schema: ${parsed.error.message}`);
  }

  const verified = verifyAnswer(parsed.data, {
    getRuleText: (ruleNumber) => getRuleByNumber(ruleNumber)?.text,
    retrievedRules: ctx.retrievedRules,
    getRulingComment: (cardName, publishedAt) => {
      const card = resolveCard(cardName);
      if (!card) return undefined;
      const matches = getRulingsForOracleId(card.oracle_id).filter((r) => r.published_at === publishedAt);
      return matches.length ? matches.map((r) => r.comment).join("\n") : undefined;
    },
  });

  return { ...verified, model: final.model, iterations, toolCalls: ctx.calls, usage };
}
