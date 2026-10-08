import { describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "../synthesis/answer.js";
import { createApp } from "./app.js";

const fakeResult: AnswerResult = {
  answer: { status: "answered", short_answer: "Yes.", steps: [], card_rulings_used: [], caveats: [] },
  citations: [],
  rulings: [],
  warnings: [],
  model: "test-model",
  iterations: 1,
  toolCalls: [],
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
};

function post(app: ReturnType<typeof createApp>, body: string) {
  return app.request("/ask", { method: "POST", headers: { "content-type": "application/json" }, body });
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await createApp(async () => fakeResult).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /ask", () => {
    it("returns 200 with the trimmed-down answer for a valid question", async () => {
        const app = createApp(async () => fakeResult);

        const res = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?"}));

        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.answer.short_answer).toBe("Yes.");
        expect(json).toHaveProperty("citations");
        expect(json).toHaveProperty("rulings");
        expect(json).toHaveProperty("warnings");
        expect(json).not.toHaveProperty("usage");
        expect(json).not.toHaveProperty("toolCalls");
    })
})