// The only module that talks to TypeDB. It works in the Worker (bindings from `env`) and in Node.js
// (scripts/setup.ts passes `process.env`), because the HTTP driver only needs `fetch`.
import { TypeDBHttpDriver, isApiErrorResponse, type ApiResponse, type ConceptDocument, type GivenRows } from "@typedb/driver-http";

/** Worker bindings: three secrets plus a plain var (see wrangler.jsonc and .dev.vars.example). */
export interface TypeDBEnv {
  TYPEDB_ADDRESS: string;
  TYPEDB_USERNAME: string;
  TYPEDB_PASSWORD: string;
  TYPEDB_DATABASE?: string;
}

/** Returns the success payload of a driver call, or throws the server's error. */
export function unwrap<T extends {} | null>(res: ApiResponse<T>): T {
  if (isApiErrorResponse(res)) throw new Error(res.err?.message ?? JSON.stringify(res.err));
  return res.ok;
}

export class TypeDB {
  readonly driver: TypeDBHttpDriver;
  readonly database: string;

  constructor(env: Partial<TypeDBEnv>) {
    for (const name of ["TYPEDB_ADDRESS", "TYPEDB_USERNAME", "TYPEDB_PASSWORD"] as const) {
      if (!env[name]) throw new Error(`Missing ${name}. Set it in .dev.vars locally or as a Worker secret.`);
    }
    // Don't set `tls.rootCAPath`: it needs Node's `https` module, which Workers doesn't have.
    // TypeDB Cloud's certificates are publicly trusted, so the default is enough.
    this.driver = new TypeDBHttpDriver({
      username: env.TYPEDB_USERNAME!,
      password: env.TYPEDB_PASSWORD!,
      addresses: [env.TYPEDB_ADDRESS!],
    });
    this.database = env.TYPEDB_DATABASE || "cloudflare_demo";
  }

  // User input never gets spliced into TypeQL. Queries declare inputs with a `given` stage
  // (e.g. `given $name: string;`) and the values travel separately as rows: `[{ name: "Ada" }]`.

  /** Runs a `match … fetch` query in its own read transaction and returns the JSON documents. */
  async read<T = ConceptDocument>(tql: string, given?: GivenRows): Promise<T[]> {
    const res = unwrap(await this.driver.oneShotQuery(tql, false, this.database, "read", undefined, undefined, given));
    if (res.answerType !== "conceptDocuments") throw new Error(`Expected a fetch query, got ${res.answerType}`);
    return res.answers as T[];
  }

  /** Runs one write query in its own transaction and commits it. */
  async write(tql: string, given?: GivenRows): Promise<void> {
    unwrap(await this.driver.oneShotQuery(tql, true, this.database, "write", undefined, undefined, given));
  }

  /** Runs several write queries in one transaction: all of them commit, or none do. */
  async writeAll(steps: { tql: string; given?: GivenRows }[]): Promise<void> {
    const { transactionId } = unwrap(await this.driver.openTransaction(this.database, "write"));
    try {
      for (const { tql, given } of steps) unwrap(await this.driver.query(transactionId, tql, undefined, given));
      unwrap(await this.driver.commitTransaction(transactionId));
    } catch (e) {
      await this.driver.closeTransaction(transactionId); // discard the uncommitted writes
      throw e;
    }
  }
}

// One client per isolate. The driver signs in on its first request and refreshes its token itself,
// so each cold start signs in once and later requests on a warm isolate reuse the token.
let shared: TypeDB | undefined;

export function getTypeDB(env: TypeDBEnv): TypeDB {
  shared ??= new TypeDB(env);
  return shared;
}
