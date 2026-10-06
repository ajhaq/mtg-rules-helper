import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_QUESTIONS_PATH = join(__dirname, "..", "..", "evals", "questions.json");

export const EvalQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  cards: z.array(z.string()),
  expected_status: z.enum(["answered", "out_of_scope", "cannot_determine"]),
  expected_answer: z.string(),
  must_cite: z.array(z.string()),
  may_cite: z.array(z.string()),
  notes: z.string(),
  reviewed: z.boolean(),
});

export type EvalQuestion = z.infer<typeof EvalQuestionSchema>;

export function loadQuestions(path: string = DEFAULT_QUESTIONS_PATH): EvalQuestion[] {
  const questions = z.array(EvalQuestionSchema).parse(JSON.parse(readFileSync(path, "utf-8")));
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate eval question id: ${q.id}`);
    ids.add(q.id);
  }
  return questions;
}
