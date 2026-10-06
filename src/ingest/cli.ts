import { ingestCards, ingestRulings } from "./scryfall.js";
import { ingestRules } from "./comprehensiveRules.js";
import { ingestRuleEmbeddings } from "./embeddings.js";
import { closeDb } from "../db/client.js";

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (command) {
    case "cards":
      await ingestCards();
      await ingestRulings();
      break;
    case "rules": {
      const sourcePath = arg ?? process.env.CR_SOURCE_PATH;
      if (!sourcePath) {
        throw new Error(
          "Usage: npm run ingest:rules -- <path-to-comp-rules.txt>\n" +
            "Download the plain-text Comprehensive Rules from magic.wizards.com/en/rules " +
            "and pass its path (or set CR_SOURCE_PATH)."
        );
      }
      ingestRules(sourcePath);
      break;
    }
    case "embeddings":
      await ingestRuleEmbeddings();
      break;
    default:
      console.error("Usage: npm run ingest:cards | ingest:rules -- <path> | ingest:embeddings");
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
