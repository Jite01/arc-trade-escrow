import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrations = ["001_trade_agreements.sql", "002_wallet_auth.sql", "003_commercial_corrections.sql", "004_resolution_policy.sql", "005_relayer_coordination.sql"];
try {
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(here, `../migrations/${migration}`), "utf8"));
    console.log(`Applied commercial registry migration: ${migration}`);
  }
} finally { await pool.end(); }
