import { serve } from "@hono/node-server";
import { closeDb } from "../db/client.js";
import { createApp } from "./app.js";
import { answerQuestion } from "../synthesis/answer.js";
import { createRateLimiter } from "./rateLimit.js";

const port = Number(process.env.PORT) || 3000;

const limiter = createRateLimiter({
  max: Number(process.env.RATE_LIMIT_MAX) || 10,
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
});
setInterval(() => limiter.sweep(), 60_000).unref();

const app = createApp((q) => answerQuestion(q), {
    maxConcurrent: Number(process.env.MAX_CONCURRENT) || 5,
    rateLimiter: limiter,
    trustProxy: process.env.TRUST_PROXY === "1"
});

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`Listening on port ${port}`);
});

function shutdown() {
    server.close(() => {
        closeDb();
        process.exit(0)
    })
}

process.on("SIGTERM", shutdown); //what azure sends when it stops or replaces a container
process.on("SIGINT", shutdown); //same thing as CTRL+C locally