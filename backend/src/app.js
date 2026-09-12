import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

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

app.use(helmet());
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
