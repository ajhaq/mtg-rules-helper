import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { resolveCard } from "../retrieval/cardLookup.js";
import { getRulingsForOracleId } from "../retrieval/rulings.js";
import { getRuleWithSubrules, searchRules } from "../retrieval/rulesSearch.js";
import type { RuleRecord } from "../types.js";

export interface ToolContext {
  /** Every rule number shown to the model this run; used to verify citations afterwards. */
  retrievedRules: Set<string>;
}

export function createToolContext(): ToolContext {
  return { retrievedRules: new Set() };
}

function formatRules(ctx: ToolContext, rules: RuleRecord[]) {
  return rules.map((r) => {
    ctx.retrievedRules.add(r.rule_number);
    return { rule_number: r.rule_number, section: r.section_title, text: r.text };
  });
}

export function createTools(ctx: ToolContext) {
  const searchRulesTool = betaZodTool({
    name: "search_rules",
    description:
      "Search the Magic: The Gathering Comprehensive Rules. Returns the best-matching numbered rules. " +
      "Use rules vocabulary in the query (e.g. 'leaves-the-battlefield triggers look back in time'), not the user's phrasing. " +
      "Call several times with different angles when a question touches multiple systems.",
    inputSchema: z.object({
      query: z.string().describe("What to look for, in rules terminology"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 10)"),
    }),
    run: async ({ query, limit }) => {
      const results = await searchRules(query, { limit: limit ?? 10 });
      if (!results.length) return "No matching rules found.";
      return JSON.stringify(formatRules(ctx, results));
    },
  });

  const getRuleTool = betaZodTool({
    name: "get_rule",
    description:
      "Fetch an exact Comprehensive Rules entry by number, together with all of its lettered subrules " +
      "(e.g. '603.10' returns 603.10, 603.10a, 603.10b...). Use this to read rules that search results or other rules cross-reference.",
    inputSchema: z.object({
      rule_number: z.string().describe("e.g. '603.2', '704.5g', or '613.1a'"),
    }),
    run: async ({ rule_number }) => {
      const rules = getRuleWithSubrules(rule_number.trim().replace(/\.$/, ""));
      if (!rules.length) {
        return `No rule numbered "${rule_number}". Use search_rules to find the right rule number.`;
      }
      return JSON.stringify(formatRules(ctx, rules));
    },
  });

  const lookupCardTool = betaZodTool({
    name: "lookup_card",
    description:
      "Look up a Magic card's current Oracle text, type line, printed power/toughness (or loyalty/defense) and official rulings by name. " +
      "Always use this for every card the question mentions: never rely on memory for card text, which gets errata'd.",
    inputSchema: z.object({
      name: z.string().describe("Card name; small typos are tolerated"),
    }),
    run: async ({ name }) => {
      const card = resolveCard(name);
      if (!card) return `No card found matching "${name}".`;
      return JSON.stringify({
        name: card.name,
        mana_cost: card.mana_cost,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        ...(card.power !== null && { power: card.power }),
        ...(card.toughness !== null && { toughness: card.toughness }),
        ...(card.loyalty !== null && { loyalty: card.loyalty }),
        ...(card.defense !== null && { defense: card.defense }),
        rulings: getRulingsForOracleId(card.oracle_id).map((r) => ({
          published_at: r.published_at,
          comment: r.comment,
        })),
      });
    },
  });

  return [searchRulesTool, getRuleTool, lookupCardTool];
}
