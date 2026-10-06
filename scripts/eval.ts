// Run the eval set end to end: answer each question, then score it.
// Usage: npm run eval                       (all reviewed questions)
//        npm run eval -- --id obeka-stack-and-response,crag-puca-reckless-charge-switch
//        npm run eval -- --all              (include unreviewed questions)
//        npm run eval -- --concurrency 1
// Needs Claude credentials: set ANTHROPIC_API_KEY. Each question costs one tool-loop answer plus one grading call.
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb } from "../src/db/client.js";
import { gradeAnswer, type Grade } from "../src/evals/grader.js";
import { loadQuestions, type EvalQuestion } from "../src/evals/questions.js";
import { citationCoverage, unlistedCitations } from "../src/evals/score.js";
import { getRuleByNumber } from "../src/retrieval/rulesSearch.js";
import { answerQuestion, type AnswerResult } from "../src/synthesis/answer.js";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "evals", "results");

interface QuestionResult {
  id: string;
  pass: boolean;
  error?: string;
  expected_status: string;
  actual_status?: string;
  status_ok?: boolean;
  must_cite_hit?: string[];
  must_cite_missed?: string[];
  unlisted_citations?: string[];
  citation_warnings?: string[];
  grade?: Grade;
  answer?: AnswerResult["answer"];
  usage?: AnswerResult["usage"];
  grader_usage?: { input_tokens: number; output_tokens: number };
  iterations?: number;
  model?: string;
}

interface Options {
  ids: string[] | null;
  includeUnreviewed: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { ids: null, includeUnreviewed: false, concurrency: 3 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") opts.includeUnreviewed = true;
    else if (arg === "--id") opts.ids = [...(opts.ids ?? []), ...(argv[++i] ?? "").split(",").filter(Boolean)];
    else if (arg === "--concurrency") opts.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function runQuestion(q: EvalQuestion, client: Anthropic): Promise<QuestionResult> {
  const base = { id: q.id, expected_status: q.expected_status };
  try {
    const result = await answerQuestion(q.question, client);
    const cited = result.citations.filter((c) => c.exists).map((c) => c.rule_number);
    const coverage = citationCoverage(q.must_cite, cited);
    const { grade, usage: graderUsage } = await gradeAnswer(q, result.answer, client);
    const statusOk = result.answer.status === q.expected_status;

    return {
      ...base,
      pass: statusOk && coverage.missed.length === 0 && grade.verdict === "correct",
      actual_status: result.answer.status,
      status_ok: statusOk,
      must_cite_hit: coverage.hit,
      must_cite_missed: coverage.missed,
      unlisted_citations: unlistedCitations(q.must_cite, q.may_cite, cited),
      citation_warnings: result.warnings,
      grade,
      answer: result.answer,
      usage: result.usage,
      grader_usage: graderUsage,
      iterations: result.iterations,
      model: result.model,
    };
  } catch (err) {
    return { ...base, pass: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runAll(questions: EvalQuestion[], concurrency: number, client: Anthropic): Promise<QuestionResult[]> {
  const results: QuestionResult[] = new Array(questions.length);
  let next = 0;
  async function worker() {
    while (next < questions.length) {
      const index = next++;
      const result = await runQuestion(questions[index], client);
      results[index] = result;
      console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.id}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, questions.length) }, worker));
  return results;
}

function printFailure(r: QuestionResult) {
  console.log(`\n${r.id}`);
  if (r.error) {
    console.log(`  error: ${r.error}`);
    return;
  }
  if (!r.status_ok) console.log(`  status: expected ${r.expected_status}, got ${r.actual_status}`);
  if (r.must_cite_missed?.length) console.log(`  did not cite: ${r.must_cite_missed.join(", ")}`);
  if (r.grade && r.grade.verdict !== "correct") {
    console.log(`  grade: ${r.grade.verdict} - ${r.grade.reasoning}`);
    for (const m of r.grade.missed_points) console.log(`    missed: ${m}`);
    for (const c of r.grade.contradictions) console.log(`    contradicts: ${c}`);
  }
  if (r.answer) console.log(`  answer: ${r.answer.short_answer}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = loadQuestions();

  if (opts.ids) {
    const unknown = opts.ids.filter((id) => !all.some((q) => q.id === id));
    if (unknown.length) throw new Error(`Unknown question id(s): ${unknown.join(", ")}`);
  }
  let questions = opts.ids ? all.filter((q) => opts.ids!.includes(q.id)) : all;
  const skipped = opts.includeUnreviewed || opts.ids ? [] : questions.filter((q) => !q.reviewed);
  if (!opts.includeUnreviewed && !opts.ids) questions = questions.filter((q) => q.reviewed);

  if (skipped.length) console.log(`Skipping ${skipped.length} unreviewed question(s). Use --all to include them.`);
  if (!questions.length) {
    console.log("No questions to run.");
    return;
  }

  // A must_cite rule that isn't in the database can never be satisfied, so say so before spending money.
  for (const q of questions) {
    for (const rule of q.must_cite) {
      if (!getRuleByNumber(rule)) console.warn(`Warning: ${q.id} requires rule ${rule}, which is not in the database.`);
    }
  }

  console.log(`Running ${questions.length} question(s), concurrency ${opts.concurrency}...\n`);
  const client = new Anthropic();
  const results = await runAll(questions, opts.concurrency, client);

  const failures = results.filter((r) => !r.pass);
  for (const r of failures) printFailure(r);

  const sum = (pick: (r: QuestionResult) => number) => results.reduce((n, r) => n + pick(r), 0);
  const answerUsage = {
    uncached: sum((r) => r.usage?.input_tokens ?? 0),
    cacheWrite: sum((r) => r.usage?.cache_creation_input_tokens ?? 0),
    cacheRead: sum((r) => r.usage?.cache_read_input_tokens ?? 0),
    output: sum((r) => r.usage?.output_tokens ?? 0),
  };
  const graderIn = sum((r) => r.grader_usage?.input_tokens ?? 0);
  const graderOut = sum((r) => r.grader_usage?.output_tokens ?? 0);

  console.log(`\n${results.length - failures.length}/${results.length} passed`);
  const warned = results.filter((r) => r.citation_warnings?.length).length;
  if (warned) console.log(`${warned} answer(s) had citation warnings (see the results file).`);
  console.log(
    `answers: ${answerUsage.uncached} uncached + ${answerUsage.cacheWrite} cache-write + ${answerUsage.cacheRead} cache-read input, ${answerUsage.output} output tokens`
  );
  console.log(`grading: ${graderIn} input, ${graderOut} output tokens`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`Full results: ${file}`);

  if (failures.length) process.exitCode = 1;
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
