const logger = require('../../common/logger').logger;

/**
 * Exchanges can replace unsupported commands with this. Does nothing
 */
module.exports = async (context, args) => {
    const { ex = {} } = context;

    logger.progress(`This command is not supported on ${ex.name} at this time. Ignored.`);
    return ex.waitSeconds(1);
};
