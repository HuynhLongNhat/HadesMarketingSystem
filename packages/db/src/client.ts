import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required to initialize @workspace/db."
  );
}

export const pool = new Pool({
  connectionString,
});

// node-postgres emits errors on the Pool when an idle client loses its
// connection (e.g. a Neon pooler/network reset). Without a listener Node.js
// treats the event as unhandled and terminates the process.
// pg-pool removes the failed idle client; future queries acquire another.
pool.on("error", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[database] PostgreSQL idle connection error:", message);
});

export const db = drizzle(pool, {
  schema,
});