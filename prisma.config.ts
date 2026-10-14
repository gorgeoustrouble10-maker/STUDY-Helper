import { defineConfig } from 'prisma/config';
import path from 'node:path';
const directory = path.resolve(process.env.DATA_DIR || '.data');
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL || `file:${path.join(directory, 'garden.db').replaceAll('\\', '/')}` } });
