const logger = require('../../common/logger').logger;
const conditional = require('./conditional');
const AbortSequenceError = require('../../exceptions/abort_sequence');

async function test(context, condition, value) {
    const result = await conditional(context, condition, value);
    if (!result) {
        throw new AbortSequenceError('Conditional ContinueIf test did not pass. Cancel remaining commands');
    }

    return true;
}


/**
 * Continue if a condition is met
 * continue(if=condition, value=v);
 */
module.exports = async (context, args) => {
    const { ex = {} } = context;

    const p = ex.assignParams({
        if: 'always',
        value: '',
    }, args);

    logger.progress(`CONTINUE IF - ${ex.name}`);
    logger.progress(p);

    return test(context, p.if.toLowerCase(), p.value);
};
