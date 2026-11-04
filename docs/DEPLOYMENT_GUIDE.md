# Deployment Guide

Status: **not deployed**. Filled in during T-045.

Planned shape:
- API: Render paid web service (Frankfurt), health check `/health`, migrations run as a pre-deploy command.
- Admin and website: Render (Next.js).
- Database and private document storage: Supabase (Frankfurt), separate staging and production projects.
- DNS/TLS: Cloudflare. Subdomains: `api.`, `admin.`, root for the website.
- Secrets live only in Render/Supabase settings, never in Git.

Prerequisites: OA-07, OA-12, OA-13, OA-14.
