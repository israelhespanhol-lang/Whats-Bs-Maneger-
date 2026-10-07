import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPool } from "./db.js";

const migrationsDir = fileURLToPath(
  new URL("../../../database/migrations/", import.meta.url)
);

const pool = getPool();

await pool.query(`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const appliedResult = await pool.query("select name from schema_migrations");
const applied = new Set(appliedResult.rows.map((row) => row.name));

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip ${file}`);
    continue;
  }

  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into schema_migrations (name) values ($1)",
      [file]
    );
    await client.query("commit");
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
