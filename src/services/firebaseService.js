const admin = require('firebase-admin');
const { config } = require('../config');
const logger = require('../utils/logger');

// Initialize Firebase Admin SDK using Application Default Credentials
// On Cloud Run, this automatically uses Workload Identity
// For local development, use: gcloud auth application-default login
let firebaseApp;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    firebaseApp = admin.initializeApp({
      projectId: config.firebase.projectId,
    });

    logger.info('Firebase Admin SDK initialized', {
      projectId: config.firebase.projectId,
    });

    return firebaseApp;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK', {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Verify Firebase ID Token
 * @param {string} idToken - The Firebase ID token from the client
 * @returns {Promise<admin.auth.DecodedIdToken>} - Decoded token with user info
 */
const verifyIdToken = async (idToken) => {
  if (!firebaseApp) {
    initializeFirebase();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    return decodedToken;
  } catch (error) {
    logger.warn('Firebase token verification failed', {
      error: error.message,
      code: error.code,
    });
    throw error;
  }
};

/**
 * Get user info from Firebase Auth
 * @param {string} uid - User ID
 * @returns {Promise<admin.auth.UserRecord>}
 */
const getUser = async (uid) => {
  if (!firebaseApp) {
    initializeFirebase();
  }

  return admin.auth().getUser(uid);
};

module.exports = {
  initializeFirebase,
  verifyIdToken,
  getUser,
};
