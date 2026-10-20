import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const config: NextConfig = {
  output: 'standalone', serverExternalPackages: ['better-sqlite3'], poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
  ] }]; }
};
export default config;
