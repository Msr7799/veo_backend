require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { config, validateConfig } = require('./config');
const { firebaseAuth } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/healthRoutes');
const logger = require('./utils/logger');
const { initializeFirebase } = require('./services/firebaseService');

let videoRoutes;
let veoService;
let quotaService;

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration validation failed', { error: error.message });
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
  initializeFirebase();
} catch (error) {
  logger.error('Firebase initialization failed', { error: error.message });
  process.exit(1);
}

// Require modules that depend on validated config/env
videoRoutes = require('./routes/videoRoutes');
youtubeRoutes = require('./routes/youtubeRoutes');
veoService = require('./services/veoService');
({ quotaService } = require('./services/quotaService'));

const app = express();

// Trust proxy for Cloud Run
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration for Android app
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// Body parsing
app.use(express.json({
  limit: '50mb', // Allow large payloads for image/video data
}));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('Request processed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip,
      uid: req.user?.uid,
    });
  });
  next();
});

// Health routes (no auth required)
app.use('/v1/health', healthRoutes);

// Apply Firebase authentication to video routes
// Rate limiting is applied after auth so we can use user UID
app.use('/v1/video', firebaseAuth);
app.use('/v1/video', rateLimiter);

// Video routes (protected by Firebase auth)
app.use('/v1/video', videoRoutes);

// YouTube OAuth routes (protected by Firebase auth)
app.use('/v1/youtube', firebaseAuth);
app.use('/v1/youtube', youtubeRoutes);

// YouTube OAuth callback (no auth required - handles OAuth flow)
app.use('/oauth/youtube', youtubeRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'Veo Video Generation API',
      version: '1.0.0',
      documentation: '/v1/video/modes',
      health: '/v1/health',
    },
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Periodic cleanup of old jobs and quota entries (every hour)
if (process.env.ENABLE_PERIODIC_CLEANUP === 'true') {
  setInterval(() => {
    veoService.cleanupOldJobs();
    quotaService.cleanupOldEntries();
    logger.info('Cleaned up old jobs and quota entries');
  }, 60 * 60 * 1000);
}

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Server started', {
    port: PORT,
    environment: config.nodeEnv,
    region: config.gcp.region,
    projectId: config.gcp.projectId,
    veoModel: config.veo.modelId,
  });
});

module.exports = app;
