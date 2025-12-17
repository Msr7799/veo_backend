const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const logger = require('../utils/logger');

/**
 * General rate limiter - uses authenticated user UID
 * Applied after Firebase auth middleware
 */
const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      uid: req.user?.uid,
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json(options.message);
  },
  keyGenerator: (req) => {
    // Use authenticated user UID for rate limiting
    // Falls back to IP only for unauthenticated routes (health checks)
    return req.user?.uid || req.ip;
  },
});

/**
 * Stricter rate limit for video generation endpoints
 * Uses authenticated user UID
 */
const videoGenerationLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 10, // 10 video generations per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Video generation rate limit exceeded. Please wait before submitting more requests.',
    },
  },
  handler: (req, res, next, options) => {
    logger.warn('Video generation rate limit exceeded', {
      uid: req.user?.uid,
      ip: req.ip,
    });
    res.status(429).json(options.message);
  },
  keyGenerator: (req) => {
    // Must have authenticated user for video generation
    return req.user?.uid || req.ip;
  },
});

module.exports = { rateLimiter, videoGenerationLimiter };
