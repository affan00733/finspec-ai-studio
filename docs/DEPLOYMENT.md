# Deployment

## Option 1 — Netlify public demo (recommended)

- Config: `netlify.toml` (`base=frontend`, `npm ci && npm run build`, publish `dist`, SPA redirect)  
- No backend required  
- No API keys in Netlify env for the public site  
- Browser engine + bundled `demo-dataset.json`

Steps:
1. Connect the GitHub repo in Netlify  
2. Confirm build uses `netlify.toml`  
3. Deploy  
4. Open the site URL and use **Try Demo**

## Option 2 — Full stack

- Frontend: Netlify (set `VITE_API_URL` to your API origin **only** if the API is locked down)  
- Backend: Render (or similar) free/low-cost Python web service  
- Database: SQLite for demos; managed PostgreSQL for durable state  

**Free-tier caveats:** cold starts / sleep, ephemeral disk (do not rely on local uploads for durable public state).

## Local Docker

```bash
docker compose up --build
```

Celery/Redis is optional (`--profile async`).

## Do not
- Purchase services or push remotes without explicit approval  
- Put secrets in frontend env vars  
- Claim browser-only mode is a production multi-tenant deployment  
