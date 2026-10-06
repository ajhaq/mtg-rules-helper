import { describe, expect, it } from "vitest";
import { normalizeRuleNumber, verifyAnswer, type CitationLookups } from "./citations.js";
import type { Answer } from "./schema.js";

const RULES: Record<string, string> = {
  "603.2": "Whenever a game event matches a triggered ability's trigger event...",
  "603.10a": "Some zone-change triggers look back in time...",
};

function makeLookups(retrieved: string[], rulings: Record<string, string> = {}): CitationLookups {
  return {
    getRuleText: (n) => RULES[n],
    retrievedRules: new Set(retrieved),
    getRulingComment: (card, date) => rulings[`${card}|${date}`],
  };
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    status: "answered",
    short_answer: "Yes.",
    steps: [],
    card_rulings_used: [],
    caveats: [],
    ...overrides,
  };
}

describe("normalizeRuleNumber", () => {
  it("strips CR/rule prefixes and trailing periods", () => {
    expect(normalizeRuleNumber("CR 603.2a.")).toBe("603.2a");
    expect(normalizeRuleNumber("rule 603.10a")).toBe("603.10a");
    expect(normalizeRuleNumber("  603.2 ")).toBe("603.2");
  });
});

describe("verifyAnswer", () => {
  it("takes rule text from the database and dedupes citations", () => {
    const answer = makeAnswer({
      steps: [
        { explanation: "a", rules: ["603.2", "CR 603.10a"] },
        { explanation: "b", rules: ["603.2"] },
      ],
    });
    const result = verifyAnswer(answer, makeLookups(["603.2", "603.10a"]));
    expect(result.citations.map((c) => c.rule_number)).toEqual(["603.2", "603.10a"]);
    expect(result.citations[0].text).toBe(RULES["603.2"]);
    expect(result.warnings).toEqual([]);
  });

  it("flags a cited rule that does not exist", () => {
    const answer = makeAnswer({ steps: [{ explanation: "a", rules: ["999.9z"] }] });
    const result = verifyAnswer(answer, makeLookups([]));
    expect(result.citations[0]).toMatchObject({ exists: false, text: null });
    expect(result.warnings[0]).toContain("999.9z does not exist");
  });

  it("flags a real rule that no tool ever showed the model", () => {
    const answer = makeAnswer({ steps: [{ explanation: "a", rules: ["603.2"] }] });
    const result = verifyAnswer(answer, makeLookups([]));
    expect(result.citations[0]).toMatchObject({ exists: true, retrieved: false });
    expect(result.warnings[0]).toContain("never retrieved");
  });

  it("flags an answered result with no citations, but not a decline", () => {
    expect(verifyAnswer(makeAnswer(), makeLookups([])).warnings).toContain(
      "The answer cites no Comprehensive Rules."
    );
    expect(verifyAnswer(makeAnswer({ status: "out_of_scope" }), makeLookups([])).warnings).toEqual([]);
  });

  it("hydrates rulings from the database and flags ones it cannot find", () => {
    const answer = makeAnswer({
      steps: [{ explanation: "a", rules: ["603.2"] }],
      card_rulings_used: [
        { card_name: "Blood Artist", published_at: "2016-06-08" },
        { card_name: "Blood Artist", published_at: "1999-01-01" },
      ],
    });
    const result = verifyAnswer(answer, makeLookups(["603.2"], { "Blood Artist|2016-06-08": "It triggers for each." }));
    expect(result.rulings[0].comment).toBe("It triggers for each.");
    expect(result.rulings[1].comment).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });
});
