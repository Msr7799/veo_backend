const { v1 } = require('@google-cloud/aiplatform');
const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config');
const logger = require('../utils/logger');
const { VeoApiError, UnsupportedModeError } = require('../utils/errors');

// Initialize clients using Application Default Credentials
const predictionServiceClient = new v1.PredictionServiceClient({
  apiEndpoint: `${config.gcp.region}-aiplatform.googleapis.com`,
});

const storage = new Storage();

// In-memory job store (replace with Redis/Firestore for production)
const jobStore = new Map();

class VeoService {
  constructor() {
    this.projectId = config.gcp.projectId;
    this.region = config.gcp.region;
    this.modelId = config.veo.modelId;
    this.bucket = storage.bucket(config.gcs.bucketName);
  }

  /**
   * Check if a video generation mode is supported
   */
  isModeSupported(mode) {
    return config.veo.supportedModes[mode] === true;
  }

  /**
   * Get the endpoint path for Veo model
   */
  getEndpoint() {
    return `projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.modelId}`;
  }

  /**
   * Build prompt with style parameters
   */
  buildEnhancedPrompt(params) {
    const parts = [params.prompt];

    if (params.cameraStyle) {
      parts.push(`Camera style: ${params.cameraStyle}`);
    }
    if (params.motionLevel) {
      parts.push(`Motion: ${params.motionLevel}`);
    }
    if (params.lighting) {
      parts.push(`Lighting: ${params.lighting}`);
    }

    return parts.join('. ');
  }

  /**
   * Build Veo API request parameters
   */
  buildRequestParameters(params) {
    const parameters = {
      aspectRatio: params.aspectRatio || config.veo.defaults.aspectRatio,
      durationSeconds: this.normalizeDuration(params.durationSeconds),
    };

    // Only forward parameters that are confirmed supported / explicitly enabled
    if (config.veo.forwardParams.fps && params.fps) {
      parameters.fps = params.fps;
    }

    if (config.veo.forwardParams.negativePrompt && params.negativePrompt) {
      parameters.negativePrompt = params.negativePrompt;
    }

    if (config.veo.forwardParams.seed && params.seed !== undefined && params.seed !== null) {
      parameters.seed = params.seed;
    }

    if (config.veo.forwardParams.generateAudio && params.generateAudio !== undefined) {
      parameters.generateAudio = params.generateAudio;
    }

    if (config.veo.forwardParams.resolution && params.quality === 'high') {
      parameters.resolution = '1080p';
    }

    return parameters;
  }

  /**
   * Normalize duration to allowed values (4, 6, or 8 seconds)
   */
  normalizeDuration(duration) {
    const requested = duration || config.veo.defaults.durationSeconds;
    const allowed = config.veo.limits.allowedDurations;

    // Find closest allowed duration
    return allowed.reduce((prev, curr) =>
      Math.abs(curr - requested) < Math.abs(prev - requested) ? curr : prev
    );
  }

