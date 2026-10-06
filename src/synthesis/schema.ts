import { z } from "zod";

export const AnswerSchema = z.object({
  status: z
    .enum(["answered", "out_of_scope", "cannot_determine"])
    .describe(
      "answered: resolved using retrieved rules. out_of_scope: not a Magic rules-interaction question (e.g. tournament policy). cannot_determine: the retrieved rules and card text do not support a confident answer."
    ),
  short_answer: z
    .string()
    .describe("The direct answer to show the user. For non-'answered' statuses, a brief explanation of why."),
  steps: z
    .array(
      z.object({
        explanation: z.string().describe("One step of the resolution, in plain language."),
        rules: z
          .array(z.string())
          .describe(
            "Comprehensive Rules numbers supporting this step, e.g. '603.2a'. Only numbers retrieved via tools. Never put card rulings, dates or card names here; those go in card_rulings_used."
          ),
      })
    )
    .describe("Step-by-step resolution in the order things happen in the game. Empty unless status is 'answered'."),
  card_rulings_used: z
    .array(
      z.object({
        card_name: z.string(),
        published_at: z.string().describe("The ruling's date exactly as returned by lookup_card, e.g. '2016-06-08'."),
      })
    )
    .describe("Official card rulings that support the answer."),
  caveats: z
    .array(z.string())
    .describe("Assumptions made about the board state, or details that would change the answer."),
});

export type Answer = z.infer<typeof AnswerSchema>;
