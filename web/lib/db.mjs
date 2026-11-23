// One database for sign-in (Better Auth's tables) and Plainsight's own (maps, API tokens).
// DATABASE_URL=postgres://... in production; a local SQLite file otherwise.
import fs from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";

const g = globalThis.__plainsightDb || (globalThis.__plainsightDb = {});

export async function getDb() {
  if (g.db) return g;
  const url = process.env.DATABASE_URL || "";
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { default: pg } = await import("pg");
    g.db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 5 }) }) });
    g.type = "postgres";
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const { NodeSqliteDialect } = await import("@better-auth/kysely-adapter/node-sqlite-dialect");
    const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.replace(/^file:/, "") || ".data/plainsight.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    g.db = new Kysely({ dialect: new NodeSqliteDialect({ database }) });
    g.type = "sqlite";
  }
  return g;
}

// Plainsight's own tables. Sign-in tables are created by Better Auth's migrations (lib/auth.mjs).
export async function ensurePlainsightTables(db) {
  await db.schema.createTable("plainsight_map").ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("userId", "text", (c) => c.notNull())
    .addColumn("repo", "text", (c) => c.notNull())
    .addColumn("commitSha", "text")
    .addColumn("origin", "text", (c) => c.notNull()) // web | upload | api
    .addColumn("runUrl", "text")
    .addColumn("summary", "text", (c) => c.notNull())
    .addColumn("graph", "text", (c) => c.notNull())
    .addColumn("createdAt", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("plainsight_map_user").ifNotExists().on("plainsight_map").columns(["userId", "createdAt"]).execute();
  await db.schema.createTable("plainsight_token").ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("userId", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("hash", "text", (c) => c.notNull().unique())
    .addColumn("hint", "text", (c) => c.notNull())
    .addColumn("createdAt", "text", (c) => c.notNull())
    .addColumn("lastUsedAt", "text")
    .execute();
  await db.schema.createIndex("plainsight_token_user").ifNotExists().on("plainsight_token").column("userId").execute();
}

export { sql };
