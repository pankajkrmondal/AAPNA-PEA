import http from 'http';
import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

const server = http.createServer(app);

async function startServer() {
  try {
    await connectDatabase();

    server.listen(config.port, () => {
      logger.info(`🚀 PEA Backend listening on port ${config.port} [${config.env}]`);
      logger.info(`   Health check: http://localhost:${config.port}/api/health`);

      // Two settings that silently mean "nobody receives anything". Print them
      // at boot so a misconfigured environment is obvious immediately rather
      // than after a sweep quietly sends zero emails.
      if (config.email.redirectInNonProd) {
        logger.warn(
          `📧 Non-prod email guard ACTIVE — all mail redirected to: ${
            config.email.testRecipients.join(', ') || '(none configured!)'
          }`
        );
      }
      if (!config.scheduler.enabled) {
        logger.warn('⏰ Scheduler DISABLED (PEA_SCHEDULER_ENABLED=false) — no evaluations will be sent');
      }
    });
  } catch (error) {
    logger.error('💥 Failed to start server', { error: error.message });
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(signal) {
  logger.info(`\n${signal} received — shutting down gracefully…`);

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await disconnectDatabase();
      logger.info('All connections closed. Goodbye 👋');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION 💥', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION 💥', { reason: reason?.message || reason });
  process.exit(1);
});

startServer();
