import type { NextConfig } from 'next';

/**
 * The dashboard and the API appear to the browser as ONE origin (ADR-016):
 * requests to /admin/* on the dashboard are forwarded to the API's /admin/* routes.
 * The API's session cookie (path=/admin, SameSite=Strict, httpOnly) therefore works unchanged,
 * and no CORS is needed for the dashboard.
 */
const apiUrl = process.env.MUSRIDE_API_URL ?? 'http://localhost:3000';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js needs inline scripts for hydration; no third-party scripts are allowed.
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      // OpenStreetMap tiles for the live map (ADR-016; production tile source is owner action OA-20).
      "img-src 'self' data: blob: https://tile.openstreetmap.org",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/admin/:path*', destination: `${apiUrl}/admin/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
