import { createPostgresDatabase, initializeDatabase } from "../src/lib/db";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Configura MIGRATION_DATABASE_URL con la conexión directa de Neon.");
if (new URL(url).hostname.includes("-pooler")) throw new Error("Las migraciones requieren conexión directa, sin -pooler. Usa MIGRATION_DATABASE_URL.");
const db = createPostgresDatabase(url);
try { await initializeDatabase(db); console.log("Esquema de registro aplicado."); } finally { await db.close(); }
