const { config } = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

// In-memory quota store (replace with Redis/Firestore for production)
// Structure: { [uid]: { date: 'YYYY-MM-DD', count: number } }
const quotaStore = new Map();

class QuotaService {
  /**
   * Get current date string for quota tracking
   */
  getCurrentDateKey() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Get user's quota usage for today
   * @param {string} uid - User ID
   * @returns {{ used: number, limit: number, remaining: number }}
   */
  getQuotaUsage(uid) {
    const today = this.getCurrentDateKey();
    const userQuota = quotaStore.get(uid);
    const limit = config.quota.dailyVideoGenerations;

    if (!userQuota || userQuota.date !== today) {
      return { used: 0, limit, remaining: limit };
    }

    return {
      used: userQuota.count,
      limit,
      remaining: Math.max(0, limit - userQuota.count),
    };
  }

  /**
   * Check if user has quota available
   * @param {string} uid - User ID
   * @returns {boolean}
   */
  hasQuotaAvailable(uid) {
    const usage = this.getQuotaUsage(uid);
    return usage.remaining > 0;
  }

  /**
   * Consume one quota unit for a user
   * @param {string} uid - User ID
   * @throws {AppError} If quota exceeded
   */
  consumeQuota(uid) {
    const today = this.getCurrentDateKey();
    const usage = this.getQuotaUsage(uid);

    if (usage.remaining <= 0) {
      logger.warn('User quota exceeded', {
        uid,
        used: usage.used,
        limit: usage.limit,
      });
      throw new QuotaExceededError(uid, usage.limit);
    }

    // Update quota
    quotaStore.set(uid, {
      date: today,
      count: usage.used + 1,
    });

    logger.info('Quota consumed', {
      uid,
      newCount: usage.used + 1,
      limit: usage.limit,
    });

    return {
      used: usage.used + 1,
      limit: usage.limit,
      remaining: usage.remaining - 1,
    };
  }

  /**
   * Reset quota for a user (admin function)
   * @param {string} uid - User ID
   */
  resetQuota(uid) {
    quotaStore.delete(uid);
    logger.info('Quota reset', { uid });
  }

  /**
   * Clean up old quota entries (call periodically)
   */
  cleanupOldEntries() {
    const today = this.getCurrentDateKey();
    let cleaned = 0;

    for (const [uid, data] of quotaStore.entries()) {
      if (data.date !== today) {
        quotaStore.delete(uid);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old quota entries', { count: cleaned });
    }
  }
}

class QuotaExceededError extends AppError {
  constructor(uid, limit) {
    super(
      `Daily video generation quota exceeded. Limit: ${limit} videos per day.`,
      429,
      'QUOTA_EXCEEDED'
    );
    this.uid = uid;
    this.limit = limit;
  }
}

module.exports = {
  quotaService: new QuotaService(),
  QuotaExceededError,
};
