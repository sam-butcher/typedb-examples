# TypeDB + Next.js on Cloudflare Workers

A minimal Next.js (App Router) app that lists people and their interests, stored in TypeDB Cloud and queried over
TypeDB's HTTP API with [`@typedb/driver-http`](https://typedb.com/docs/reference/typedb-http-drivers/typescript/).
It runs on Cloudflare Workers through the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare).
It is a variant of the [Vercel example](../vercel). The app code is the same, and only the platform config differs.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/typedb/typedb-examples/tree/master/cloudflare)

## Prerequisites

- Node.js 22+
- A Cloudflare account
- A free TypeDB Cloud cluster ([sign up](https://cloud.typedb.com)). From the cluster page you need:
  - its HTTP address, e.g. `https://<cluster>.cloud.typedb.com:8000`
  - a username and password

## Setup

```sh
cp .env.example .env.local   # fill in the four TYPEDB_* values
npm i
npm run db:setup             # creates the database, applies the schema, loads the seed data
npm run dev                  # Next.js dev server on Node.js, http://localhost:3000
npm run preview              # builds for Workers and runs it locally in workerd, http://localhost:8787
```

`db:setup` is idempotent: it creates the database only if it is missing, re-applies the schema (a no-op when it is
unchanged) and loads `typedb/seed.tql` only when there are no people yet.

## How it works

The app code is identical to the Vercel example:

- **`lib/typedb.ts`** creates one driver per Worker isolate and exposes `read`, `write` and `writeAll` helpers.
- **`app/page.tsx`** is a server component that lists people with one nested `match … fetch`.
- **`app/actions.ts`** has the `addPerson` server action, which inserts a person and links their topics in one transaction.
- **`app/people/[name]/page.tsx`** is a read whose parameter comes from the URL.
- **`app/api/health/route.ts`** is a connectivity check.

See the [Vercel example's README](../vercel/README.md#how-it-works) for a walkthrough.

These files are specific to Cloudflare:

| File | Purpose |
| --- | --- |
| `wrangler.jsonc` | Worker config. `nodejs_compat` is required by OpenNext, `main` and `assets` point at the OpenNext build output, and `WORKER_SELF_REFERENCE` is a service binding that OpenNext uses. |
| `open-next.config.ts` | OpenNext config. It's empty because every page is rendered per request, so no incremental cache is needed. |
| `public/_headers` | Long-lived caching for Next.js's hashed static assets. |
| `package.json` | Adds the `preview` and `deploy` scripts. The `cloudflare.bindings` block gives the Deploy button a description for each variable. |

## Deploy to Cloudflare

**With the button:** click **Deploy to Cloudflare** above. Cloudflare copies this directory into a new repo in your
GitHub or GitLab account, asks for the four `TYPEDB_*` values (listed in `.env.example`), and sets up Workers Builds
so that every push redeploys.

**From your machine:**

```sh
npx wrangler login
npm run deploy
npx wrangler secret put TYPEDB_PASSWORD    # repeat for TYPEDB_ADDRESS, TYPEDB_USERNAME, TYPEDB_DATABASE
```

Then run `npm run db:setup` once against the same cluster, and open `/api/health` on your `*.workers.dev` URL. It
should return `{"ok":true,"typedb":{…}}`.

## Notes

- **Environment variables.** At runtime, OpenNext copies the Worker's vars and secrets into `process.env`, so
  `lib/typedb.ts` reads them as it would anywhere else. When you build locally, OpenNext also bundles your
  `.env.local` values into the Worker as a fallback. Values set on the Worker take precedence. To keep local
  credentials out of the bundle, deploy with the button or Workers Builds, or move `.env.local` aside before
  running `npm run deploy`.
- **Runtime.** OpenNext runs Next.js in the Workers runtime with Node.js compatibility. It doesn't support
  `export const runtime = "edge"`, which this app doesn't use. The driver only needs `fetch`. Don't set its
  `tls.rootCAPath` option, because it needs Node's `https` module, which Workers doesn't provide. TypeDB Cloud's
  certificates are publicly trusted, so you don't need it.
- **Cold starts.** Each new isolate signs in once, on its first query. Later requests on a warm isolate reuse the
  token.
- **No string-built queries.** User input reaches TypeQL only through `given` rows (requires TypeDB 3.15+).
- **Size limits.** The bundled Worker must fit Cloudflare's script size limit, which is 3 MiB compressed on the Free
  plan and 10 MiB on paid plans. This app is about 1.1 MiB compressed.

## Links

- [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
- [TypeQL reference](https://typedb.com/docs/typeql-reference/)
- [TypeDB HTTP API reference](https://typedb.com/docs/reference/typedb-http-api/)
- [TypeScript HTTP driver](https://typedb.com/docs/reference/typedb-http-drivers/typescript/)
