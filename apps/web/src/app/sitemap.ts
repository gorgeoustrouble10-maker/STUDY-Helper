import type { MetadataRoute } from 'next';
import { publicList } from '@/lib/store';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> { const base = process.env.SITE_URL || 'http://localhost:3000'; const prefix: Record<string, string> = { article: 'articles', work: 'works', garden: 'garden', recommendation: 'recommendations' }; return [...['', '/about', '/works', '/articles', '/garden', '/recommendations', '/connect', '/topics'].map(x => ({ url: base + x })), ...(await publicList()).map(x => ({ url: `${base}/${prefix[x.type]}/${x.slug}`, lastModified: new Date(x.publishedAt) }))]; }
