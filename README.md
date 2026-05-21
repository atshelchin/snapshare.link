# SnapShare.link

A fast, no-login file sharing web app. Share files and text instantly through channels.

## Features

- **Channel-based sharing** — Join a channel by ID, anyone with the same ID sees the same content
- **Drag & drop upload** — Drag files directly into the upload area (supports multiple files)
- **Text sharing** — Share text snippets alongside files
- **Real-time updates** — SSE-powered live file list updates
- **Auto-expiry** — All uploaded files are automatically deleted after 1 hour
- **i18n** — English and Chinese language support
- **Dark mode** — Light/dark theme toggle
- **QR code** — Share channels via QR code
- **No login required**

## Tech Stack

- [SvelteKit](https://svelte.dev/) + Svelte 5
- [Cloudflare Workers](https://workers.cloudflare.com/) (adapter-cloudflare)
- [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) for file storage (S3-compatible presigned URLs)
- [Drizzle ORM](https://orm.drizzle.team/) + libSQL
- [Playwright](https://playwright.dev/) for E2E tests
- [Vitest](https://vitest.dev/) for unit tests

## Environment Variables

### Cloudflare Bindings (wrangler.jsonc)

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | SQLite database for file metadata and orders |
| `KV` | KV Namespace | Temporary storage for rate limiting and payment order polling |
| `PAID_BUCKET_30D` | R2 Bucket | Paid vault storage (30-day plan) |
| `PAID_BUCKET_7D` | R2 Bucket | Paid vault storage (7-day plan) |
| `ASSETS` | Assets | Static assets serving |

### Secrets (`wrangler secret put <NAME>`)

| Variable | Description |
|----------|-------------|
| `ACCESS_KEY_ID` | Cloudflare R2 S3-compatible access key ID |
| `SECRET_ACCESS_KEY` | Cloudflare R2 S3-compatible secret access key |
| `ACCOUNT_ID` | Cloudflare account ID (for R2 endpoint) |
| `BUCKET` | R2 bucket name for free-tier file uploads |
| `REGION` | R2 region (typically `auto`) |

### Cleanup Worker (`workers/cleanup/`)

| Variable | Description |
|----------|-------------|
| `CLEANUP_SECRET` | Auth token for the cleanup cron endpoint |
| `CLEANUP_URL` | Optional. Defaults to `https://snapshare.link/api/cleanup` |

## Development

```sh
pnpm install
pnpm dev
```

## Database

```sh
pnpm db:generate   # generate Drizzle migrations
npx wrangler d1 migrations apply snapshare --local   # apply to local D1
npx wrangler d1 migrations apply snapshare --remote  # apply to production D1
pnpm db:studio     # open Drizzle Studio
```

## Build & Deploy

```sh
pnpm build
pnpm deploy   # deploys to Cloudflare Workers

# Deploy cleanup cron worker
cd workers/cleanup && wrangler deploy
```
