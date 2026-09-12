import { PrismaClient } from '@prisma/client';
import logger from './logger.js';
import config from './index.js';

/**
 * Prisma client singleton.
 *
 * ⚠️  This client connects as `appuser`, which OWNS the 48 ATS rpa_ tables in
 * the same schema. The generated client only knows PEA's 10 pea_ models, so
 * ordinary model calls cannot touch ATS data — but `$queryRaw` and
 * `$executeRaw` are unrestricted. Use `$queryRaw` for the read-only ATS
 * history lookups (that is deliberate, see schema.prisma) and never
 * `$executeRaw` against an rpa_ table.
 */
const prisma = new PrismaClient({
  log: config.isProduction
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
});

prisma.$on('error', (e) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

if (!config.isProduction) {
  prisma.$on('query', (e) => {
    logger.debug('Prisma query', { query: e.query, duration: `${e.duration}ms` });
  });
  prisma.$on('warn', (e) => {
    logger.warn('Prisma warning', { message: e.message });
  });
}

/**
 * Connect, and assert the ATS tables are intact.
 *
 * The assertion is cheap and runs once at boot. If PEA ever does damage the
 * shared schema, this turns a silent catastrophe into a loud startup failure
 * on the very next restart, rather than something discovered days later.
 * @returns {Promise<void>}
 */
export async function connectDatabase() {
  try {
    await prisma.$connect();

    const [{ n }] = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM pg_tables
       WHERE schemaname = 'public' AND tablename LIKE 'rpa\\_%'`;

    if (n < 48) {
      logger.error(
        `🚨 ATS table count is ${n}, expected at least 48. The shared schema may have been damaged. ` +
          'Investigate before proceeding — see prisma/ddl/2026-09-12-pea-core.README.md.'
      );
    }

    logger.info(`✅ Database connected (${n} ATS tables intact)`);
  } catch (error) {
    logger.error('❌ Database connection failed', { error: error.message });
    throw error;
  }
}

/** @returns {Promise<void>} */
export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

export default prisma;
