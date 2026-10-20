import { defineConfig } from 'prisma/config';
import path from 'node:path';
import fs from 'node:fs';
const directory = path.resolve(process.env.DATA_DIR || '.data');
const url = process.env.DATABASE_URL || `file:${path.join(directory, 'garden.db').replaceAll('\\', '/')}`;
// SQLite's migration engine can fail before creating a missing database on
// macOS as well as Windows. Exclusively create an empty file; never truncate data.
if (url.startsWith('file:') && url !== 'file::memory:') {
  const file = url.slice(5);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.closeSync(fs.openSync(file, 'wx')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url } });