  /**
   * Generate video from text prompt
   * @param {Object} params - Generation parameters
   * @param {Object} user - Authenticated user info (uid, email)
   */
  async generateFromText(params, user) {
    if (!this.isModeSupported('TEXT_TO_VIDEO')) {
      throw new UnsupportedModeError('TEXT_TO_VIDEO');
    }

    const jobId = uuidv4();

    // Store initial job status with user info
    this.updateJobStatus(jobId, {
      status: 'PENDING',
      mode: 'TEXT_TO_VIDEO',
      createdAt: new Date().toISOString(),
      userId: user.uid,
      userEmail: user.email,
      params: { prompt: params.prompt },
    });

    // Start async generation
    this.executeGeneration(jobId, params, 'TEXT_TO_VIDEO').catch((error) => {
      logger.error('Text-to-video generation failed', { jobId, userId: user.uid, error: error.message });
      this.updateJobStatus(jobId, {
        status: 'FAILED',
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    });

    return { jobId };
  }

  /**
   * Generate video from image
   * @param {Object} params - Generation parameters
   * @param {Object} user - Authenticated user info (uid, email)
   */
  async generateFromImage(params, user) {
    if (!this.isModeSupported('IMAGE_TO_VIDEO')) {
      throw new UnsupportedModeError('IMAGE_TO_VIDEO');
    }

    const jobId = uuidv4();

    // Store initial job status with user info
    this.updateJobStatus(jobId, {
      status: 'PENDING',
      mode: 'IMAGE_TO_VIDEO',
      createdAt: new Date().toISOString(),
      userId: user.uid,
      userEmail: user.email,
      params: { prompt: params.prompt, hasImage: true },
    });

    // Start async generation
    this.executeImageGeneration(jobId, params).catch((error) => {
      logger.error('Image-to-video generation failed', { jobId, userId: user.uid, error: error.message });
      this.updateJobStatus(jobId, {
        status: 'FAILED',
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    });

    return { jobId };
  }

  /**
   * Generate video from video (currently not supported)
   * @param {Object} params - Generation parameters
   * @param {Object} user - Authenticated user info (uid, email)
   */
  async generateFromVideo(params, user) {
    if (!this.isModeSupported('VIDEO_TO_VIDEO')) {
      throw new UnsupportedModeError('VIDEO_TO_VIDEO');
    }

    // Implementation would go here when Veo supports this mode
    throw new UnsupportedModeError('VIDEO_TO_VIDEO');
  }

  /**
   * Execute the actual video generation
   */
  async executeGeneration(jobId, params, mode) {
    try {
      this.updateJobStatus(jobId, { status: 'PROCESSING' });

      const endpoint = this.getEndpoint();
      const prompt = this.buildEnhancedPrompt(params);
      const requestParameters = this.buildRequestParameters(params);

      logger.info('Starting Veo generation', {
        jobId,
        mode,
        endpoint,
        aspectRatio: requestParameters.aspectRatio,
        duration: requestParameters.durationSeconds,
      });

      // Make the prediction request
      const [response] = await predictionServiceClient.predict({
        endpoint,
        instances: [{ prompt }],
        parameters: this.structToValue(requestParameters),
      });

      // Process response
      const result = await this.processGenerationResponse(jobId, response);

      this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        result,
        completedAt: new Date().toISOString(),
      });

      logger.info('Veo generation completed', { jobId, mode });
    } catch (error) {
      logger.error('Veo API error', {
        jobId,
        error: error.message,
        code: error.code,
      });
      throw new VeoApiError(error.message, error);
    }
  }

  /**
   * Execute image-to-video generation
   */
  async executeImageGeneration(jobId, params) {
    try {
      this.updateJobStatus(jobId, { status: 'PROCESSING' });

      const endpoint = this.getEndpoint();
      const prompt = this.buildEnhancedPrompt(params);
      const requestParameters = this.buildRequestParameters(params);

      logger.info('Starting Veo image-to-video generation', { jobId });

      // Build instance with image
      const instance = {
        prompt,
        image: {
          bytesBase64Encoded: params.imageBase64,
          mimeType: params.imageMimeType || 'image/png',
        },
      };

      const [response] = await predictionServiceClient.predict({
        endpoint,
        instances: [instance],
        parameters: this.structToValue(requestParameters),
      });

      const result = await this.processGenerationResponse(jobId, response);

      this.updateJobStatus(jobId, {
        status: 'COMPLETED',
        result,
        completedAt: new Date().toISOString(),
      });

      logger.info('Veo image-to-video generation completed', { jobId });
    } catch (error) {
      logger.error('Veo image-to-video API error', {
        jobId,
        error: error.message,
      });
      throw new VeoApiError(error.message, error);
    }
  }

  /**
   * Process the generation response and store video
   */
  async processGenerationResponse(jobId, response) {
    if (!response.predictions || response.predictions.length === 0) {
      throw new VeoApiError('No video generated in response');
    }

    const prediction = response.predictions[0];

    // If response contains video bytes, upload to GCS
    if (prediction.bytesBase64Encoded) {
      const videoBuffer = Buffer.from(prediction.bytesBase64Encoded, 'base64');
      const fileName = `videos/${jobId}.mp4`;
      const file = this.bucket.file(fileName);

      await file.save(videoBuffer, {
        metadata: {
          contentType: 'video/mp4',
          metadata: {
            jobId,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // Generate signed URL
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + config.gcs.signedUrlExpiration * 1000,
      });

      return {
        videoUri: `gs://${config.gcs.bucketName}/${fileName}`,
        signedUrl,
        expiresAt: new Date(Date.now() + config.gcs.signedUrlExpiration * 1000).toISOString(),
      };
    }

    // If response contains a GCS URI directly
    if (prediction.gcsUri) {
      return {
        videoUri: prediction.gcsUri,
        signedUrl: await this.generateSignedUrl(prediction.gcsUri),
        expiresAt: new Date(Date.now() + config.gcs.signedUrlExpiration * 1000).toISOString(),
      };
    }

    throw new VeoApiError('Unexpected response format from Veo API');
  }

  /**
   * Generate a signed URL for a GCS URI
   */
  async generateSignedUrl(gcsUri) {
    const match = gcsUri.match(/gs:\/\/([^/]+)\/(.+)/);
    if (!match) {
      throw new VeoApiError('Invalid GCS URI format');
    }

    const [, bucketName, filePath] = match;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + config.gcs.signedUrlExpiration * 1000,
    });

    return signedUrl;
  }

  /**
   * Convert parameters object to Vertex AI struct format
   */
  structToValue(obj) {
    const convertValue = (value) => {
      if (value === null || value === undefined) {
        return { nullValue: 0 };
      }
      if (typeof value === 'boolean') {
        return { boolValue: value };
      }
      if (typeof value === 'number') {
        return { numberValue: value };
      }
      if (typeof value === 'string') {
        return { stringValue: value };
      }
      if (Array.isArray(value)) {
        return { listValue: { values: value.map(convertValue) } };
      }
      if (typeof value === 'object') {
        return {
          structValue: {
            fields: Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, convertValue(v)])
            ),
          },
        };
      }
      return { stringValue: String(value) };
    };

    return {
      structValue: {
        fields: Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, convertValue(v)])
        ),
      },
    };
  }

  /**
   * Update job status in store
   */
  updateJobStatus(jobId, updates) {
    const existing = jobStore.get(jobId) || {};
    jobStore.set(jobId, { ...existing, ...updates, jobId });
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @param {string} userId - User ID to verify ownership
   */
  getJobStatus(jobId, userId = null) {
    const job = jobStore.get(jobId);
    if (!job) return null;

    // If userId provided, verify ownership
    if (userId && job.userId !== userId) {
      return null; // Don't reveal job exists to non-owner
    }

    return job;
  }

  /**
   * Clean up old jobs (call periodically)
   */
  cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [jobId, job] of jobStore.entries()) {
      const createdAt = new Date(job.createdAt).getTime();
      if (now - createdAt > maxAgeMs) {
        jobStore.delete(jobId);
      }
    }
  }
}

module.exports = new VeoService();
