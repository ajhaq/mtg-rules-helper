import { closest, distance } from "fastest-levenshtein";
import { getDb } from "../db/client.js";
import type { CardRecord } from "../types.js";

const MAX_FUZZY_DISTANCE_RATIO = 0.25; // allow ~1 typo per 4 characters

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function findCardByExactName(name: string): CardRecord | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM cards WHERE normalized_name = ?`)
    .get(normalize(name)) as unknown as CardRecord | undefined;
}

export function findCardsByContains(fragment: string, limit = 10): CardRecord[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM cards WHERE normalized_name LIKE ? LIMIT ?`)
    .all(`%${normalize(fragment)}%`, limit) as unknown as CardRecord[];
}

//best-effort card resolution: exact match, then substring, then fuzzy (levenshtein). returns undefined if nothing close enough
export function resolveCard(nameGuess: string): CardRecord | undefined {
  const exact = findCardByExactName(nameGuess);
  if (exact) return exact;

  const contains = findCardsByContains(nameGuess, 1);
  if (contains[0]) return contains[0];

  const db = getDb();
  const all = db.prepare(`SELECT oracle_id, normalized_name FROM cards`).all() as unknown as Pick<
    CardRecord,
    "oracle_id" | "normalized_name"
  >[];
  const names = all.map((c) => c.normalized_name);
  if (!names.length) return undefined;

  const target = normalize(nameGuess);
  const nearest = closest(target, names);
  const maxDistance = Math.ceil(target.length * MAX_FUZZY_DISTANCE_RATIO);
  if (distance(target, nearest) > maxDistance) return undefined;

  return findCardByExactName(nearest);
}
