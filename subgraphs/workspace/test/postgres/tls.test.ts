import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDatabase, type Database } from "./database.ts";

// The wrong-name case connects to 127.0.0.2, which Linux routes to loopback and macOS doesn't.
// U-23: what `sslmode=verify-full` makes pg 8.23.1 check, on a server whose certificate a test CA
// signed for 127.0.0.1 only. Each connection runs in its own process, because Node reads
// NODE_EXTRA_CA_CERTS only at start-up.
const PORT = 5435;
const certs = mkdtempSync(join(tmpdir(), "traverse-tls-"));
const openssl = (...args: string[]) =>
  execFileSync("openssl", args, { cwd: certs, stdio: "ignore" });
let database: Database | undefined;

const POOL = new URL("../../src/subgraph.ts", import.meta.url).href;
const CONNECT = `
import { createDatabasePool } from ${JSON.stringify(POOL)};
const pool = createDatabasePool(process.env);
try {
  const { rows } = await pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
  console.log(JSON.stringify(rows[0]));
} catch (error) {
  console.log(JSON.stringify({ error: error.code ?? error.message }));
} finally {
  await pool.end();
}`;

const connect = (host: string, ca?: string) => {
  const { stdout } = spawnSync(process.execPath, ["--input-type=module", "-e", CONNECT], {
    encoding: "utf8",
    // The pool gives up after 5 seconds; this only stops a hung process from holding the run.
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: `postgres://traverse:traverse@${host}:${String(PORT)}/traverse?sslmode=verify-full`,
      ...(ca === undefined ? {} : { NODE_EXTRA_CA_CERTS: ca }),
    },
  });
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { ssl?: boolean; error?: string };
};

beforeAll(async () => {
  const day = ["-days", "1"];
  openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    ...day,
    "-subj",
    "/CN=Traverse test CA",
  );
  openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=database",
  );
  writeFileSync(join(certs, "san.ext"), "subjectAltName=IP:127.0.0.1\n");
  openssl(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    ...day,
    "-extfile",
    "san.ext",
  );
  database = await startDatabase(PORT, { tls: certs, alsoOn: ["127.0.0.2"] });
}, 120_000);

afterAll(() => {
  database?.stop();
  rmSync(certs, { recursive: true, force: true });
});

describe("pg with sslmode=verify-full", () => {
  it("[NFR-7] connects over TLS to a server whose CA it trusts, under the name it was given", () => {
    expect(connect("127.0.0.1", join(certs, "ca.crt"))).toEqual({ ssl: true });
  });

  it("[NFR-7] refuses a server whose CA isn't in Node's store", () => {
    expect(connect("127.0.0.1")).toEqual({ error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  });

  it("[NFR-7] refuses a trusted certificate issued for another name", () => {
    expect(connect("127.0.0.2", join(certs, "ca.crt"))).toEqual({
      error: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });
});
