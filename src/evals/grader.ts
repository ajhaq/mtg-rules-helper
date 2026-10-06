import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Answer } from "../synthesis/schema.js";
import type { EvalQuestion } from "./questions.js";

const GRADER_MODEL = process.env.MTG_RULES_GRADER_MODEL ?? process.env.MTG_RULES_MODEL ?? "claude-sonnet-5-5";

export const GradeSchema = z.object({
  verdict: z
    .enum(["correct", "partially_correct", "incorrect"])
    .describe("correct, partially_correct or incorrect, per the grading rules."),
  reasoning: z.string().describe("Two or three sentences explaining the verdict."),
  missed_points: z
    .array(z.string())
    .describe("Key points of the reference answer that the candidate answer omits or gets wrong. Empty if none."),
  contradictions: z
    .array(z.string())
    .describe("Statements in the candidate answer that contradict the reference answer. Empty if none."),
});

export type Grade = z.infer<typeof GradeSchema>;

const GRADER_SYSTEM = `You grade answers produced by a Magic: The Gathering rules assistant against a reference answer written and checked by a person.

Compare the CANDIDATE answer to the REFERENCE answer. First identify the reference's headline outcomes: the specific results the question is asking about (for example "the card returns as a land and may copy another permanent", or "the creature is 4/5"). Then decide:
- correct: the candidate states every headline outcome of the reference definitively, and the mechanism it gives is consistent with the reference. Extra details are fine if the reference doesn't contradict them. Omitting secondary details of the reference (supporting examples, side effects, edge cases that aren't what the question asks about) is fine.
- partially_correct: the candidate reaches the right conclusion for the wrong reason or without the key mechanism the reference relies on; or it omits a headline outcome; or it mentions a headline outcome only as a hedge or possibility (for example in a caveat) instead of stating it as the result; or the question has several parts and only some are right.
- incorrect: the candidate's conclusion differs from the reference, the candidate declines or says it cannot determine the answer, or it asserts something the reference contradicts that matters to the conclusion.

Hedging on a headline outcome does not make an answer correct. Hedging on a secondary detail is fine.

Grade against the reference only. Do not use your own memory of the rules to overrule it, and do not reward a candidate for citing rule numbers. If the candidate states something the reference says nothing about, ignore it unless it conflicts with the conclusion.`;

export function formatCandidateAnswer(answer: Answer): string {
  const lines = [`Status: ${answer.status}`, `Answer: ${answer.short_answer}`];
  if (answer.steps.length) {
    lines.push("Steps:");
    answer.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s.explanation}`));
  }
  if (answer.caveats.length) {
    lines.push("Caveats:");
    for (const c of answer.caveats) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}

export interface GradeResult {
  grade: Grade;
  usage: { input_tokens: number; output_tokens: number };
}

export async function gradeAnswer(
  question: EvalQuestion,
  answer: Answer,
  client: Anthropic = new Anthropic()
): Promise<GradeResult> {
  const message = await client.messages.parse({
    model: GRADER_MODEL,
    max_tokens: 4000,
    system: GRADER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `QUESTION:\n${question.question}\n\nREFERENCE ANSWER:\n${question.expected_answer}\n\nCANDIDATE ANSWER:\n${formatCandidateAnswer(answer)}`,
      },
    ],
    output_config: { format: zodOutputFormat(GradeSchema) },
  });

  if (!message.parsed_output) {
    throw new Error(`Grader returned no parseable grade (stop_reason: ${message.stop_reason}).`);
  }
  return {
    grade: message.parsed_output,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
}
