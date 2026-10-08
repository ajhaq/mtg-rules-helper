import { Hono } from 'hono';
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AnswerResult } from "../synthesis/answer.js";
import { z } from "zod";
import { HTTPException } from 'hono/http-exception';
import Anthropic from "@anthropic-ai/sdk";
import type { RateLimiter } from "./rateLimit.js";

export interface AppOptions {
  maxConcurrent?: number;
  rateLimiter?: RateLimiter;
  getClientIp?: (c: Context) => string;
  trustProxy?: boolean;
}

export type AnswerFn = (question: string) => Promise<AnswerResult>;

const schema = z.object({ question: z.string().trim().min(1).max(1000) })

function defaultGetClientIp(trustProxy: boolean) {
  return (c: Context): string => {
    if (trustProxy) {
      const forwarded = c.req.header("x-forwarded-for");
      if (forwarded) return forwarded.split(",").at(-1)!.trim();
    }
    return getConnInfo(c).remote.address ?? "unknown";
  };
}

export function createApp(answer: AnswerFn, options: AppOptions = {}) {
    const app = new Hono();
    const maxConcurrent = options.maxConcurrent ?? 5;
    let inFlight = 0;

    app.get("/health", (c) => c.json({ status: "ok" }));

    if(options.rateLimiter){
        const limiter = options.rateLimiter;
        const getIp = options.getClientIp ?? defaultGetClientIp(options.trustProxy ?? false);

        app.use("/ask", async (c, next) => {
            //check the request and let us know if its allowed
            const result = limiter.check(getIp(c));
            //if its not allowed, return rate limited :)
            if(!result.allowed){
                c.header("Retry-After", String(result.retryAfterSeconds));
                return c.json({ error: "Too many requests. Please try again later."}, 429)
            }
            await next();
        });
    }

    app.use("/ask", bodyLimit({
        maxSize: 8 * 1024, //8 KB, requests shouldnt be any bigger than this 
        onError: (c) => c.json({ error: "Request too large."}, 413)
    }));

    app.post("/ask", async (c) => {
        let body: unknown;
        //read and parse the JSON body (400 if it's invalid)
        try {
            body = await c.req.json();
        }
        catch {
            return c.json({ error: "Request body must be valid json" }, 400)
        }

        //validate it with your zod schema (400 if it fails)
        const parsedQuestion = schema.safeParse(body);
        if (!parsedQuestion.success) {
            return c.json({ error: `Body must be {"question": "...."} with 1 to 1000 characters.` }, 400);
        }

        //dont do anything if there are more requests than the max concurrent allowed
        if(inFlight >= maxConcurrent){
            c.header("Retry-After", "10");
            return c.json({error: "The server is busy. Please try again shortly."}, 503);
        }

        //call answer(question)
        inFlight++
        try{
            const result = await answer(parsedQuestion.data.question);
            //return the trimmed-down result as JSON
            return c.json({
                answer: result.answer,
                citations: result.citations,
                rulings: result.rulings,
                warnings: result.warnings
        });
        }
        finally{
            inFlight--;
        }  
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