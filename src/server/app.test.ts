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

        const res = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }));

        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.answer.short_answer).toBe("Yes.");
        expect(json).toHaveProperty("citations");
        expect(json).toHaveProperty("rulings");
        expect(json).toHaveProperty("warnings");
        expect(json).not.toHaveProperty("usage");
        expect(json).not.toHaveProperty("toolCalls");
    });

    it("passes the trimmed question to the answer function", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        await post(app, JSON.stringify({ question: "     Does Blood Artist trigger?     " }));

        expect(fake).toHaveBeenCalledOnce();
        expect(fake).toHaveBeenCalledWith("Does Blood Artist trigger?");
    });

    it("returns 400 on malformed JSON", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        const res = await post(app, "{not json");

        expect(res.status).toBe(400);
        expect(fake).not.toHaveBeenCalled();
    });

    it("returns 400 on empty question", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        const res = await post(app, JSON.stringify({ question: "   " }));

        expect(res.status).toBe(400);
        expect(fake).not.toHaveBeenCalled();
    });

    it("returns 400 on a question longer than 1000 characters", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        const res = await post(app, JSON.stringify({ question: "x".repeat(1001) }));

        expect(res.status).toBe(400);
        expect(fake).not.toHaveBeenCalled();
    });

    it("returns 400 when no request body is passed", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        const res = await post(app, "");

        expect(res.status).toBe(400);
        expect(fake).not.toHaveBeenCalled();
    });

    it("returns a generic 500 and hides error details when answering fails", async () => {
        const logSpy = vi.spyOn(console, "error").mockImplementation(() => { });
        const app = createApp(async () => {
            throw new Error("secret detail");
        });

        const res = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }));

        expect(res.status).toBe(500);
        expect(await res.text()).not.toContain("secret detail");
        expect(logSpy).toHaveBeenCalled();

        logSpy.mockRestore();
    });

    it("returns a 413 when request body is too large", async () => {
        const fake = vi.fn(async () => fakeResult);
        const app = createApp(fake);

        const res = await post(app, JSON.stringify({ question: "x".repeat(10 * 1024) }));

        expect(res.status).toBe(413);
        expect(fake).not.toHaveBeenCalled();
    });

    it("returns 503 when too many requests are in flight", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const fake = vi.fn(async () => {
            await gate;
            return fakeResult;
        });
        const app = createApp(fake, { maxConcurrent: 1 });

        const first = post(app, JSON.stringify({ question: "first" })); 
        await vi.waitFor(() => expect(fake).toHaveBeenCalledTimes(1));

        const second = await post(app, JSON.stringify({ question: "second" }));
        expect(second.status).toBe(503);
        expect(second.headers.get("retry-after")).toBe("10");

        release();
        expect((await first).status).toBe(200);
    });

    it("failed request releases its slot", async () => {
        const fake = vi.fn().mockRejectedValueOnce(new Error("error")).mockResolvedValue(fakeResult)
        const app = createApp(fake, { maxConcurrent: 1 });

        const res = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }));    
        const res2 = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }));

        expect(res.status).toBe(500);
        expect(res2.status).toBe(200);
    })
})