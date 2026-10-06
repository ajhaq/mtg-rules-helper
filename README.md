# mtg-rules-helper

Ingestion, retrieval and Claude synthesis for an MTG rules-question tool. Scope is
deliberately narrow: **resolve "does this trigger / what happens" rules
questions using citations from the Comprehensive Rules and official card
rulings.** No tournament policy (MTR/IPG), no procedural questions.

There is no chat UI yet — see "Next steps" below.

Requires **Node 22.5+** (uses the built-in `node:sqlite` module — no native
compiler toolchain needed, unlike `better-sqlite3`).

## What's here

- `src/db` — SQLite schema (Node's built-in `node:sqlite`) with an FTS5 table
  for keyword search over rule text.
- `src/ingest` — pulls card Oracle text + rulings from Scryfall's bulk data
  API, and parses the Comprehensive Rules `.txt` into one row per numbered
  (sub)rule (e.g. `509.1a`), plus a best-effort glossary parse.
- `src/embeddings` — pluggable embedding provider. Ships with a local
  provider (`@xenova/transformers`, all-MiniLM-L6-v2) so retrieval works
  fully offline with no API key.
- `src/retrieval` — card name resolution (exact → substring → fuzzy
  Levenshtein), rulings lookup, and hybrid rules search (BM25 keyword +
  embedding cosine similarity, merged and re-ranked), plus exact rule lookup
  with subrules.
- `src/synthesis` — the Claude layer: a tool-calling loop (`search_rules`,
  `get_rule`, `lookup_card`) that returns a structured answer, then verifies
  every cited rule against the database.

## Setup

```bash
npm install
```

### 1. Ingest card data (from Scryfall, automatic)

```bash
npm run ingest:cards
```

Downloads Scryfall's `oracle_cards` and `rulings` bulk data files and loads
them into `data/rules.sqlite`. No API key needed; be considerate of
Scryfall's servers (bulk data is meant to be downloaded infrequently, not
polled).

### 2. Ingest the Comprehensive Rules (manual download required)

The official rules text is republished every set release at a URL that
changes each time, so it isn't hardcoded here. Get the current `.txt` from
**magic.wizards.com/en/rules** ("Comprehensive Rules" download), then:

```bash
npm run ingest:rules -- /path/to/MagicCompRules.txt
```

### 3. Generate embeddings for semantic search

```bash
npm run ingest:embeddings
```

Downloads a small (~90MB) local embedding model on first run and caches it.

### Try it

```bash
npm run query -- "does regeneration stop a creature from being sacrificed"
npm run query -- --card "Fog Bank"
```

### Ask a question (needs Claude credentials)

```bash
export ANTHROPIC_API_KEY=...
npm run ask -- "If Blood Artist dies at the same time as another creature, does it trigger for that creature?"
```

Claude looks up the cards, searches and reads the relevant rules, and returns
a short answer, step-by-step resolution and citations. Rule text shown under
"Rules cited" comes from the database, not from the model, and any cited rule
that doesn't exist (or that no tool actually showed the model) is listed under
`CITATION WARNINGS`. The last line reports requests and tokens used so you can
see what each question costs.

Defaults to `claude-sonnet-5-5`; set `MTG_RULES_MODEL` to try another model.
The request opts into server-side refusal fallbacks (`fallbacks: "default"`).

### Unit tests

```bash
npm test
```

Covers citation verification (no database or API needed).

### Eval set (needs Claude credentials)

```bash
npm run eval                                   # every reviewed question in evals/questions.json
npm run eval -- --id obeka-stack-and-response  # one or more ids, comma separated
npm run eval -- --all                          # include unreviewed questions
npm run eval -- --concurrency 1                # default is 3
```

Each question is answered by the full pipeline, then scored four ways. A
question passes only if all four hold:

1. The answer's `status` matches `expected_status`.
2. Every `must_cite` rule was cited (a lettered subrule counts for its parent,
   so citing `118.9a` satisfies `118.9`).
3. Every cited rule number exists in the Comprehensive Rules. (Citing a real
   rule the model never retrieved is only a warning, not a failure.)
4. A second Claude call grades the answer against `expected_answer` as
   `correct`, `partially_correct` or `incorrect`; only `correct` passes. The
   grader sees the question, the reference answer and the app's answer, not
   `must_cite` or `notes`. It uses `MTG_RULES_GRADER_MODEL`, falling back to
   `MTG_RULES_MODEL`.

Results (answers, grades, citation warnings, token usage) are written to
`evals/results/` (gitignored). The command exits non-zero if any question
fails. Entries with `"reviewed": false` are skipped unless you pass `--all`.

### Smoke test (no network dependency on Scryfall or a real CR download)

```bash
npm run smoke-test
```

Uses fixture data (`data/fixtures/comp-rules-fixture.txt`, a synthetic
stand-in for the real rules text) to validate the parser and both search
paths end to end. Still downloads the local embedding model on first run.

## Design notes

- **Hybrid search matters.** Keyword/BM25 catches exact terminology
  ("regenerate", "state-based"); embeddings catch paraphrased questions. Both
  are merged and re-ranked rather than picking one.
- **Full re-ingest, not incremental.** Rule numbers get reshuffled between CR
  releases and the rulings bulk file is a full snapshot each time, so both
  ingestion paths clear and reload their tables rather than diffing.
- **The glossary parser is a heuristic** (short unpunctuated line = term,
  everything after = definition) and hasn't been validated against the full
  real CR file — sanity-check the `glossary` table after a real ingest.
- **No tournament policy data at all**, by design — see the scope note above.

## Next steps (not in this repo yet)

- A check that cited rules actually support the step they're attached to (the
  citation verifier only checks that the rule exists and was retrieved).
- A minimal chat UI.
