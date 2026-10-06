import { getDb } from "../db/client.js";
import type { RulingRecord } from "../types.js";

export function getRulingsForOracleId(oracleId: string): RulingRecord[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM rulings WHERE oracle_id = ? ORDER BY published_at ASC`)
    .all(oracleId) as unknown as RulingRecord[];
}
