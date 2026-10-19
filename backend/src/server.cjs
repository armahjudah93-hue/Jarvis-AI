const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { analyzeFile } = require('./tools.cjs');
const { routeCommand } = require('./orchestrator.cjs');

const ROOT_DIRECTORY = path.resolve(__dirname, '../..');
const DEFAULT_ALLOWED_ORIGINS = ['http://127.0.0.1:8787', 'http://localhost:8787', 'https://armahjudah93-hue.github.io'];

function loadConfig(overrides = {}) {
  const envFile = overrides.envFile || process.env.JARVIS_ENV_FILE || path.join(__dirname, '..', '.env');
  dotenv.config({ path: envFile, quiet: true });
  const allowedOrigins = (overrides.allowedOrigins || process.env.JARVIS_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return {
    allowedOrigins,
    allowLocalFallback: String(overrides.allowLocalFallback ?? process.env.JARVIS_ALLOW_LOCAL_FALLBACK ?? 'true').toLowerCase() === 'true',
    openaiApiKey: overrides.openaiApiKey || process.env.OPENAI_API_KEY || '',
    openaiModel: overrides.openaiModel || process.env.OPENAI_MODEL || 'gpt-4.1-mini'
  };
}

function buildCorsOptions(config) {
  return {
    origin(origin, callback) {
      // Same-origin desktop requests and non-browser API clients don't send Origin.
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('This origin is not allowed to call the JARVIS backend.'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600
  };
}

function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

function validateChatBody(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 2000) {
    const error = new Error('A command must contain between 1 and 2,000 characters.');
    error.code = 'invalid_message';
    error.status = 400;
    throw error;
  }
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  return { message, history };
}

function logEvent(type, req, details = {}) {
  // Do not log messages, file contents, or API credentials.
  console.info(JSON.stringify({ at: new Date().toISOString(), requestId: req.requestId, type, ...details }));
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const app = express();
  const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors(buildCorsOptions(config)));
  app.use(requestId);
  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' } }
  }));
  app.use(express.json({ limit: '256kb', type: 'application/json' }));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'jarvis-backend',
      aiConfigured: Boolean(config.openaiApiKey),
      localFallback: config.allowLocalFallback,
      tools: ['get_time', 'create_timer', 'calculate', 'search_web', 'analyze_file']
    });
  });

  app.post('/api/chat', async (req, res, next) => {
    try {
      const { message, history } = validateChatBody(req.body);
      const result = await routeCommand({ message, history, config });
      logEvent('command', req, { status: result.status, action: result.action?.name || null, orchestrator: result.orchestrator });
      res.status(result.status === 'unavailable' ? 503 : 200).json({ requestId: req.requestId, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/files/analyze', uploads.single('file'), async (req, res, next) => {
    try {
      const result = analyzeFile(req.file);
      logEvent('file_analysis', req, { extension: result.extension, bytes: result.bytes, kind: result.kind });
      res.json({
        requestId: req.requestId,
        status: 'completed',
        message: `${result.fileName} was analyzed locally.`,
        action: { name: 'analyze_file', risk: 'low', result }
      });
    } catch (error) {
      next(error);
    }
  });

  // Serve only the app shell assets. Never expose the project directory, .env files,
  // package metadata, or backend source through the desktop HTTP server.
  const publicFiles = new Map([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/styles.css', 'styles.css'],
    ['/api.js', 'api.js'],
    ['/app.js', 'app.js']
  ]);
  app.get([...publicFiles.keys()], (req, res) => res.sendFile(path.join(ROOT_DIRECTORY, publicFiles.get(req.path))));

  app.use((error, req, res, next) => {
    const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    const code = error.code || (error instanceof multer.MulterError ? 'upload_error' : 'request_failed');
    const message = error.expose || status < 500
      ? error.message
      : 'JARVIS could not complete that request. No action was taken.';
    if (status >= 500) console.error(error);
    else logEvent('request_error', req, { code, status });
    res.status(status).json({ requestId: req.requestId, error: { code, message } });
  });

  return { app, config };
}

function startJarvisServer({ port = Number(process.env.PORT || 8787), host = '127.0.0.1', ...overrides } = {}) {
  const { app, config } = createApp(overrides);
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ app, config, server, host, port: address.port, url: `http://${host}:${address.port}` });
    });
  });
}

if (require.main === module) {
  startJarvisServer().then(({ url, config }) => {
    console.log(`JARVIS backend listening at ${url} (AI ${config.openaiApiKey ? 'configured' : 'not configured'}).`);
  }).catch(error => {
    console.error('Unable to start JARVIS backend:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp, loadConfig, startJarvisServer };
