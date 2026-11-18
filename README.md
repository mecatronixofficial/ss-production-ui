# Yarn Production ERP — Frontend

Next.js 15 (App Router) + React 19 + Tailwind CSS client for the yarn-to-fabric ERP.
All data comes from the NestJS backend in `../backend`.

## Setup

```bash
cp .env.example .env   # then adjust BACKEND_URL if the API is not on :4000
bun install            # or npm install
bun run dev            # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | Optional backend-origin override. `/api/*` is proxied there by a Next.js rewrite, so auth cookies stay first-party. Defaults to `https://ss-production-server.vercel.app` in production and `http://localhost:4000` in dev. |
| `NEXT_PUBLIC_API_URL` | API base path used by the browser (default `/api/v1`). |
| `NEXT_PUBLIC_SITE_URL` | Public origin (e.g. `https://erp.example.com`) used for canonical URLs, Open Graph, `robots.txt` and `sitemap.xml`. Defaults to `http://localhost:3000`. |

## Vercel deployment

Production builds use `https://ss-production-server.vercel.app` automatically. To use a different backend, add `BACKEND_URL` in the frontend project's **Settings → Environment Variables**. Use the backend's HTTPS origin, without `/api` or `/api/v1`. A local address such as `http://localhost:8000` is for development only.

Apply the variable to **Production** and **Preview** (including the `ssmills` branch if it is a preview branch), then redeploy. Environment changes apply to new deployments. Keep `NEXT_PUBLIC_API_URL=/api/v1`; the frontend proxies those requests to `BACKEND_URL` so login cookies stay first-party.

Older commits that report `BACKEND_URL must be set` still require the variable. Deploy the updated config or set the variable on this frontend project and in the deployment's environment. A variable configured only on the backend project or only for Development is not available to the frontend build.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js dev server, production build, production server |
| `typecheck` | `tsc --noEmit` |
| `lint` / `lint:fix` | ESLint (flat config, `next/core-web-vitals` + `next/typescript`) |
| `check` | Type-check + lint (use in CI) |

## Structure

```
app/
  (erp)/            Authenticated pages, wrapped by components/erp-shell.tsx
  login/            Sign-in + forgot-password page (supports ?next=/path)
  not-found.tsx, global-error.tsx, (erp)/error.tsx, (erp)/loading.tsx
components/
  ui/               Button (cva + asChild), Badge (+ statusTone), Card, Field, Input, ConfirmHost …
  data-table.tsx    TanStack table with search, sorting, paging, empty state, serialColumn()
  master-crud.tsx   Reusable list + add/edit/delete screen for master data
lib/
  api.ts            fetch wrapper: JSON, error toasts, single-flight token refresh, apiDownload()
  use-api-query.ts  Load data with loading/error/reload and stale-response protection
  use-api-action.ts Run mutations with busy/message state and toasts
  navigation.ts     Sidebar sections + role access rules (also used by the route guard)
  confirm-store.ts  confirmDialog() — accessible replacement for window.confirm
```

## Conventions

- **Access control**: add every new page to `lib/navigation.ts` with its roles. The shell redirects
  users away from pages their role can't open, and the sidebar is generated from the same list.
- **Loading data**: use `useApiQuery(path)` and render `<ErrorState>` / `<Loading>` for the first load.
- **Mutations**: use `useApiAction().run(fn, successMessage)`; validation problems go through `reject()`.
  `api()` already toasts server errors, so don't toast them again.
- **Quick create**: the floating “+” menu (`components/floating-actions.tsx`) links to pages with `?new=1`;
  call `useNewParam(openForm)` on a page to support it (`MasterCrud` already does).
- **Destructive actions**: always ask with `await confirmDialog({ ..., tone: "danger" })`.
- **Buttons** default to `type="button"`; submit buttons inside forms must say `type="submit"`.
- **Styling**: page-level styles live in `app/globals.css` under a page prefix (e.g. `.orders-list-page`).
  Heavy page-specific CSS can live next to the page (see `app/(erp)/production/production.css`).
