import { PrismaClient } from '@prisma/client';
import logger from './logger.js';
import config from './index.js';

/**
 * Prisma client singleton.
 *
 * PEA reads and writes only its own pea_ tables. It is a separate project from
 * ATS with its own database (decision D5). No code in PEA queries an ATS table.
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

/** The tables PEA cannot run without. */
const CORE_TABLES = [
  'pea_users', 'pea_sessions', 'pea_employees', 'pea_evaluation_cycles', 'pea_evaluation_scores',
  'pea_evaluation_params', 'pea_email_log', 'pea_settings', 'pea_employee_audit',
];

/**
 * Connect, and confirm PEA's own schema is present.
 *
 * Runs once at boot. Pointing DATABASE_URL at the wrong or an empty database
 * then fails loudly on startup — naming the database it reached and what is
 * missing — instead of as a string of 503s on the first screen someone opens.
 * @returns {Promise<void>}
 */
export async function connectDatabase() {
  try {
    await prisma.$connect();

    const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
    const present = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename LIKE 'pea\\_%'`;
    const names = new Set(present.map((r) => r.tablename));
    const missing = CORE_TABLES.filter((t) => !names.has(t));

    if (missing.length) {
      logger.error(
        `🚨 Connected to "${db}", but PEA's schema is incomplete — missing: ${missing.join(', ')}. ` +
          'Create it with prisma/ddl/pea-dedicated-database.sql.'
      );
    }

    logger.info(`✅ Database connected: "${db}" (${names.size} PEA tables)`);
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
