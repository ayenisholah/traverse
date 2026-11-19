import { execFileSync } from "node:child_process";
import pg from "pg";

/** The pinned image, by digest, so a moved tag can't change what's tested. */
const POSTGRES_IMAGE =
  "postgres@sha256:526f86d93c6ea08fd3f1fe5605650cacc781b2c6013169a0ad8f42c7d3d84f32";

export interface Database {
  url: string;
  pool: () => pg.Pool;
  stop: () => void;
}

export interface DatabaseOptions {
  /** A folder holding `server.crt` and `server.key`, to serve TLS with. */
  tls?: string;
  /** Other loopback addresses to publish on, besides 127.0.0.1. */
  alsoOn?: string[];
}

// Postgres refuses a key others can read, so the files are copied in and handed to its user.
const SERVE_TLS = [
  "mkdir -p /tls && cp /certs/server.crt /certs/server.key /tls/",
  "chown postgres:postgres /tls/* && chmod 600 /tls/server.key",
  "exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key",
].join(" && ");

/** Runs Postgres in Docker on a free port, and waits until it takes connections. */
export const startDatabase = async (
  port: number,
  { tls, alsoOn = [] }: DatabaseOptions = {},
): Promise<Database> => {
  const name = `traverse-postgres-test-${String(process.pid)}-${String(port)}`;
  execFileSync("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    ...["127.0.0.1", ...alsoOn].flatMap((address) => [
      "--publish",
      `${address}:${String(port)}:5432`,
    ]),
    "--env",
    "POSTGRES_USER=traverse",
    "--env",
    "POSTGRES_PASSWORD=traverse",
    "--env",
    "POSTGRES_DB=traverse",
    ...(tls === undefined
      ? [POSTGRES_IMAGE]
      : ["--volume", `${tls}:/certs:ro`, "--entrypoint", "sh", POSTGRES_IMAGE, "-c", SERVE_TLS]),
  ]);
  const url = `postgres://traverse:traverse@127.0.0.1:${String(port)}/traverse`;
  const stop = () => {
    execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  };
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = new pg.Client({ connectionString: url });
    const ready = await probe.connect().then(
      async () => {
        await probe.end();
        return true;
      },
      () => false,
    );
    if (ready) return { url, pool: () => new pg.Pool({ connectionString: url }), stop };
    await new Promise((done) => setTimeout(done, 250));
  }
  stop();
  throw new Error("Postgres never became ready");
};
