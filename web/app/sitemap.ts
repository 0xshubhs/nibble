import type { MetadataRoute } from 'next';
import { DOC_PAGES, ORIGIN } from '@/lib/site';

export const dynamic = 'force-static';

/** Every page, from the same list the navigation is built from. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ['/', '/download/', '/faq/', ...DOC_PAGES.map((p) => p.href)];
  const lastModified = new Date();
  return paths.map((path) => ({
    url: `${ORIGIN}${path}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: path === '/' ? 1 : 0.7,
  }));
}
