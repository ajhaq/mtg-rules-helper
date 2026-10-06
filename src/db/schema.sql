-- Card Oracle data, one row per unique card (by oracle_id)
CREATE TABLE IF NOT EXISTS cards (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  mana_cost TEXT,
  type_line TEXT,
  oracle_text TEXT,
  colors TEXT,
  scryfall_uri TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_normalized_name ON cards (normalized_name);

-- Official rulings, many per card
CREATE TABLE IF NOT EXISTS rulings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oracle_id TEXT NOT NULL REFERENCES cards (oracle_id),
  published_at TEXT,
  comment TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rulings_oracle_id ON rulings (oracle_id);

-- Comprehensive Rules, chunked one row per numbered (sub)rule, e.g. "509.1a"
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_number TEXT NOT NULL UNIQUE,
  chapter_title TEXT,
  section_number TEXT,
  section_title TEXT,
  text TEXT NOT NULL
);

-- Keyword search over rule text (BM25)
CREATE VIRTUAL TABLE IF NOT EXISTS rules_fts USING fts5 (
  rule_number,
  text,
  content='rules',
  content_rowid='id'
);

-- Keep rules_fts in sync with rules
CREATE TRIGGER IF NOT EXISTS rules_ai AFTER INSERT ON rules BEGIN
  INSERT INTO rules_fts (rowid, rule_number, text) VALUES (new.id, new.rule_number, new.text);
END;

CREATE TRIGGER IF NOT EXISTS rules_ad AFTER DELETE ON rules BEGIN
  INSERT INTO rules_fts (rules_fts, rowid, rule_number, text) VALUES ('delete', old.id, old.rule_number, old.text);
END;

CREATE TRIGGER IF NOT EXISTS rules_au AFTER UPDATE ON rules BEGIN
  INSERT INTO rules_fts (rules_fts, rowid, rule_number, text) VALUES ('delete', old.id, old.rule_number, old.text);
  INSERT INTO rules_fts (rowid, rule_number, text) VALUES (new.id, new.rule_number, new.text);
END;

-- Vector embeddings for semantic search over rules, one row per rule
CREATE TABLE IF NOT EXISTS rule_embeddings (
  rule_id INTEGER PRIMARY KEY REFERENCES rules (id),
  dims INTEGER NOT NULL,
  embedding BLOB NOT NULL
);

-- Glossary terms parsed from the end of the Comprehensive Rules
CREATE TABLE IF NOT EXISTS glossary (
  term TEXT PRIMARY KEY,
  definition TEXT NOT NULL
);
