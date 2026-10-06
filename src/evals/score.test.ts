import { describe, expect, it } from "vitest";
import { loadQuestions } from "./questions.js";
import { citationCoverage, unlistedCitations } from "./score.js";

describe("citationCoverage", () => {
  it("counts exact citations", () => {
    expect(citationCoverage(["602.2", "117.3c"], ["602.2", "117.3c"])).toEqual({
      hit: ["602.2", "117.3c"],
      missed: [],
    });
  });

  it("accepts a lettered subrule for a required parent rule", () => {
    expect(citationCoverage(["118.9"], ["118.9a"]).missed).toEqual([]);
  });

  it("does not accept a parent rule for a required subrule", () => {
    expect(citationCoverage(["614.1c"], ["614.1"]).missed).toEqual(["614.1c"]);
  });

  it("does not confuse rules that merely share a prefix", () => {
    expect(citationCoverage(["613.1"], ["613.10"]).missed).toEqual(["613.1"]);
    expect(citationCoverage(["702.8"], ["702.88a"]).missed).toEqual(["702.8"]);
  });

  it("reports missed rules", () => {
    expect(citationCoverage(["608.2n", "702.88a"], ["608.2n"])).toEqual({ hit: ["608.2n"], missed: ["702.88a"] });
  });
});

describe("unlistedCitations", () => {
  it("returns cited rules that are neither required nor acceptable", () => {
    expect(unlistedCitations(["118.9"], ["601.2b"], ["118.9a", "601.2b", "305.7"])).toEqual(["305.7"]);
  });
});

describe("loadQuestions", () => {
  it("loads and validates the real eval set", () => {
    const questions = loadQuestions();
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(q.must_cite.length, `${q.id} needs at least one must_cite rule`).toBeGreaterThan(0);
    }
  });
});
