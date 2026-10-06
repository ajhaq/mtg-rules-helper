import { gunzipSync } from "node:zlib";
import { getDb, withTransaction } from "../db/client.js";

const BULK_DATA_INDEX = "https://api.scryfall.com/bulk-data";
const USER_AGENT = "mtg-rules-helper/0.1 (+https://github.com/)";

interface ScryfallBulkEntry {
  type: string;
  jsonl_download_uri: string;
  name: string;
}

interface ScryfallCardFace {
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}

type StatKey = "power" | "toughness" | "loyalty" | "defense";

interface ScryfallCard {
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  scryfall_uri?: string;
  card_faces?: ScryfallCardFace[];
  layout?: string;
}

interface ScryfallRuling {
  oracle_id: string;
  published_at: string;
  comment: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchJsonlGz<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

async function getBulkDownloadUri(type: string): Promise<string> {
  const index = await fetchJson<{ data: ScryfallBulkEntry[] }>(BULK_DATA_INDEX);
  const entry = index.data.find((e) => e.type === type);
  if (!entry?.jsonl_download_uri) throw new Error(`No JSONL bulk data entry found for type "${type}"`);
  return entry.jsonl_download_uri;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function resolveOracleText(card: ScryfallCard): string | null {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces?.length) {
    const texts = card.card_faces.map((f) => f.oracle_text ?? "").filter(Boolean);
    if (texts.length) return texts.join("\n//\n");
  }
  return null;
}

/** Printed power/toughness/loyalty/defense; multi-faced cards get one value per face joined with " // ". Kept as text because values can be "*" or "1+*". */
function resolveStat(card: ScryfallCard, key: StatKey): string | null {
  if (card[key] !== undefined) return card[key];
  const faceValues = (card.card_faces ?? []).map((f) => f[key]).filter((v): v is string => v !== undefined);
  return faceValues.length ? faceValues.join(" // ") : null;
}

export async function ingestCards(): Promise<{ cards: number }> {
  const db = getDb();
  const uri = await getBulkDownloadUri("oracle_cards");
  console.log(`Downloading Scryfall oracle_cards from ${uri} ...`);
  const cards = await fetchJsonlGz<ScryfallCard>(uri);

  const insert = db.prepare(
    `INSERT INTO cards (oracle_id, name, normalized_name, mana_cost, type_line, oracle_text, power, toughness, loyalty, defense, colors, scryfall_uri)
     VALUES (@oracle_id, @name, @normalized_name, @mana_cost, @type_line, @oracle_text, @power, @toughness, @loyalty, @defense, @colors, @scryfall_uri)
     ON CONFLICT(oracle_id) DO UPDATE SET
       name=excluded.name, normalized_name=excluded.normalized_name, mana_cost=excluded.mana_cost,
       type_line=excluded.type_line, oracle_text=excluded.oracle_text, power=excluded.power,
       toughness=excluded.toughness, loyalty=excluded.loyalty, defense=excluded.defense,
       colors=excluded.colors, scryfall_uri=excluded.scryfall_uri`
  );

  let count = 0;
  withTransaction(db, () => {
    for (const card of cards) {
      if (!card.oracle_id) continue; // skip layouts without a stable oracle id (e.g. some art series)
      insert.run({
        oracle_id: card.oracle_id,
        name: card.name,
        normalized_name: normalizeName(card.name),
        mana_cost: card.mana_cost ?? null,
        type_line: card.type_line ?? null,
        oracle_text: resolveOracleText(card),
        power: resolveStat(card, "power"),
        toughness: resolveStat(card, "toughness"),
        loyalty: resolveStat(card, "loyalty"),
        defense: resolveStat(card, "defense"),
        colors: card.colors ? JSON.stringify(card.colors) : null,
        scryfall_uri: card.scryfall_uri ?? null,
      });
      count++;
    }
  });

  console.log(`Ingested ${count} cards.`);
  return { cards: count };
}

export async function ingestRulings(): Promise<{ rulings: number }> {
  const db = getDb();
  const uri = await getBulkDownloadUri("rulings");
  console.log(`Downloading Scryfall rulings from ${uri} ...`);
  const rulings = await fetchJsonlGz<ScryfallRuling>(uri);

  db.exec("DELETE FROM rulings"); // rulings bulk data is a full snapshot each time
  const insert = db.prepare(
    `INSERT INTO rulings (oracle_id, published_at, comment) VALUES (@oracle_id, @published_at, @comment)`
  );

  let count = 0;
  withTransaction(db, () => {
    for (const r of rulings) {
      insert.run({ oracle_id: r.oracle_id, published_at: r.published_at ?? null, comment: r.comment });
      count++;
    }
  });

  console.log(`Ingested ${count} rulings.`);
  return { rulings: count };
}
