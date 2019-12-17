const uuid = require('uuid/v4');
const logger = require('../../../common/logger').logger;


/**
 * Fetch the current price
 * @param context
 * @param side
 * @returns {Promise<number>}
 */
async function getCurrentPrice(context, side) {
    const { ex = {}, symbol = '', session = '' } = context;
    const isBuy = (side === 'buy');

    // get the current price
    const orderBook = await ex.support.ticker(context);
    return isBuy ? parseFloat(orderBook.bid) : parseFloat(orderBook.ask);
}


/**
 * Will attempt to place an order at the top of the book.
 * If it fails, as the price moved, it will try again, though it will only try a limited number of times
 * @param context
 * @param side
 * @param amount
 * @param price
 * @returns {Promise<*>}
 */
async function placeOrderAtTop(context, side, amount, price) {
    const { ex = {}, symbol = '', session = '' } = context;

    // figure out some prices for the order
    const now = new Date().toISOString();
    logger.info(`${amount} of Aggressive Entry Order still to fill at ${now}`);

    let orderAttempts = 0;
    let order = null;
    let currentPrice = price;
    while (orderAttempts < 20) {
        // get the price...
        logger.info(`Placing order for ${amount} at ${currentPrice}.`);

        // place a new limit order
        const orderParams = [
            { name: 'side', value: side, index: 0 },
            { name: 'amount', value: `${amount}`, index: 1 },
            { name: 'offset', value: `@${currentPrice}`, index: 2 },
            { name: 'postOnly', value: 'true', index: 3 },
        ];
        order = await ex.executeCommand(symbol, 'limitOrder', orderParams, session);

        // Wait for the order to exist
        let orderInfo = await ex.api.order(order.order);
        let attempts = 0;
        while (attempts < 10 && orderInfo === null) {
            await ex.waitSeconds(ex.minPollingDelay);
            orderInfo = await ex.api.order(order.order);
            attempts += 1;
        }

        if (orderInfo !== null) {
            if ((orderInfo.is_open) || (orderInfo.is_filled)) {
                return { order, currentPrice };
            }
        }

        // Going around to try and place the order again
        orderAttempts += 1;
        currentPrice = await getCurrentPrice(context, side);

        logger.info(`Order failed (price might have moved against us too quickly). Trying again. Attempt ${orderAttempts}`);
        logger.dim(orderInfo);
    }

    // probably not worked, or lagged to hell. return what we have.
    return { order, currentPrice };
}

async function earlyExit(ex, activeOrder, msg) {
    logger.progress(msg);
    if (activeOrder) {
        await ex.api.cancelOrders([activeOrder]);
    }

    return Promise.resolve({});
}

/**
 * Place an aggressive entry algorithmic order
 */
module.exports = async (context, args) => {
    const { ex = {}, symbol = '', session = '' } = context;
    const p = ex.assignParams({
        side: 'buy',
        amount: '0',
        position: '',
        timeLimit: '',
        slippageLimit: '',
        tag: 'aggressive',
    }, args);

    // Get the params in units we can use (numbers!)
    p.side = p.side.toLowerCase();
    p.timeLimit = ex.timeToSeconds(p.timeLimit, 0);
    const expiryTime = Date.now() + (p.timeLimit * 1000);

    // show a little progress
    logger.progress(`AGGRESSIVE ENTRY- ${ex.name}`);
    logger.progress(p);

    // Validate the side
    if ((p.side !== 'buy') && (p.side !== 'sell')) {
        return Promise.reject(new Error('side must be buy or sell'));
    }

    // Convert a position to an amount to order (if needed)
    const modifiedPosition = await ex.positionToAmount(symbol, p.position, p.side, p.amount);
    if (modifiedPosition.amount.value === 0) {
        // Nothing to do
        logger.results('Aggressive entry order size is Zero - ignoring.');
        return Promise.resolve({});
    }

    // Capture the modified size and direction information
    const side = modifiedPosition.side;
    const amountStr = `${modifiedPosition.amount.value}${modifiedPosition.amount.units}`;

    // Work out the slippage limit, if there is one
    const slippageSide = side === 'buy' ? 'sell' : 'buy';
    const slippagePrice = await ex.offsetToAbsolutePrice(symbol, slippageSide, p.slippageLimit);

    // convert the amount to an actual order size.
    const orderPrice = await ex.offsetToAbsolutePrice(symbol, side, '0');
    const details = await ex.orderSizeFromAmount(symbol, side, orderPrice, amountStr);
    if (details.orderSize === 0) {
        return Promise.reject('No funds available or order size is zero');
    }

    const id = uuid();

    // Log the algo order, so it can be cancelled
    ex.startAlgoOrder(id, side, session, p.tag);
    logger.results(`Aggressive entry order adjusted to side: ${side}, amount: ${details.orderSize}.`);

    // Start off we no active order and the full amount still to fill
    let activeOrder = null;
    let activePrice = 0;
    let amountLeft = details.orderSize;
    let waitTime = ex.minPollingDelay;

    // The loop until there is nothing left to order
    while (amountLeft >= ex.symbolData.minOrderSize(symbol)) {
        // Has the order been cancelled via a cancelOrders call
        if (ex.isAlgoOrderCancelled(id)) {
            return earlyExit(ex, activeOrder, 'aggressive entry order cancelled.');
        }

        // have we reached the expiry time of the order
        if (p.timeLimit > 0 && expiryTime < Date.now()) {
            return earlyExit(ex, activeOrder, 'aggressive entry order reached time limit. Aborting');
        }

        // get the current price
        const currentPrice = await getCurrentPrice(context, side);

        // Abort if too much slippage
        if (p.slippageLimit !== '') {
            const hasBuySlippedTooFar = (side === 'buy' && currentPrice > slippagePrice);
            const hasSellSlippedTooFar = (side === 'sell' && currentPrice < slippagePrice);
            if (hasBuySlippedTooFar || hasSellSlippedTooFar) {
                return earlyExit(ex, activeOrder, 'aggressive entry order reached price slippage limit. Aborting');
            }
        }

        // track the order
        if (activeOrder === null) {
            // are we the right side of the limit price?
            const amount = ex.roundAsset(symbol, amountLeft);
            const placedOrder = await placeOrderAtTop(context, side, amount, currentPrice);
            const order = placedOrder.order;
            activeOrder = order.order;
            activePrice = placedOrder.currentPrice;
            waitTime = ex.minPollingDelay + 2;
        } else {
            // There is already an open order, so see if it's filled yet
            const orderInfo = await ex.api.order(activeOrder);
            if (orderInfo !== null) {
                if (orderInfo.is_filled) {
                    logger.progress('Aggressive Entry: filled');
                    amountLeft -= orderInfo.executed;
                    activeOrder = null;
                    waitTime = ex.minPollingDelay;
                } else if (!orderInfo.is_open) {
                    logger.progress('Aggressive Entry order: cancelled - aborting entire order');
                    return Promise.resolve({});
                } else if (activePrice !== currentPrice) {
                    logger.progress('Aggressive Entry order: No longer at top of book - moving');
                    await ex.api.cancelOrders([activeOrder]);
                    amountLeft -= orderInfo.executed;
                    activeOrder = null;
                    activePrice = 0;
                    waitTime = ex.minPollingDelay;
                }
            } else {
                logger.progress('Aggressive Entry order: waiting for order status');
            }
        }

        // wait for a bit before deciding what to do next
        await ex.waitSeconds(waitTime);
        if (waitTime < ex.maxPollingDelay) waitTime += 1;
    }

    ex.endAlgoOrder(id);
    logger.results('Aggressive entry order complete');
    return Promise.resolve({});
};

