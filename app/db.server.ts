import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Rust free Prisma client over node-postgres. DATABASE_URL should be the Supabase
// transaction pooler URL (port 6543) in production; a placeholder keeps module load
// from throwing in places that never touch the database, like the public demo.

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/unset";
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

const prisma = global.prismaGlobal ?? createClient();
if (process.env.NODE_ENV !== "production") global.prismaGlobal = prisma;

export default prisma;
