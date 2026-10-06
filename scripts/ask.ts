// Ask a rules question end to end (retrieval + Claude).
// Usage: npm run ask -- "Does Blood Artist trigger if it dies at the same time as another creature?"
// Needs Claude credentials: set ANTHROPIC_API_KEY (or run `ant auth login`).
import Anthropic from "@anthropic-ai/sdk";
import { closeDb } from "../src/db/client.js";
import { answerQuestion } from "../src/synthesis/answer.js";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run ask -- "your rules question"');
    process.exitCode = 1;
    return;
  }

  const result = await answerQuestion(question);
  const { answer } = result;

  console.log(`\n[${answer.status}] ${answer.short_answer}`);

  if (answer.steps.length) {
    console.log("\nResolution:");
    answer.steps.forEach((step, i) => {
      const rules = step.rules.length ? `  (CR ${step.rules.join(", ")})` : "";
      console.log(`  ${i + 1}. ${step.explanation}${rules}`);
    });
  }

  if (result.citations.length) {
    console.log("\nRules cited (text from the database):");
    for (const c of result.citations) {
      console.log(`  ${c.rule_number}: ${c.text ?? "NOT FOUND"}`);
    }
  }

  if (result.rulings.length) {
    console.log("\nCard rulings used:");
    for (const r of result.rulings) {
      console.log(`  ${r.card_name} [${r.published_at}]: ${r.comment ?? "NOT FOUND"}`);
    }
  }

  if (answer.caveats.length) {
    console.log("\nCaveats:");
    for (const c of answer.caveats) console.log(`  - ${c}`);
  }

  if (result.warnings.length) {
    console.log("\nCITATION WARNINGS:");
    for (const w of result.warnings) console.log(`  ! ${w}`);
  }

  const u = result.usage;
  console.log(
    `\n(${result.model}, ${result.iterations} requests; input: ${u.input_tokens} uncached + ${u.cache_creation_input_tokens} cache-write + ${u.cache_read_input_tokens} cache-read; output: ${u.output_tokens})`
  );
}

main()
  .catch((err) => {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Claude rejected the credentials. Set ANTHROPIC_API_KEY to a valid key.");
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => closeDb());
