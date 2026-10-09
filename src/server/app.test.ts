import { describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "../synthesis/answer.js";
import { createApp } from "./app.js";
import { createRateLimiter } from "./rateLimit.js";
import Anthropic from "@anthropic-ai/sdk";

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

function post(app: ReturnType<typeof createApp>, body: string, headers: Record<string, string> = {}) {
    return app.request("/ask", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
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
        expect(fake).toHaveBeenCalledWith("Does Blood Artist trigger?", expect.any(AbortSignal));
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
});

describe("rate limiting", () => {

    const validBody = JSON.stringify({ question: "Does Blood Artist trigger?" });

    // Builds an app that allows 1 request per IP per minute.
    // The test controls the "IP" through the x-test-ip header, so no real socket is needed.
    function makeApp(fake = vi.fn(async () => fakeResult)) {
        const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
        const app = createApp(fake, {
            rateLimiter: limiter,
            getClientIp: (c) => c.req.header("x-test-ip") ?? "x",
        });
        return { app, fake };
    }

    it("returns 429 with a retry-after header on the second request from the same IP", async () => {
        const { app, fake } = makeApp();
        const headers = { "x-test-ip": "1.1.1.1" }

        const firstReq = await post(app, validBody, headers);
        expect(firstReq.status).toBe(200);

        const secondReq = await post(app, validBody, headers);
        expect(secondReq.status).toBe(429);

        const retryAfter = Number(secondReq.headers.get("retry-after"));
        expect(retryAfter).toBeGreaterThan(0);

        expect(fake).toHaveBeenCalledOnce();
    });

    it("does not limit a different IP", async () => {
        const { app, fake } = makeApp();
        const headers1 = { "x-test-ip": "1.1.1.1" }
        const headers2 = { "x-test-ip": "2.2.2.2" }

        const firstReq = await post(app, validBody, headers1);
        expect(firstReq.status).toBe(200);

        const secondReq = await post(app, validBody, headers2);
        expect(secondReq.status).toBe(200);
    });

    it("never limits /health", async () => {
        const { app, fake } = makeApp();

        const first = await app.request("/health");
        const second = await app.request("/health");
        const third = await app.request("/health");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(200);
    });

    it("counts requests that fail validation", async () => {
        const { app, fake } = makeApp();
        const headers = { "x-test-ip": "1.1.1.1" }

        const res = await post(app, JSON.stringify({ question: "" }), headers);
        expect(res.status).toBe(400);
        const res2 = await post(app, JSON.stringify({ question: "" }), headers);
        expect(res2.status).toBe(429);
    });

    it("uses the last x-forwarded-for entry when trustProxy is on", async () => {
        const fake = vi.fn(async () => fakeResult);
        const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
        const app = createApp(fake, { rateLimiter: limiter, trustProxy: true })
        const header = { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }

        const res = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }), header)
        expect(res.status).toBe(200);

        const header2 = { "x-forwarded-for": "9.9.9.9, 2.2.2.2" }
        const res2 = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }), header2)
        expect(res2.status).toBe(429);

        const header3 = { "x-forwarded-for": "9.9.9.9, 3.3.3.3" }
        const res3 = await post(app, JSON.stringify({ question: "Does Blood Artist trigger?" }), header3)
        expect(res3.status).toBe(200);
    });
});

describe("request timeout", () => {
    const validBody = JSON.stringify({ question: "Does Blood Artist trigger?" });
    it("doesnt finish until the signal fires", async () => {
        const fake = vi.fn(
            (_q: string, signal?: AbortSignal) =>
                new Promise<AnswerResult>((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()));
                })
        );
        const app = createApp(fake, { timeoutMs: 50 });
        const res = await post(app, validBody);
        expect(res.status).toBe(504);
    });
});