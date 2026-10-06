import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DEFAULT_DB_PATH = join(DATA_DIR, "rules.sqlite");

let db: DatabaseSync | undefined;

export function getDb(path: string = DEFAULT_DB_PATH): DatabaseSync {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  return db;
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
