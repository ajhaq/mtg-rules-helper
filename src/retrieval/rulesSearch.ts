import { getDb } from "../db/client.js";
import { bufferToFloats, cosineSimilarity } from "../embeddings/provider.js";
import { localEmbeddingProvider } from "../embeddings/localProvider.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { RuleRecord, RuleSearchResult } from "../types.js";

const KEYWORD_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;

/** Exact rule-number lookup, e.g. "509.1a" or "704.5g". */
export function getRuleByNumber(ruleNumber: string): RuleRecord | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM rules WHERE rule_number = ?`).get(ruleNumber) as unknown as
    | RuleRecord
    | undefined;
}

function keywordSearch(query: string, limit: number): Map<number, number> {
  const db = getDb();
  // FTS5 needs quoted tokens to tolerate punctuation/keywords like "may" safely.
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `"${tok.replace(/"/g, '""')}"`)
    .join(" OR ");
  if (!ftsQuery) return new Map();

  const rows = db
    .prepare(
      `SELECT rules.id as id, bm25(rules_fts) as rank
       FROM rules_fts JOIN rules ON rules.id = rules_fts.rowid
       WHERE rules_fts MATCH ?
       ORDER BY rank LIMIT ?`
    )
    .all(ftsQuery, limit) as unknown as { id: number; rank: number }[];

  // bm25() in SQLite returns *lower is better*; invert and normalize to (0,1].
  const scores = new Map<number, number>();
  for (const row of rows) scores.set(row.id, 1 / (1 + Math.max(row.rank, 0)));
  return scores;
}

async function semanticSearch(
  query: string,
  limit: number,
  provider: EmbeddingProvider
): Promise<Map<number, number>> {
  const db = getDb();
  const rows = db.prepare(`SELECT rule_id, embedding FROM rule_embeddings`).all() as unknown as {
    rule_id: number;
    embedding: Uint8Array;
  }[];
  if (!rows.length) return new Map();

  const [queryVec] = await provider.embed([query]);
  const scored = rows.map((r) => ({
    id: r.rule_id,
    score: cosineSimilarity(queryVec, bufferToFloats(r.embedding)),
  }));
  scored.sort((a, b) => b.score - a.score);

  const scores = new Map<number, number>();
  for (const s of scored.slice(0, limit)) scores.set(s.id, Math.max(s.score, 0));
  return scores;
}

export interface SearchRulesOptions {
  limit?: number;
  provider?: EmbeddingProvider;
}

/**
 * Hybrid search: BM25 keyword matching (good for exact terminology like
 * "regenerate" or "state-based") combined with embedding similarity (good
 * for paraphrased questions). Scores are merged and re-ranked.
 */
export async function searchRules(query: string, options: SearchRulesOptions = {}): Promise<RuleSearchResult[]> {
  const limit = options.limit ?? 10;
  const provider = options.provider ?? localEmbeddingProvider;
  const candidatePoolSize = limit * 4;

  const [keywordScores, semanticScores] = await Promise.all([
    Promise.resolve(keywordSearch(query, candidatePoolSize)),
    semanticSearch(query, candidatePoolSize, provider),
  ]);

  const combinedIds = new Set([...keywordScores.keys(), ...semanticScores.keys()]);
  if (!combinedIds.size) return [];

  const db = getDb();
  const placeholders = [...combinedIds].map(() => "?").join(",");
  const rules = db
    .prepare(`SELECT * FROM rules WHERE id IN (${placeholders})`)
    .all(...combinedIds) as unknown as RuleRecord[];
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  const results: RuleSearchResult[] = [...combinedIds]
    .map((id) => {
      const rule = ruleById.get(id);
      if (!rule) return undefined;
      const kw = keywordScores.get(id) ?? 0;
      const sem = semanticScores.get(id) ?? 0;
      const matchType: RuleSearchResult["matchType"] =
        kw && sem ? "both" : kw ? "keyword" : "semantic";
      return { ...rule, score: kw * KEYWORD_WEIGHT + sem * SEMANTIC_WEIGHT, matchType };
    })
    .filter((r): r is RuleSearchResult => Boolean(r))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}
