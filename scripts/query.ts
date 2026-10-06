// Manual retrieval demo against the real ingested database.
// Usage: npm run query -- "does first strike stop trample damage"
// Usage: npm run query -- --card "Fog Bank"
import { closeDb } from "../src/db/client.js";
import { resolveCard } from "../src/retrieval/cardLookup.js";
import { getRulingsForOracleId } from "../src/retrieval/rulings.js";
import { searchRules } from "../src/retrieval/rulesSearch.js";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--card") {
    const name = args.slice(1).join(" ");
    const card = resolveCard(name);
    if (!card) {
      console.log(`No card found matching "${name}"`);
      return;
    }
    console.log(`${card.name} ${card.mana_cost ?? ""}`);
    console.log(card.type_line);
    console.log(card.oracle_text);
    console.log("\nRulings:");
    for (const r of getRulingsForOracleId(card.oracle_id)) {
      console.log(`  [${r.published_at}] ${r.comment}`);
    }
    return;
  }

  const query = args.join(" ");
  if (!query) {
    console.error('Usage: npm run query -- "your rules question" | --card "<name>"');
    process.exitCode = 1;
    return;
  }

  const results = await searchRules(query, { limit: 8 });
  if (!results.length) {
    console.log("No matching rules found.");
    return;
  }
  for (const r of results) {
    console.log(`\n[${r.rule_number}] (${r.matchType}, score=${r.score.toFixed(3)}) ${r.section_title ?? ""}`);
    console.log(r.text);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
