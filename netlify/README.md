# TypeDB + Next.js on Netlify

A minimal Next.js (App Router) app that lists people and their interests, stored in TypeDB Cloud and queried over
TypeDB's HTTP API with [`@typedb/driver-http`](https://typedb.com/docs/reference/typedb-http-drivers/typescript/).
It is a variant of the [Vercel example](../vercel) for Netlify. The app code is the same, and the only addition is a
`netlify.toml`.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/typedb/typedb-examples&create_from_path=netlify)

## Prerequisites

- Node.js 22+
- A Netlify account
- TypeDB >= 3.15
  - You can deploy a free TypeDB Cloud cluster ([sign up](https://cloud.typedb.com)). From the cluster page you need:
    - its HTTP address, e.g. `https://<cluster>.cloud.typedb.com:8000`
    - a username and password

## Setup

```sh
cp .env.example .env.local   # fill in the four TYPEDB_* values
npm i
npm run db:setup             # creates the database, applies the schema, loads the seed data
npm run dev                  # http://localhost:3000
```

`db:setup` is idempotent: it creates the database only if it is missing, re-applies the schema (a no-op when it is
unchanged) and loads `typedb/seed.tql` only when there are no people yet.

To build and run the app with Netlify's adapter on your machine, use the Netlify CLI. It doesn't need a login:

```sh
npx netlify-cli build --offline
npx netlify-cli serve --offline   # serves the build; reads TYPEDB_* from .env.local
```

## How it works

The app code is identical to the Vercel example:

- **`lib/typedb.ts`** creates one driver per function instance and exposes `read`, `write` and `writeAll` helpers.
- **`app/page.tsx`** is a server component that lists people with one nested `match … fetch`.
- **`app/actions.ts`** has the `addPerson` server action, which inserts a person and links their topics in one transaction.
- **`app/people/[name]/page.tsx`** is a read whose parameter comes from the URL.
- **`app/api/health/route.ts`** is a connectivity check.

See the [Vercel example's README](../vercel/README.md#how-it-works) for a walkthrough.

Netlify detects Next.js and applies its [OpenNext adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
automatically. Server components, the server action and the route handler all run in one Netlify Function.
`netlify.toml` sets the build command and the publish directory. Its `[template.environment]` section lists the
variables that the Deploy button asks for.

## Deploy to Netlify

**With the button:** click **Deploy to Netlify** above. Netlify copies this directory into a new repo in your
GitHub account, asks for the four `TYPEDB_*` values, and deploys. Each later push redeploys.

**From an existing repo:** import the repo in Netlify. If it's the whole `typedb-examples` repo, set the
**Base directory** to `netlify`. Then add the four variables under **Site configuration → Environment
variables**, and mark `TYPEDB_PASSWORD` as containing a secret.

Then run `npm run db:setup` once against the same cluster, and open `/api/health` on your `*.netlify.app` URL. It
should return `{"ok":true,"typedb":{…}}`.

## Notes

- **Environment variables.** Set them in the Netlify UI, the CLI (`netlify env:set`) or through the Deploy button,
  not in `netlify.toml`. Values in `netlify.toml` reach the build but not the functions that run your server code.
  If your plan supports scoped variables, include the **Functions** scope. A local `netlify build` copies
  `.env.local` into the function bundle, so move it aside before you deploy from your machine with
  `netlify deploy --build`. Git-based deploys never see it, because it isn't committed.
- **Server-side only.** TypeDB is only queried from server components, route handlers and server actions, so
  credentials never reach the browser.
- **Runtime.** Next.js runs on Netlify Functions, which use Node.js. The driver only needs `fetch`.
- **Cold starts.** Each new function instance signs in once, on its first query. Warm invocations reuse the token.
- **Region.** Functions run in a single region. In the site's Functions settings, pick the region closest to your
  TypeDB Cloud cluster.
- **No string-built queries.** User input reaches TypeQL only through `given` rows (requires TypeDB 3.15+).

## Links

- [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [TypeQL reference](https://typedb.com/docs/typeql-reference/)
- [TypeDB HTTP API reference](https://typedb.com/docs/reference/typedb-http-api/)
- [TypeScript HTTP driver](https://typedb.com/docs/reference/typedb-http-drivers/typescript/)
