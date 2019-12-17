const logger = require('../../../common/logger').logger;


/**
 * Place a stop order
 */
module.exports = async (context, args) => {
    const { ex = {}, symbol = '', session = '' } = context;

    // map the arguments
    const p = ex.assignParams({
        side: 'buy',
        tp: '100',
        sl: '100',
        amount: '0',
        tag: new Date().toISOString(),
    }, args);

    // show a little progress
    logger.progress(`STOP and TAKE PROFIT ORDER - ${ex.name}`);
    logger.progress(p);

    // Validate the side
    if ((p.side !== 'buy') && (p.side !== 'sell')) {
        throw new Error('side must be buy or sell');
    }

    // Place the take profit order
    const tpParams = [
        { name: 'side', value: p.side, index: 0 },
        { name: 'offset', value: p.tp, index: 1 },
        { name: 'amount', value: p.amount, index: 2 },
        { name: 'postOnly', value: 'true', index: 3 },
        { name: 'reduceOnly', value: 'true', index: 4 },
        { name: 'tag', value: p.tag, index: 5 },
    ];
    const tpOrderFull = await ex.executeCommand(symbol, 'limitOrder', tpParams, session);
    const tpOrder = tpOrderFull.order;

    // Place the take profit order
    const slParams = [
        { name: 'side', value: p.side, index: 0 },
        { name: 'offset', value: p.sl, index: 1 },
        { name: 'amount', value: p.amount, index: 2 },
        { name: 'tag', value: p.tag, index: 3 },
    ];
    const slOrder = await ex.executeCommand(symbol, 'stopMarketOrder', slParams, session);

    // Wait for either order to complete...
    const waitTime = ex.maxPollingDelay;
    while (true) {
        // Get the status on the TP order
        const tpInfo = await ex.api.order(tpOrder);
        if ((tpInfo !== null) && ((tpInfo.is_filled) || (!tpInfo.is_open))) {
            logger.progress('Take Profit filled / cancelled. Cancel Stop Loss if still open (might fail)');
            await ex.api.cancelOrders([slOrder]);
            return true;
        }

        try {
            const slInfo = await ex.api.order(slOrder);
            if ((slInfo !== null) && ((slInfo.is_filled) || (!slInfo.is_open))) {
                logger.progress('Stop Loss order filled / cancelled. Cancel Take Profit if still open (might fail)');
                await ex.api.cancelOrders([tpOrder]);
                return true;
            }
        } catch(err) {
            await ex.api.cancelOrders([tpOrder]);
            return true;
        }

        // wait for a bit before deciding what to do next
        await ex.waitSeconds(waitTime);
    }

    return true;
};
