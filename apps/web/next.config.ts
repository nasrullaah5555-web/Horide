import type { NextConfig } from 'next';

/**
 * The public website is fully static (`next build` writes plain HTML to out/), so it can be
 * hosted on any static host such as Cloudflare Pages (DEPLOYMENT_GUIDE). Security headers for a
 * static host are in public/_headers (Cloudflare Pages / Netlify format).
 */
const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
