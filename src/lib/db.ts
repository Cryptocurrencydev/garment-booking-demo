import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __mfPool: Pool | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1|\/tmp|@\/|host=\//.test(url) || url.startsWith("postgres:///") || !url.includes(".");
  return new Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
}

export function pool() {
  globalThis.__mfPool ??= makePool();
  return globalThis.__mfPool;
}

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const r = await pool().query<T>(text, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const r = await one<{ value: T }>("select value from settings where key = $1", [key]);
  return r?.value ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await q(
    "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value)],
  );
}
