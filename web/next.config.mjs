/**
 * The site is exported as static files, because it is documentation for a
 * desktop app: there is nothing to run on a server, and a folder of HTML can
 * be hosted by GitHub Pages, a bucket, or anything else.
 *
 * GitHub Pages serves a project site from a subpath (/nibble), so the base
 * path is an environment variable rather than a constant: empty locally,
 * set by the workflow when it deploys.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  // Trailing slashes keep /docs/memory working as a directory of index.html
  // files on a plain static host, with no rewrite rules.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
