import { PrismaClient } from "@prisma/client";

/** One Prisma client for the process. `@prisma/client` loads `.env` itself. */
export const prisma = new PrismaClient();
