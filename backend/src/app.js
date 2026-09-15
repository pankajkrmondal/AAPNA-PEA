import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import crypto from 'crypto';

import config from './config/index.js';
import { morganStream } from './config/logger.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { bigIntSafe } from './utils/apiResponse.js';

const app = express();

// Every `id` in this schema is BIGSERIAL, so Prisma hands back BigInt — which
// JSON.stringify throws on. Registering the replacer here means no controller
// has to remember to convert.
app.set('json replacer', bigIntSafe);

// Behind nginx in staging/production: needed for correct client IPs in the
// rate limiter and in pea_evaluation_cycles.submitted_ip.
app.set('trust proxy', 1);

// A per-request nonce for the server-rendered evaluation form. That page ships
// its own <style> and one small <script>, and helmet's default CSP blocks
// inline content — so rather than weaken the policy with 'unsafe-inline' for
// scripts, each response gets a nonce the page echoes back. This page is
// public and unauthenticated, which is exactly where a strict CSP earns its
// keep.
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
        // Styles are inline in the form's <style> block and contain nothing
        // user-controlled; script injection is the risk worth being strict about.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https://www.aapnainfotech.com'],
        // The form posts to this origin only.
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
  })
);

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.isProduction ? 'combined' : 'dev', { stream: morganStream }));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
