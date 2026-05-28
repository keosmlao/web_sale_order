import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // Remote Postgres connections can leave idle sockets stale during local dev.
  // Keep the pool modest and let idle clients close quickly so requests do not
  // pick up a dead connection and fail with Prisma P1008/SocketTimeout.
  //
  // keepAliveInitialDelayMillis: macOS default idle TCP probe is 7200s, which
  // means NAT/firewalls along the path can silently drop a pooled connection
  // long before the kernel notices. A 10s initial delay makes the OS issue
  // keepalive probes early, so dead sockets are detected and recycled
  // before the next query lands on them.
  const pool = new Pool({
    connectionString,
    // Larger pool to absorb the dashboard fan-out (the homepage fires 7
    // parallel queries on every load) without queuing.
    max: 20,
    min: 0,
    idleTimeoutMillis: 10_000,
    // Establishing a TCP+TLS connection to the remote DB over Wi-Fi has
    // p95 latency around 5–8s; 10s was a hard ceiling that the page load
    // would routinely hit. 30s leaves headroom on a cold pool.
    connectionTimeoutMillis: 30_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    onPoolError: (err) => {
      console.warn("[prisma] idle pool client error:", err.message);
    },
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
