import { serve } from "@hono/node-server";
import { closeDb } from "../db/client.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 3000;
const app = createApp();

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