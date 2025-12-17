const { verifyIdToken } = require('../services/firebaseService');
const { AuthenticationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Firebase Authentication Middleware
 * Verifies Firebase ID Token from Authorization header
 * Attaches decoded user info to req.user
 */
const firebaseAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn('Request missing Authorization header', {
      ip: req.ip,
      path: req.path,
    });
    return next(new AuthenticationError('Authorization header is required'));
  }

  // Expect: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logger.warn('Invalid Authorization header format', {
      ip: req.ip,
      path: req.path,
    });
    return next(new AuthenticationError('Invalid Authorization header format. Expected: Bearer <token>'));
  }

  const idToken = parts[1];

  try {
    // Verify the Firebase ID token
    const decodedToken = await verifyIdToken(idToken);

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      authTime: decodedToken.auth_time,
    };

    logger.debug('User authenticated', {
      uid: req.user.uid,
      email: req.user.email,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.warn('Firebase token verification failed', {
      ip: req.ip,
      path: req.path,
      error: error.message,
      code: error.code,
    });

    // Provide specific error messages based on Firebase error codes
    if (error.code === 'auth/id-token-expired') {
      return next(new AuthenticationError('Token has expired. Please sign in again.'));
    }
    if (error.code === 'auth/id-token-revoked') {
      return next(new AuthenticationError('Token has been revoked. Please sign in again.'));
    }
    if (error.code === 'auth/argument-error') {
      return next(new AuthenticationError('Invalid token format.'));
    }

    return next(new AuthenticationError('Invalid or expired authentication token.'));
  }
};

module.exports = { firebaseAuth };
