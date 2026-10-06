import type { Answer } from "./schema.js";

export interface VerifiedCitation {
  rule_number: string;
  /** Rule text from the database, never the model's own quoting. Null if the rule doesn't exist. */
  text: string | null;
  exists: boolean;
  /** Whether a tool actually showed this rule to the model during this run. */
  retrieved: boolean;
}

export interface VerifiedRuling {
  card_name: string;
  published_at: string;
  comment: string | null;
}

export interface VerifiedAnswer {
  answer: Answer;
  citations: VerifiedCitation[];
  rulings: VerifiedRuling[];
  warnings: string[];
}

export interface CitationLookups {
  getRuleText: (ruleNumber: string) => string | undefined;
  retrievedRules: ReadonlySet<string>;
  getRulingComment: (cardName: string, publishedAt: string) => string | undefined;
}

/** "CR 603.2a." / "rule 603.2a" -> "603.2a" */
export function normalizeRuleNumber(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:cr|rule|rules)\s*/i, "")
    .replace(/\.$/, "")
    .trim();
}

export function verifyAnswer(answer: Answer, lookups: CitationLookups): VerifiedAnswer {
  const warnings: string[] = [];

  const seen = new Set<string>();
  const citations: VerifiedCitation[] = [];
  for (const step of answer.steps) {
    for (const raw of step.rules) {
      const ruleNumber = normalizeRuleNumber(raw);
      if (seen.has(ruleNumber)) continue;
      seen.add(ruleNumber);

      const text = lookups.getRuleText(ruleNumber) ?? null;
      const retrieved = lookups.retrievedRules.has(ruleNumber);
      citations.push({ rule_number: ruleNumber, text, exists: text !== null, retrieved });

      if (text === null) {
        warnings.push(`Cited rule ${ruleNumber} does not exist in the ingested Comprehensive Rules.`);
      } else if (!retrieved) {
        warnings.push(`Cited rule ${ruleNumber} was never retrieved by a tool during this run.`);
      }
    }
  }

  const rulings: VerifiedRuling[] = answer.card_rulings_used.map((r) => {
    const comment = lookups.getRulingComment(r.card_name, r.published_at) ?? null;
    if (comment === null) {
      warnings.push(`Could not find the cited ruling for ${r.card_name} dated ${r.published_at}.`);
    }
    return { card_name: r.card_name, published_at: r.published_at, comment };
  });

  if (answer.status === "answered" && citations.length === 0) {
    warnings.push("The answer cites no Comprehensive Rules.");
  }

  return { answer, citations, rulings, warnings };
}
