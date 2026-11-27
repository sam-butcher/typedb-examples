# TypeDB on Cloudflare Workers

A minimal Cloudflare Worker that lists people and their interests, stored in TypeDB Cloud and queried over TypeDB's
HTTP API with [`@typedb/driver-http`](https://typedb.com/docs/reference/typedb-http-drivers/typescript/). The driver
depends only on `fetch`, so it runs natively in Workers, with no adapter and no Node.js compatibility flag. The app
uses [Hono](https://hono.dev) for routing and its built-in JSX for server-rendered HTML. It needs no client-side
JavaScript.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/typedb/typedb-examples/tree/master/cloudflare)

## Prerequisites

- Node.js 22+
- A Cloudflare account
- TypeDB >= 3.15
  - You can deploy a free TypeDB Cloud cluster ([sign up](https://cloud.typedb.com)). From the cluster page you need:
    - its HTTP address, e.g. `https://<cluster>.cloud.typedb.com:8000`
    - a username and password

## Setup

```sh
cp .dev.vars.example .dev.vars   # fill in TYPEDB_ADDRESS, TYPEDB_USERNAME, TYPEDB_PASSWORD
npm i
npm run db:setup                 # creates the database, applies the schema, loads the seed data
npm run dev                      # wrangler dev, http://localhost:8787
```

`db:setup` is idempotent: it creates the database only if it is missing, re-applies the schema (a no-op when it is
unchanged) and loads `typedb/seed.tql` only when there are no people yet.

`npm run dev` runs the Worker in `workerd`, the same runtime as production.

## How it works

**`src/typedb.ts`** is the only file that talks to TypeDB.
- The `TypeDB` class takes the Worker's bindings, creates a `TypeDBHttpDriver`, and throws a clear error if a
  secret is missing.
- `read(tql, given?)` runs a `match … fetch` query with `oneShotQuery(…, "read")` and returns its JSON documents.
- `write(tql, given?)` runs one write query and commits it.
- `writeAll(steps)` runs several queries in one write transaction (`openTransaction` → `query` × n →
  `commitTransaction`), so they commit together or not at all.
- `getTypeDB(env)` keeps one client per isolate, so warm requests reuse the driver and its sign-in token.

**`src/index.tsx`** is the Hono app:

| Route | What it does |
| --- | --- |
| `GET /` | One nested `match … fetch` returns each person with their topics. The page renders the list and an HTML form. |
| `POST /people` | Validates the form, then inserts the person and links each chosen topic in one transaction. On success it redirects back to `/` (post/redirect/get). On failure it re-renders the page with the error, for example when the name already exists and breaks the `@key` constraint. |
| `GET /people/:name` | A read whose parameter comes from the URL. |
| `GET /api/health` | `health()` + `version()`, a quick connectivity check. |

The page's main query:

```typeql
match $p isa person, has name $n;
sort $n;
fetch {
  "name": $n,
  "topics": [ match interest (fan: $p, subject: $t); fetch { "name": $t.name }; ]
};
```

**`wrangler.jsonc`** is the Worker config. `TYPEDB_DATABASE` is a plain var, set to `cloudflare_demo` by default.
The address, username and password are secrets, so they aren't in this file.

**`scripts/setup.ts`** runs in Node.js, reads `.dev.vars`, and uses the same `TypeDB` class as the Worker.

## Deploy to Cloudflare

**With the button:** click **Deploy to Cloudflare** above. Cloudflare copies this directory into a new repo in your
GitHub or GitLab account, asks for the three secrets (listed in `.dev.vars.example`), and sets up Workers Builds so
that every push redeploys.

**From your machine:**

```sh
npx wrangler login
npm run deploy
npx wrangler secret put TYPEDB_ADDRESS    # repeat for TYPEDB_USERNAME and TYPEDB_PASSWORD
```

Then run `npm run db:setup` once against the same cluster, and open `/api/health` on your `*.workers.dev` URL. It
should return `{"ok":true,"typedb":{…}}`.

## Notes

- **Secrets stay in the Worker.** Credentials are Worker secrets and are only read on the server. The pages are
  plain HTML, so nothing about TypeDB reaches the browser.
- **No string-built queries.** User input reaches TypeQL only through `given` rows. Queries declare their inputs
  (`given $name: string;`), and the values travel separately: `read(query, [{ name }])`. This requires TypeDB 3.15+.
- **Cold starts.** Each new isolate signs in once, on its first query. Later requests on a warm isolate reuse the
  token.
- **One transaction per request.** `read` and `write` use one-shot queries, which open a transaction, run the query,
  commit if needed and close it in a single HTTP call. `writeAll` is for the case where several writes must be
  atomic.
- **TLS.** Don't set the driver's `tls.rootCAPath` option, because it needs Node's `https` module, which Workers
  doesn't provide. TypeDB Cloud's certificates are publicly trusted, so you don't need it.
- **Types.** `npm run typecheck` generates the Workers runtime types (`worker-configuration.d.ts`, gitignored) with
  `wrangler types`, then runs `tsc`.
- **Small bundle.** The deployed Worker is about 30 KiB gzipped.

## Links

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [Hono](https://hono.dev)
- [TypeQL reference](https://typedb.com/docs/typeql-reference/)
- [TypeDB HTTP API reference](https://typedb.com/docs/reference/typedb-http-api/)
- [TypeScript HTTP driver](https://typedb.com/docs/reference/typedb-http-drivers/typescript/)
