import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DEFAULT_DB_PATH = process.env.MTG_RULES_DB_PATH ?? join(DATA_DIR, "rules.sqlite");

let db: DatabaseSync | undefined;

export function getDb(
  path: string = DEFAULT_DB_PATH,
  options: { readOnly?: boolean } = {}): DatabaseSync {
  if (db) return db;

  if(options.readOnly){
    db = new DatabaseSync(path, { readOnly: true});
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }

  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  addMissingCardColumns(db);

  return db;
}

// CREATE TABLE IF NOT EXISTS won't add columns to a database built before they existed.
function addMissingCardColumns(database: DatabaseSync): void {
  const existing = new Set(
    (database.prepare("PRAGMA table_info(cards)").all() as unknown as { name: string }[]).map((c) => c.name)
  );
  for (const column of ["power", "toughness", "loyalty", "defense"]) {
    if (!existing.has(column)) database.exec(`ALTER TABLE cards ADD COLUMN ${column} TEXT`);
  }
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

/** node:sqlite has no built-in transaction helper; wrap statements in one. */
export function withTransaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}
