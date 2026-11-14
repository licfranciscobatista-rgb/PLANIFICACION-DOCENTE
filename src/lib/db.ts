import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface QueryResult<R> { rows: R[]; rowCount: number }
export interface DBAdapter {
 query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
 exec(sql: string): Promise<void>;
 transaction<T>(work: (tx: DBAdapter) => Promise<T>): Promise<T>;
 close(): Promise<void>;
}
export async function initializeDatabase(db: DBAdapter) {
 const sql = await readFile(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
 await db.transaction(tx => tx.exec(sql));
}
export function createPostgresDatabase(connectionString: string): DBAdapter {
 const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
 const wrap = (client: Pick<Pool, "query">, transactional = false): DBAdapter => ({
  async query<R>(sql: string, params: unknown[] = []) { const r = await client.query(sql, params); return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 }; },
  async exec(sql) { await client.query(sql); },
  async transaction<T>(work: (tx: DBAdapter) => Promise<T>) { if (transactional) return work(wrap(client, true)); const c = await pool.connect(); try { await c.query("BEGIN"); const result = await work(wrap(c as unknown as Pick<Pool, "query">, true)); await c.query("COMMIT"); return result; } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); } },
  async close() { if (!transactional) await pool.end(); },
 });
 return wrap(pool);
}
export async function createTestDatabase(dataPath?: string): Promise<DBAdapter> {
 if (dataPath) await mkdir(path.dirname(dataPath), { recursive: true });
 const pglite = new PGlite(dataPath);
 await pglite.waitReady;
 function wrap(client: Pick<PGlite, "query" | "exec">, transactional = false): DBAdapter { return {
  async query<R>(sql: string, params: unknown[] = []) { const r = await client.query<R>(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
  async exec(sql) { await client.exec(sql); },
  async transaction<T>(work: (tx: DBAdapter) => Promise<T>) { if (transactional) return work(wrap(client, true)); return pglite.transaction(tx => work(wrap(tx as unknown as Pick<PGlite, "query" | "exec">, true))); },
  async close() { if (!transactional) await pglite.close(); },
 }; }
 const db = wrap(pglite);
 await initializeDatabase(db);
 return db;
}
let database: Promise<DBAdapter> | undefined;
export function getDatabase(): Promise<DBAdapter> {
 if (!database) database = (async () => {
  if (process.env.DATABASE_URL) return createPostgresDatabase(process.env.DATABASE_URL);
  if (process.env.DEMO_MODE === "true" && !process.env.RENDER && !process.env.RENDER_SERVICE_ID) {
   const demoPath = process.env.DEMO_DATABASE_PATH === "preview" ? path.join(process.cwd(), ".local", "preview-clean") : path.join(process.cwd(), ".local", "demo-postgres");
   return createTestDatabase(demoPath);
  }
  throw new Error("Falta DATABASE_URL. La base local solo se permite con DEMO_MODE=true fuera de Render.");
 })();
 return database;
}
