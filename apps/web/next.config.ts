import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone', serverExternalPackages: ['better-sqlite3'], poweredByHeader: false,
  outputFileTracingExcludes: { '/*': ['./apps/study-board/**/*'] },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
  ] }]; }
};
export default config;
