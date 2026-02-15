# Security

## Secrets
- `.env` / `.env.local` are gitignored  
- `.env.example` documents variables without values  
- Provider keys live **only** on the backend  

## Demo isolation
- Browser demo state is per-visitor (`localStorage`)  
- Reset Demo restores defaults  
- Simulated roles are labeled; frontend checks are not real authorization  

## Live providers
- No unrestricted anonymous paid endpoint on the public demo  
- No silent fallback from failed paid calls to mock results  
- LLM answers must be grounded (quote must appear in retrieved context)  

## Uploads (backend)
- Type/size limits  
- Treat content as untrusted  
- Do not execute uploaded files  
- Guard against prompt injection into model instructions  

## Logging
Never log API keys or full authorization headers.
