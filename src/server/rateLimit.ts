export interface RateLimiterOptions {
    max: number;
    windowMs: number;
    now?: () => number;
}

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

export interface RateLimiter {
    check(key: string): RateLimitResult;
    sweep(): void;
    size(): number;
}

export function createRateLimiter({ max, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
    if (max < 1) throw new Error("max must be at least 1");

    const hits = new Map<string, number[]>();

    return {
        check(key) {
            const tNow = now();
            //get the amount of recent attempts within the window
            const recent = (hits.get(key) ?? []).filter((timeStamp) => timeStamp > tNow - windowMs);
            //if the attempts are more than the max, deny and compute how long they have to wait
            if (recent.length >= max) {
                hits.set(key, recent);
                return { allowed: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - tNow) / 1000) }
            }
            //otherwise record the attempt and allow it
            recent.push(tNow);
            hits.set(key, recent);
            return {allowed: true, retryAfterSeconds: 0};
        },

        //delete any key whos timestamp is outside of the window
        sweep() {
            const cutoff = now() - windowMs;
            for (const [key, timeStamps] of hits) {
                if (timeStamps.length === 0 || timeStamps[timeStamps.length - 1] <= cutoff) {
                    hits.delete(key);
                }
            }
        },
        size(){
            return hits.size;
        }
    };
}