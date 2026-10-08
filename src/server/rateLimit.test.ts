import { describe, expect, it, beforeEach } from "vitest";
import { createRateLimiter, type RateLimiter } from "./rateLimit.js";

describe("createRateLimiter", () => {
    let time: number;
    let limiter: RateLimiter;

    beforeEach(() => {
        time = 0;
        limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => time });
    });

    it("allows requests up to the max, then denies", () => {
        expect(limiter.check("a").allowed).toBe(true);
        expect(limiter.check("a").allowed).toBe(true);
        expect(limiter.check("a").allowed).toBe(false);
    });

    it("tracks each key separately", () => {
        limiter.check("a");
        limiter.check("a");
        expect(limiter.check("a").allowed).toBe(false);
        expect(limiter.check("b").allowed).toBe(true);
    });

    it("allows the key again once the window has passed", () => {
        limiter.check("a");
        limiter.check("a");
        expect(limiter.check("a").allowed).toBe(false);
        time = 1001;
        expect(limiter.check("a").allowed).toBe(true);
    });

    it("reports how long to wait when denied", () => {
        expect(limiter.check("a").allowed).toBe(true);
        time = 400;
        expect(limiter.check("a").allowed).toBe(true);
        time = 500
        expect(limiter.check("a").allowed).toBe(false);
        const denied = limiter.check("a");
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterSeconds).toBe(1);
    });

    it("sweep removes keys whose requests are all outside the window", () => {
        limiter.check("a");
        limiter.sweep();
        expect(limiter.size()).toBe(1);   // still inside the window, kept
        time = 1001;
        limiter.sweep();
        expect(limiter.size()).toBe(0);   // outside the window, removed
    });

    it("refuses a max below 1", () => {
        expect(() => createRateLimiter({ max: 0, windowMs: 1000 })).toThrow();
    });
});