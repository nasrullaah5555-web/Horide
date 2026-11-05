# Deployment Guide

Status: **not deployed**. Filled in during T-045.

Planned shape:
- API: Render paid web service (Frankfurt), health check `/health`, migrations run as a pre-deploy command.
- Admin: Render (Next.js server, needed for the /admin proxy, ADR-016).
- Website: static files (`pnpm --filter @horide/web build` → `apps/web/out/`), hostable on Cloudflare Pages or any static host; security headers in `apps/web/public/_headers`.
- Database and private document storage: Supabase (Frankfurt), separate staging and production projects.
- DNS/TLS: Cloudflare. Subdomains: `api.`, `admin.`, root for the website.
- Secrets live only in Render/Supabase settings, never in Git.

Prerequisites: OA-07, OA-12, OA-13, OA-14.
