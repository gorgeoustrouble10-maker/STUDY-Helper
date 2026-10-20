import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export const dataDir = path.resolve(process.env.DATA_DIR || '.data');
fs.mkdirSync(dataDir, { recursive: true });
export const databaseUrl = process.env.DATABASE_URL || `file:${path.join(dataDir, 'garden.db').replaceAll('\\', '/')}`;
const globalDb = globalThis as unknown as {
    gardenDb?: PrismaClient;
};
export const db = globalDb.gardenDb || new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
globalDb.gardenDb = db;
