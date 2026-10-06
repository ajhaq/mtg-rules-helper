import { readFileSync } from "node:fs";
import { getDb, withTransaction } from "../db/client.js";

// Matches "1. Game Concepts" — top-level chapter headers.
const CHAPTER_RE = /^([1-9])\.\s+(.+)$/;
// Matches "100. General" — section headers within a chapter.
const SECTION_RE = /^(\d{3})\.\s+(.+)$/;
// Matches "100.1. Some rule text" — a numbered rule with no subletter.
const RULE_RE = /^(\d{3}\.\d+)\.\s+(.+)$/;
// Matches "100.1a Some subrule text" — a lettered subrule.
const SUBRULE_RE = /^(\d{3}\.\d+[a-z])\s+(.+)$/;

interface ParsedRule {
  rule_number: string;
  chapter_title: string | null;
  section_number: string | null;
  section_title: string | null;
  text: string;
}

interface ParsedGlossaryEntry {
  term: string;
  definition: string;
}

export function loadRulesText(source: string): string {
  // `source` is a local file path to the Comprehensive Rules .txt file, as
  // published at magic.wizards.com/en/rules (download the plain-text version).
  return readFileSync(source, "utf-8");
}

export function parseComprehensiveRules(raw: string): {
  rules: ParsedRule[];
  glossary: ParsedGlossaryEntry[];
} {
  const lines = raw.split(/\r?\n/);

  // The published .txt starts with a table of contents that lists chapter and
  // section titles but no individual rule numbers. The first line matching a
  // real rule (e.g. "100.1.") marks where the actual rules text begins.
  const firstRuleIdx = lines.findIndex((l) => RULE_RE.test(l.trim()));
  if (firstRuleIdx === -1) {
    throw new Error("Could not find the start of rules content (no line matched a rule number)");
  }

  const glossaryIdx = lines.findIndex((l, i) => i > firstRuleIdx && l.trim() === "Glossary");
  const creditsIdx = lines.findIndex((l, i) => i > firstRuleIdx && l.trim() === "Credits");

  // Back up to the body's "1. Game Concepts" header so the first rules keep
  // their chapter/section context (the TOC copy of the header is earlier).
  let bodyStartIdx = firstRuleIdx;
  for (let i = firstRuleIdx - 1; i >= 0; i--) {
    if (CHAPTER_RE.test(lines[i].trim())) {
      bodyStartIdx = i;
      break;
    }
  }

  const rulesLines = lines.slice(bodyStartIdx, glossaryIdx === -1 ? lines.length : glossaryIdx);
  const glossaryLines =
    glossaryIdx === -1 ? [] : lines.slice(glossaryIdx + 1, creditsIdx === -1 ? lines.length : creditsIdx);

  return {
    rules: parseRuleLines(rulesLines),
    glossary: parseGlossaryLines(glossaryLines),
  };
}

function parseRuleLines(lines: string[]): ParsedRule[] {
  const rules: ParsedRule[] = [];

  let chapterTitle: string | null = null;
  let sectionNumber: string | null = null;
  let sectionTitle: string | null = null;
  let current: ParsedRule | null = null;

  const flush = () => {
    if (current) {
      current.text = current.text.trim();
      if (current.text) rules.push(current);
      current = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const chapterMatch = line.match(CHAPTER_RE);
    const sectionMatch = !chapterMatch ? line.match(SECTION_RE) : null;
    const ruleMatch = !sectionMatch ? line.match(RULE_RE) : null;
    const subruleMatch = !ruleMatch ? line.match(SUBRULE_RE) : null;

    if (chapterMatch) {
      flush();
      chapterTitle = chapterMatch[2];
      continue;
    }
    if (sectionMatch) {
      flush();
      sectionNumber = sectionMatch[1];
      sectionTitle = sectionMatch[2];
      continue;
    }
    if (ruleMatch) {
      flush();
      current = {
        rule_number: ruleMatch[1],
        chapter_title: chapterTitle,
        section_number: sectionNumber,
        section_title: sectionTitle,
        text: ruleMatch[2],
      };
      continue;
    }
    if (subruleMatch) {
      flush();
      current = {
        rule_number: subruleMatch[1],
        chapter_title: chapterTitle,
        section_number: sectionNumber,
        section_title: sectionTitle,
        text: subruleMatch[2],
      };
      continue;
    }

    // Continuation of the previous rule's wrapped text.
    if (current) {
      current.text += " " + line;
    }
  }
  flush();

  return rules;
}

function parseGlossaryLines(lines: string[]): ParsedGlossaryEntry[] {
  const entries: ParsedGlossaryEntry[] = [];
  let term: string | null = null;
  let definitionParts: string[] = [];

  const flush = () => {
    if (term && definitionParts.length) {
      entries.push({ term, definition: definitionParts.join(" ").trim() });
    }
    term = null;
    definitionParts = [];
  };

  const looksLikeTerm = (line: string) => line.length < 60 && !/[.:;]$/.test(line);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!term) {
      // First line of the glossary, or right after a flush: always a term.
      term = line;
      continue;
    }
    if (definitionParts.length === 0) {
      // The line immediately after a term is always its definition's start,
      // even if it happens to look term-shaped.
      definitionParts.push(line);
      continue;
    }
    if (looksLikeTerm(line)) {
      // A short, unpunctuated line after we already have some definition
      // text is almost certainly the next entry's term.
      flush();
      term = line;
    } else {
      definitionParts.push(line);
    }
  }
  flush();

  return entries;
}

export function ingestRules(sourcePath: string): { rules: number; glossary: number } {
  const db = getDb();
  const raw = loadRulesText(sourcePath);
  const { rules, glossary } = parseComprehensiveRules(raw);

  db.exec("DELETE FROM rules"); // full re-ingest each time; rule numbers get renumbered between releases
  db.exec("DELETE FROM glossary");

  const insertRule = db.prepare(
    `INSERT INTO rules (rule_number, chapter_title, section_number, section_title, text)
     VALUES (@rule_number, @chapter_title, @section_number, @section_title, @text)`
  );
  const insertGlossary = db.prepare(`INSERT OR REPLACE INTO glossary (term, definition) VALUES (@term, @definition)`);

  withTransaction(db, () => {
    for (const r of rules) insertRule.run(r as unknown as Record<string, string | null>);
    for (const g of glossary) insertGlossary.run(g as unknown as Record<string, string>);
  });

  console.log(`Ingested ${rules.length} rules and ${glossary.length} glossary terms.`);
  return { rules: rules.length, glossary: glossary.length };
}
