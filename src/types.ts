export interface CardRecord {
  oracle_id: string;
  name: string;
  normalized_name: string;
  mana_cost: string | null;
  type_line: string | null;
  oracle_text: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  colors: string | null;
  scryfall_uri: string | null;
}

export interface RulingRecord {
  id: number;
  oracle_id: string;
  published_at: string | null;
  comment: string;
}

export interface RuleRecord {
  id: number;
  rule_number: string;
  chapter_title: string | null;
  section_number: string | null;
  section_title: string | null;
  text: string;
}

export interface RuleSearchResult extends RuleRecord {
  score: number;
  matchType: "keyword" | "semantic" | "both";
}

export interface GlossaryRecord {
  term: string;
  definition: string;
}
