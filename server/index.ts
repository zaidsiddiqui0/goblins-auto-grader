import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./routes";
import { Worker } from "./worker";

const worker = new Worker();
const app = createApp(worker);

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  const fallback = serveStatic({ path: "./dist/index.html" });
  app.get("*", (c, next) => c.req.path.startsWith("/api/") ? next() : fallback(c, next));
}

worker.start();
const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ event: "server_started", port: info.port, mode: process.env.LLM_MODE === "real" ? "real" : "mock" }));
});

async function shutdown(): Promise<void> {
  await worker.stop();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
