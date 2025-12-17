const express = require('express');
const { config } = require('../config');

const router = express.Router();

/**
 * GET /v1/health
 * Health check endpoint for Cloud Run
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      region: config.gcp.region,
    },
  });
});

/**
 * GET /v1/health/ready
 * Readiness probe for Cloud Run
 */
router.get('/ready', (req, res) => {
  // Check if required configurations are present
  const isReady =
    config.gcp.projectId &&
    config.gcs.bucketName;

  if (isReady) {
    res.json({
      success: true,
      data: {
        ready: true,
        timestamp: new Date().toISOString(),
      },
    });
  } else {
    res.status(503).json({
      success: false,
      error: {
        code: 'NOT_READY',
        message: 'Service is not ready',
      },
    });
  }
});

/**
 * GET /v1/health/live
 * Liveness probe for Cloud Run
 */
router.get('/live', (req, res) => {
  res.json({
    success: true,
    data: {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

module.exports = router;
