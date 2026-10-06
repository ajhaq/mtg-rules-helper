// End-to-end sanity check that doesn't require network access to Scryfall or
// a real Comprehensive Rules download: it inserts a couple of fixture cards
// directly and parses the small synthetic CR fixture, then exercises every
// retrieval path. Run with: npm run smoke-test
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";
import { getDb, closeDb } from "../src/db/client.js";
import { ingestRules } from "../src/ingest/comprehensiveRules.js";
import { ingestRuleEmbeddings } from "../src/ingest/embeddings.js";
import { resolveCard } from "../src/retrieval/cardLookup.js";
import { getRulingsForOracleId } from "../src/retrieval/rulings.js";
import { searchRules, getRuleByNumber } from "../src/retrieval/rulesSearch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SMOKE_DB_PATH = join(__dirname, "..", "data", "smoke.sqlite");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

async function main() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = SMOKE_DB_PATH + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
  const db = getDb(SMOKE_DB_PATH);

  db.prepare(
    `INSERT INTO cards (oracle_id, name, normalized_name, mana_cost, type_line, oracle_text, colors, scryfall_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "fixture-bolt",
    "Lightning Bolt",
    "lightning bolt",
    "{R}",
    "Instant",
    "Lightning Bolt deals 3 damage to any target.",
    JSON.stringify(["R"]),
    "https://scryfall.com/fixture-bolt"
  );
  db.prepare(`INSERT INTO rulings (oracle_id, published_at, comment) VALUES (?, ?, ?)`).run(
    "fixture-bolt",
    "2004-10-04",
    "Any target includes creatures, players, or planeswalkers."
  );

  const fixtureRulesPath = join(__dirname, "..", "data", "fixtures", "comp-rules-fixture.txt");
  const { rules, glossary } = ingestRules(fixtureRulesPath);
  assert(rules === 6, `parsed 6 fixture rules (got ${rules})`);
  assert(glossary === 2, `parsed 2 fixture glossary terms (got ${glossary})`);

  const rule509_1a = getRuleByNumber("509.1a");
  assert(!!rule509_1a, "rule 509.1a is retrievable by exact number");
  assert(rule509_1a!.section_title === "Combat Damage Step", "509.1a has the right section title");

  console.log("\nGenerating embeddings (downloads a small local model on first run)...");
  await ingestRuleEmbeddings();

  const exact = resolveCard("Lightning Bolt");
  assert(exact?.oracle_id === "fixture-bolt", "exact card lookup works");

  const typo = resolveCard("Lighming Bolt");
  assert(typo?.oracle_id === "fixture-bolt", "fuzzy card lookup tolerates a typo");

  const gibberish = resolveCard("zzzqqqxxx nonexistent card");
  assert(gibberish === undefined, "fuzzy card lookup rejects garbage input");

  const rulings = getRulingsForOracleId("fixture-bolt");
  assert(rulings.length === 1, "rulings lookup returns the fixture ruling");

  const keywordHit = await searchRules("first strike ordering");
  assert(
    keywordHit.some((r) => r.rule_number === "509.1a"),
    "hybrid search finds 509.1a for a keyword-heavy query"
  );

  const semanticHit = await searchRules("what happens when combat damage is dealt");
  assert(semanticHit.length > 0, "hybrid search returns results for a paraphrased query");

  console.log("\nAll smoke tests passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
