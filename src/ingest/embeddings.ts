import { getDb, withTransaction } from "../db/client.js";
import { floatsToBuffer } from "../embeddings/provider.js";
import { localEmbeddingProvider } from "../embeddings/localProvider.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { RuleRecord } from "../types.js";

const BATCH_SIZE = 32;

export async function ingestRuleEmbeddings(
  provider: EmbeddingProvider = localEmbeddingProvider
): Promise<{ embedded: number }> {
  const db = getDb();
  const rules = db.prepare(`SELECT * FROM rules`).all() as unknown as RuleRecord[];

  const insert = db.prepare(
    `INSERT INTO rule_embeddings (rule_id, dims, embedding) VALUES (@rule_id, @dims, @embedding)
     ON CONFLICT(rule_id) DO UPDATE SET dims=excluded.dims, embedding=excluded.embedding`
  );

  let embedded = 0;
  for (let i = 0; i < rules.length; i += BATCH_SIZE) {
    const batch = rules.slice(i, i + BATCH_SIZE);
    // Prefix with the section title so short subrules ("Regenerate a
    // permanent.") still carry enough context to embed meaningfully.
    const inputs = batch.map((r) => `${r.section_title ?? ""} (${r.rule_number}): ${r.text}`);
    const vectors = await provider.embed(inputs);

    withTransaction(db, () => {
      batch.forEach((rule, idx) => {
        insert.run({
          rule_id: rule.id,
          dims: provider.dims,
          embedding: floatsToBuffer(vectors[idx]),
        });
      });
    });

    embedded += batch.length;
    console.log(`Embedded ${embedded}/${rules.length} rules...`);
  }

  return { embedded };
}
