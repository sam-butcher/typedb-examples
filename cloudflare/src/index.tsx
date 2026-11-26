import { Hono } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { getTypeDB, unwrap, type TypeDBEnv } from "./typedb";

const app = new Hono<{ Bindings: TypeDBEnv }>();

type Person = { name: string; topics: { name: string }[] };

const Layout: FC<PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · People & interests` : "People & interests"}</title>
      <style>{`
        body { max-width: 40rem; margin: 2.5rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; color: #111; }
        a { color: inherit; } .muted { color: #666; font-size: .9rem; } .error { color: #b91c1c; }
        ul.people { list-style: none; padding: 0; } ul.people li { display: flex; justify-content: space-between; padding: .5rem 0; border-bottom: 1px solid #eee; }
        form { border: 1px solid #ddd; border-radius: .25rem; padding: 1rem; display: grid; gap: .75rem; }
        input[type=text] { padding: .3rem .5rem; } fieldset { border: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .75rem; }
      `}</style>
    </head>
    <body>
      <header>
        <h1 style="margin-bottom: 0"><a href="/" style="text-decoration: none">People &amp; interests</a></h1>
        <p class="muted">A Cloudflare Worker backed by TypeDB.</p>
      </header>
      {children}
    </body>
  </html>
);

// Lists everyone with their topics, plus the form to add a person. `error` is set when a submission fails.
async function home(env: TypeDBEnv, error?: string) {
  const db = getTypeDB(env);
  const [people, topics] = await Promise.all([
    db.read<Person>(`
      match $p isa person, has name $n;
      sort $n;
      fetch {
        "name": $n,
        "topics": [
          match interest (fan: $p, subject: $t);
          fetch { "name": $t.name };
        ]
      };
    `),
    db.read<{ name: string }>(`match $t isa topic, has name $n; sort $n; fetch { "name": $n };`),
  ]);

  return (
    <Layout>
      <ul class="people">
        {people.map((p) => (
          <li>
            <a href={`/people/${encodeURIComponent(p.name)}`}>{p.name}</a>
            <span class="muted">{p.topics.map((t) => t.name).join(", ") || "—"}</span>
          </li>
        ))}
      </ul>
      <form method="post" action="/people">
        <strong>Add a person</strong>
        <input type="text" name="name" placeholder="Name" required maxlength={100} />
        <fieldset>
          {topics.map((t) => (
            <label>
              <input type="checkbox" name="topic" value={t.name} /> {t.name}
            </label>
          ))}
        </fieldset>
        <button type="submit">Add</button>
        {error && <p class="error">{error}</p>}
      </form>
    </Layout>
  );
}

app.get("/", async (c) => c.html(await home(c.env)));

// A plain HTML form post: on success, redirect back to the list (post/redirect/get); on failure, re-render with the error.
app.post("/people", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const name = String(body.name ?? "").trim();
  const topics = [body.topic ?? []].flat().map(String);

  if (!name) return c.html(await home(c.env, "Name is required."), 400);
  if (name.length > 100) return c.html(await home(c.env, "Name must be at most 100 characters."), 400);
  if (/[\p{Cc}]/u.test(name)) return c.html(await home(c.env, "Name contains control characters."), 400);

  // `datetime` has no time zone, so send UTC without the trailing "Z".
  const createdAt = new Date().toISOString().replace("Z", "");

  try {
    // One write transaction: create the person, then link each chosen (existing) topic.
    await getTypeDB(c.env).writeAll([
      {
        tql: `given $name: string, $at: datetime;
              insert $p isa person, has name == $name, has created-at == $at;`,
        given: [{ name, at: createdAt }],
      },
      ...(topics.length > 0
        ? [{
            tql: `given $name: string, $topic: string;
                  match $p isa person, has name == $name;
                        $t isa topic, has name == $topic;
                  insert interest (fan: $p, subject: $t);`,
            given: topics.map((topic) => ({ name, topic })),
          }]
        : []),
    ]);
  } catch (e) {
    if (e instanceof Error && e.message.includes("[CNT9]")) {
      return c.html(await home(c.env, `"${name}" already exists.`), 409);
    }
    throw e;
  }

  return c.redirect("/", 303);
});

// A parameterised read: the URL segment is bound to $name as a given row, never spliced into the query.
app.get("/people/:name", async (c) => {
  const [person] = await getTypeDB(c.env).read<Person & { createdAt: string | null }>(
    `given $name: string;
     match $p isa person, has name == $name;
     fetch {
       "name": $p.name,
       "createdAt": $p.created-at,
       "topics": [
         match interest (fan: $p, subject: $t);
         fetch { "name": $t.name };
       ]
     };`,
    [{ name: c.req.param("name") }],
  );
  if (!person) return c.notFound();

  return c.html(
    <Layout title={person.name}>
      <h2>{person.name}</h2>
      {person.createdAt && <p class="muted">Joined {person.createdAt.slice(0, 10)}</p>}
      <ul>
        {person.topics.map((t) => (
          <li>{t.name}</li>
        ))}
      </ul>
      {person.topics.length === 0 && <p class="muted">No interests yet.</p>}
      <p>
        <a href="/">← All people</a>
      </p>
    </Layout>,
  );
});

// Connectivity check: useful as a first request after deploying.
app.get("/api/health", async (c) => {
  try {
    const { driver } = getTypeDB(c.env);
    unwrap(await driver.health());
    return c.json({ ok: true, typedb: unwrap(await driver.version()) });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 503);
  }
});

app.onError((err, c) => {
  console.error(err);
  return c.html(
    <Layout title="Error">
      <p class="error">Something went wrong talking to TypeDB. Check the Worker logs.</p>
    </Layout>,
    500,
  );
});

export default app;
