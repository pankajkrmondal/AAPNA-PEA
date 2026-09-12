import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read env directly — this module loads before config/index.js.
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'cyan' };

winston.addColors(colors);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports = [
  new winston.transports.Console({
    format: NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'error.log'),
    level: 'error',
    format: prodFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    format: prodFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
];

/**
 * Application-wide Winston logger.
 * Levels (highest → lowest priority): error → warn → info → http → debug
 */
const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : LOG_LEVEL,
  levels,
  transports,
  exitOnError: false,
});

/** Morgan stream adapter — pipes HTTP request logs into Winston at "http" level. */
export const morganStream = {
  write: (message) => logger.http(message.trim()),
};

export default logger;
