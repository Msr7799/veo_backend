const express = require('express');
const veoService = require('../services/veoService');
const { quotaService } = require('../services/quotaService');
const { videoGenerationLimiter } = require('../middleware/rateLimiter');
const {
  textToVideoValidations,
  imageToVideoValidations,
  videoToVideoValidations,
  jobIdValidation,
} = require('../validators/videoValidators');
const { NotFoundError, UnsupportedModeError } = require('../utils/errors');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /v1/video/text
 * Generate video from text prompt
 * Requires Firebase authentication
 */
router.post(
  '/text',
  videoGenerationLimiter,
  textToVideoValidations,
  async (req, res, next) => {
    try {
      const user = req.user; // From Firebase auth middleware

      // Check and consume quota
      const quotaUsage = quotaService.consumeQuota(user.uid);

      const params = {
        prompt: req.body.prompt,
        durationSeconds: req.body.durationSeconds,
        aspectRatio: req.body.aspectRatio,
        fps: req.body.fps,
        cameraStyle: req.body.cameraStyle,
        motionLevel: req.body.motionLevel,
        lighting: req.body.lighting,
        quality: req.body.quality,
        seed: req.body.seed,
        negativePrompt: req.body.negativePrompt,
        generateAudio: req.body.generateAudio,
      };

      logger.info('Text-to-video request received', {
        uid: user.uid,
        prompt: params.prompt.substring(0, 100),
        aspectRatio: params.aspectRatio,
        duration: params.durationSeconds,
      });

      const result = await veoService.generateFromText(params, user);

      res.status(202).json({
        success: true,
        data: {
          jobId: result.jobId,
          status: 'PENDING',
          mode: 'TEXT_TO_VIDEO',
          message: 'Video generation started. Poll /v1/video/status/:jobId for updates.',
          quota: quotaUsage,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/video/image
 * Generate video from image
 * Requires Firebase authentication
 */
router.post(
  '/image',
  videoGenerationLimiter,
  imageToVideoValidations,
  async (req, res, next) => {
    try {
      const user = req.user; // From Firebase auth middleware

      if (!veoService.isModeSupported('IMAGE_TO_VIDEO')) {
        throw new UnsupportedModeError('IMAGE_TO_VIDEO');
      }

      // Check and consume quota
      const quotaUsage = quotaService.consumeQuota(user.uid);

      const params = {
        prompt: req.body.prompt,
        imageBase64: req.body.imageBase64,
        imageMimeType: req.body.imageMimeType,
        durationSeconds: req.body.durationSeconds,
        aspectRatio: req.body.aspectRatio,
        fps: req.body.fps,
        cameraStyle: req.body.cameraStyle,
        motionLevel: req.body.motionLevel,
        lighting: req.body.lighting,
        quality: req.body.quality,
        seed: req.body.seed,
        negativePrompt: req.body.negativePrompt,
        generateAudio: req.body.generateAudio,
      };

      logger.info('Image-to-video request received', {
        uid: user.uid,
        prompt: params.prompt.substring(0, 100),
        imageMimeType: params.imageMimeType,
      });

      const result = await veoService.generateFromImage(params, user);

      res.status(202).json({
        success: true,
        data: {
          jobId: result.jobId,
          status: 'PENDING',
          mode: 'IMAGE_TO_VIDEO',
          message: 'Video generation started. Poll /v1/video/status/:jobId for updates.',
          quota: quotaUsage,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/video/video
 * Generate video from video (currently not supported by Veo 3)
 * Requires Firebase authentication
 */
router.post(
  '/video',
  videoGenerationLimiter,
  videoToVideoValidations,
  async (req, res, next) => {
    try {
      const user = req.user; // From Firebase auth middleware

      const params = {
        prompt: req.body.prompt,
        videoBase64: req.body.videoBase64,
        videoMimeType: req.body.videoMimeType,
        durationSeconds: req.body.durationSeconds,
        aspectRatio: req.body.aspectRatio,
        fps: req.body.fps,
        cameraStyle: req.body.cameraStyle,
        motionLevel: req.body.motionLevel,
        lighting: req.body.lighting,
        quality: req.body.quality,
        seed: req.body.seed,
        negativePrompt: req.body.negativePrompt,
        generateAudio: req.body.generateAudio,
      };

      logger.info('Video-to-video request received', {
        uid: user.uid,
        prompt: params.prompt.substring(0, 100),
      });

      const result = await veoService.generateFromVideo(params, user);

      res.status(202).json({
        success: true,
        data: {
          jobId: result.jobId,
          status: 'PENDING',
          mode: 'VIDEO_TO_VIDEO',
          message: 'Video generation started. Poll /v1/video/status/:jobId for updates.',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /v1/video/status/:jobId
 * Get video generation job status
 * Requires Firebase authentication - users can only access their own jobs
 */
router.get('/status/:jobId', jobIdValidation, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const user = req.user; // From Firebase auth middleware

    // Get job with user ownership verification
    const job = veoService.getJobStatus(jobId, user.uid);

    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found`);
    }

    const response = {
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        mode: job.mode,
        createdAt: job.createdAt,
      },
    };

    // Include result details if completed
    // Client will use signedUrl to download, then upload to their own storage
    if (job.status === 'COMPLETED' && job.result) {
      response.data.result = {
        videoUri: job.result.videoUri,
        signedUrl: job.result.signedUrl,
        expiresAt: job.result.expiresAt,
      };
      response.data.completedAt = job.completedAt;
    }

    // Include error if failed
    if (job.status === 'FAILED') {
      response.data.error = job.error;
      response.data.completedAt = job.completedAt;
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /v1/video/modes
 * Get supported video generation modes
 */
router.get('/modes', (req, res) => {
  const { config } = require('../config');

  res.json({
    success: true,
    data: {
      supportedModes: Object.entries(config.veo.supportedModes)
        .filter(([, enabled]) => enabled)
        .map(([mode]) => mode),
      parameters: {
        durationSeconds: {
          allowed: config.veo.limits.allowedDurations,
          default: config.veo.defaults.durationSeconds,
        },
        aspectRatio: {
          allowed: config.veo.limits.allowedAspectRatios,
          default: config.veo.defaults.aspectRatio,
        },
        fps: {
          allowed: config.veo.limits.allowedFps,
          default: config.veo.defaults.fps,
        },
        cameraStyle: {
          allowed: ['cinematic', 'handheld', 'documentary'],
        },
        motionLevel: {
          allowed: ['low', 'medium', 'high'],
        },
        lighting: {
          allowed: ['natural', 'dramatic', 'soft'],
        },
        quality: {
          allowed: ['standard', 'high'],
          default: config.veo.defaults.quality,
        },
      },
    },
  });
});

module.exports = router;
