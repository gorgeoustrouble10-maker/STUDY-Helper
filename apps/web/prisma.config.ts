import { defineConfig } from 'prisma/config';
import path from 'node:path';
import fs from 'node:fs';
const directory = path.resolve(process.env.DATA_DIR || '.data');
const url = process.env.DATABASE_URL || `file:${path.join(directory, 'garden.db').replaceAll('\\', '/')}`;
// On Windows the SQLite engine may fail without diagnostics when the file does
// not yet exist. Create only a new empty file; never truncate an existing DB.
if (process.platform === 'win32' && url.startsWith('file:')) {
  const file = url.slice(5);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.closeSync(fs.openSync(file, 'wx')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url } });
