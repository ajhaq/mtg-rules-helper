import { Hono } from 'hono';
import { bodyLimit } from "hono/body-limit";
import type { AnswerResult } from "../synthesis/answer.js";
import { z } from "zod";
import { HTTPException } from 'hono/http-exception';
import Anthropic from "@anthropic-ai/sdk";

export type AnswerFn = (question: string) => Promise<AnswerResult>;

const schema = z.object({ question: z.string().trim().min(1).max(1000) })

export function createApp(answer: AnswerFn) {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));

    app.use("/ask", bodyLimit({
        maxSize: 8 * 1024, //8 KB, requests shouldnt be any bigger than this 
        onError: (c) => c.json({ error: "Request too large."}, 413)
    }));

    app.post("/ask", async (c) => {
        let body: unknown;
        // 1. read and parse the JSON body (400 if it's invalid)
        try {
            body = await c.req.json();
        }
        catch {
            return c.json({ error: "Request body must be valid json" }, 400)
        }

        // 2. validate it with your zod schema (400 if it fails)
        const parsedQuestion = schema.safeParse(body);
        if (!parsedQuestion.success) {
            return c.json({ error: `Body must be {"question": "...."} with 1 to 1000 characters.` }, 400);
        }

        // 3. call answer(question)
        const result = await answer(parsedQuestion.data.question);
        // 4. return the trimmed-down result as JSON
        return c.json({
            answer: result.answer,
            citations: result.citations,
            rulings: result.rulings,
            warnings: result.warnings
        });
    });

    app.onError((error, c) => {
        if (error instanceof HTTPException) return error.getResponse();

        console.error("unhandled error:", error);
        //429 = too many requests/rate limited. 529 = overloaded. These are transient errors so we retry using "Retry-After" header
        if (error instanceof Anthropic.APIError && (error.status === 429 || error.status === 529)){
            c.header("Retry-After", "30");
            return c.json({ error: "The service is busy. Please try again shortly." }, 503);
        }
        return c.json({ error: "Something went wrong answering that question."}, 500);
    })
    return app;
}