import { migrate } from "./migrate.ts";
import { createDatabasePool } from "./subgraph.ts";

// Run once per release, before the subgraphs deploy (FR-SG-8). It prints only migration names.
const pool = createDatabasePool(process.env);
try {
  const applied = await migrate(pool);
  process.stdout.write(`${JSON.stringify({ applied })}\n`);
} finally {
  await pool.end();
}
