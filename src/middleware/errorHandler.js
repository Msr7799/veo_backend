const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  // Default error values
  let statusCode = 500;
  let response = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  };

  // Handle operational errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    response.error = {
      code: err.code,
      message: err.message,
    };

    // Include validation details if present
    if (err.details && err.details.length > 0) {
      response.error.details = err.details;
    }
  }

  // Log error details
  logger.error('Error occurred', {
    statusCode,
    code: response.error.code,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    response.error.message = 'An unexpected error occurred';
  }

  res.status(statusCode).json(response);
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
};

module.exports = { errorHandler, notFoundHandler };
