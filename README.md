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

## Development

```sh
pnpm install
pnpm dev
```

## Build & Deploy

```sh
pnpm build
pnpm deploy   # deploys to Cloudflare Workers
```

## Database

```sh
pnpm db:generate   # generate migrations
pnpm db:push       # push schema to DB
pnpm db:studio     # open Drizzle Studio
```
