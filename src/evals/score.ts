export interface CitationCoverage {
  hit: string[];
  missed: string[];
}

/**
 * A required rule is covered if the answer cited it, or cited one of its lettered subrules
 * (requiring 118.9 is satisfied by citing 118.9a, but requiring 614.1c is not satisfied by 614.1).
 */
export function citationCoverage(mustCite: string[], cited: string[]): CitationCoverage {
  const covers = (required: string, candidate: string) =>
    candidate === required ||
    (candidate.startsWith(required) && /^[a-z]+$/.test(candidate.slice(required.length)));

  const hit: string[] = [];
  const missed: string[] = [];
  for (const required of mustCite) {
    (cited.some((c) => covers(required, c)) ? hit : missed).push(required);
  }
  return { hit, missed };
}

/** Cited rules that the question's author listed neither as required nor as acceptable. */
export function unlistedCitations(mustCite: string[], mayCite: string[], cited: string[]): string[] {
  const listed = [...mustCite, ...mayCite];
  return cited.filter((c) => !listed.some((l) => c === l || (c.startsWith(l) && /^[a-z]+$/.test(c.slice(l.length)))));
}
