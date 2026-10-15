// -----------------------------------------------------------------------------
// Repeated failures, logged once.
//
// A reading that fails every five minutes, a rate limit that lasts an hour,
// Gladys refusing the states: each would write the same warning again and
// again. An issue log keeps, per key, whether the problem is ongoing: the
// first failure is a warning (or an error), the next ones go to debug, and the
// recovery is one info line. (Adapted from guim31/gladys-subsonic.)
// -----------------------------------------------------------------------------

/**
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} logger
 */
export function createIssueLog(logger) {
  const ongoing = new Map();
  return {
    /**
     * Report a failure: once at `level`, then at debug while it lasts. A
     * different message under the same key (the problem changed) is logged again.
     * @param {string} key what failed (one key per independent problem)
     * @param {string} message
     * @param {'warn'|'error'} [level]
     * @param {string} [signature] what makes two failures the same problem (default: the message)
     */
    fail(key, message, level = 'warn', signature = message) {
      if (ongoing.get(key) === signature) {
        logger.debug(`${message} (still failing)`);
        return;
      }
      ongoing.set(key, signature);
      logger[level](message);
    },

    /**
     * Report a success: one info line when it ends an ongoing failure.
     * @param {string} key
     * @param {string} [message] said on recovery only
     */
    ok(key, message) {
      if (ongoing.delete(key) && message) {
        logger.info(message);
      }
    },

    /** @param {string} key */
    isFailing(key) {
      return ongoing.has(key);
    },

    clear() {
      ongoing.clear();
    },
  };
}
