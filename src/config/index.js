const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Google Cloud
  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    region: process.env.GCP_REGION || 'us-central1',
  },

  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID,
  },

  // Veo Model
  veo: {
    modelId: process.env.VEO_MODEL_ID || 'veo-3.0-generate-preview',
    supportedModes: {
      TEXT_TO_VIDEO: true,
      IMAGE_TO_VIDEO: process.env.VEO_ENABLE_IMAGE_TO_VIDEO === 'true',
      VIDEO_TO_VIDEO: false, // Not currently supported by Veo 3
    },
    forwardParams: {
      // Keep this allowlist minimal by default; enable more only after confirming model schema.
      fps: process.env.VEO_FORWARD_FPS === 'true',
      seed: process.env.VEO_FORWARD_SEED !== 'false',
      negativePrompt: process.env.VEO_FORWARD_NEGATIVE_PROMPT !== 'false',
      generateAudio: process.env.VEO_FORWARD_GENERATE_AUDIO === 'true',
      resolution: process.env.VEO_FORWARD_RESOLUTION === 'true',
    },
    defaults: {
      durationSeconds: 5,
      aspectRatio: '16:9',
      fps: 24,
      quality: 'standard',
    },
    limits: {
      maxDurationSeconds: 8,
      minDurationSeconds: 4,
      allowedDurations: [4, 6, 8],
      allowedAspectRatios: ['16:9', '9:16', '1:1'],
      allowedFps: [24, 30],
      maxPromptLength: 2000,
    },
  },

  // Google Cloud Storage (temporary storage for generated videos)
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME,
    signedUrlExpiration: 3600, // 1 hour - client downloads then uploads to their storage
  },

  // YouTube OAuth (for public video uploads) - OPTIONAL
  youtube: {
    enabled: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URI),
    clientId: process.env.YOUTUBE_CLIENT_ID || null,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || null,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || null,
    scopes: ['https://www.googleapis.com/auth/youtube.upload']
  },

  // Rate Limiting (per user)
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // User Quota
  quota: {
    dailyVideoGenerations: parseInt(process.env.USER_DAILY_QUOTA, 10) || 50,
  },
};

const validateConfig = () => {
  const required = ['GCP_PROJECT_ID', 'GCS_BUCKET_NAME'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

module.exports = { config, validateConfig };
