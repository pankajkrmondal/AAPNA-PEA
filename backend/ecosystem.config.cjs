/**
 * PM2 ecosystem config for the PEA backend.
 *
 * Mirrors the ATS layout (backend/ecosystem.config.cjs) so the same deploy
 * muscle memory applies. PEA has no worker process — Phase 1 has no queue.
 *
 * The app loads `.env.<NODE_ENV>` itself (src/config/index.js), so PM2 only
 * needs to set NODE_ENV and point `cwd` at the right deploy directory.
 *
 * NOTE: .cjs because the package is "type": "module".
 *
 * ⚠️ PORTS. 5000 and 5001 are already taken on this server by ATS staging and
 * ATS production. PEA uses 5002 and 5003 — see .env.staging / .env.production.
 * Starting on 5000 or 5001 fails with EADDRINUSE.
 *
 * Usage:
 *   Local      : pm2 start ecosystem.config.cjs --only pea-local-backend
 *   Staging    : pm2 start ecosystem.config.cjs --only pea-staging-backend
 *   Production : pm2 start ecosystem.config.cjs --only pea-prod-backend
 *
 *   pm2 save              # persist across reboots
 *   pm2 logs pea-staging-backend
 *   pm2 reload pea-staging-backend
 */

const PATHS = {
  development: __dirname,
  staging: '/var/www/html/pea-platform-staging/backend',
  production: '/var/www/html/pea-platform-production/backend',
};

const common = {
  script: 'src/server.js',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_memory_restart: '400M',
  // Restart-loop protection: 10 crashes inside min_uptime and PM2 gives up
  // rather than thrashing.
  min_uptime: '10s',
  max_restarts: 10,
  time: true,
};

function backend(env, nodeEnv) {
  return {
    ...common,
    name: `pea-${env}-backend`,
    cwd: PATHS[nodeEnv],
    env: { NODE_ENV: nodeEnv },
    error_file: `logs/pm2-${env}-backend-error.log`,
    out_file: `logs/pm2-${env}-backend-out.log`,
  };
}

module.exports = {
  apps: [
    backend('local', 'development'),
    backend('staging', 'staging'),
    backend('prod', 'production'),
  ],
};
