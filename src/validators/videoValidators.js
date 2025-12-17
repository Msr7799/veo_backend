const { body, param, validationResult } = require('express-validator');
const { config } = require('../config');
const { ValidationError } = require('../utils/errors');

// Validation middleware wrapper
const validate = (validations) => {
  return async (req, res, next) => {
    for (const validation of validations) {
      const result = await validation.run(req);
      if (!result.isEmpty()) break;
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const details = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));

    next(new ValidationError('Validation failed', details));
  };
};

// Common video parameter validations
const commonVideoValidations = [
  body('prompt')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Prompt is required')
    .isLength({ max: config.veo.limits.maxPromptLength })
    .withMessage(`Prompt must not exceed ${config.veo.limits.maxPromptLength} characters`),

  body('durationSeconds')
    .optional()
    .isInt({ min: config.veo.limits.minDurationSeconds, max: config.veo.limits.maxDurationSeconds })
    .withMessage(`Duration must be between ${config.veo.limits.minDurationSeconds} and ${config.veo.limits.maxDurationSeconds} seconds`)
    .toInt(),

  body('aspectRatio')
    .optional()
    .isIn(config.veo.limits.allowedAspectRatios)
    .withMessage(`Aspect ratio must be one of: ${config.veo.limits.allowedAspectRatios.join(', ')}`),

  body('fps')
    .optional()
    .isIn(config.veo.limits.allowedFps)
    .withMessage(`FPS must be one of: ${config.veo.limits.allowedFps.join(', ')}`)
    .toInt(),

  body('cameraStyle')
    .optional()
    .isIn(['cinematic', 'handheld', 'documentary'])
    .withMessage('Camera style must be: cinematic, handheld, or documentary'),

  body('motionLevel')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Motion level must be: low, medium, or high'),

  body('lighting')
    .optional()
    .isIn(['natural', 'dramatic', 'soft'])
    .withMessage('Lighting must be: natural, dramatic, or soft'),

  body('quality')
    .optional()
    .isIn(['standard', 'high'])
    .withMessage('Quality must be: standard or high'),

  body('seed')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Seed must be a non-negative integer')
    .toInt(),

  body('negativePrompt')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Negative prompt must not exceed 500 characters'),

  body('generateAudio')
    .optional()
    .isBoolean()
    .withMessage('generateAudio must be a boolean')
    .toBoolean(),
];

// Text-to-video validations
const textToVideoValidations = validate(commonVideoValidations);

// Image-to-video validations
const imageToVideoValidations = validate([
  ...commonVideoValidations,

  body('imageBase64')
    .isString()
    .notEmpty()
    .withMessage('Base64 encoded image is required')
    .isLength({ max: 10 * 1024 * 1024 }) // ~7.5MB image max
    .withMessage('Image data too large (max ~7.5MB)'),

  body('imageMimeType')
    .optional()
    .isIn(['image/png', 'image/jpeg', 'image/webp'])
    .withMessage('Image MIME type must be: image/png, image/jpeg, or image/webp'),
]);

// Video-to-video validations
const videoToVideoValidations = validate([
  ...commonVideoValidations,

  body('videoBase64')
    .isString()
    .notEmpty()
    .withMessage('Base64 encoded video is required'),

  body('videoMimeType')
    .optional()
    .isIn(['video/mp4', 'video/webm'])
    .withMessage('Video MIME type must be: video/mp4 or video/webm'),
]);

// Job ID validation
const jobIdValidation = validate([
  param('jobId')
    .isUUID(4)
    .withMessage('Invalid job ID format'),
]);

module.exports = {
  textToVideoValidations,
  imageToVideoValidations,
  videoToVideoValidations,
  jobIdValidation,
  validate,
};
