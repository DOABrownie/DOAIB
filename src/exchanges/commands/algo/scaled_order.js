const timesSeries = require('async').timesSeries;
const logger = require('../../../common/logger').logger;
const scaledAmounts = require('../../../common/scaled_amounts');
const scaledPrices = require('../../../common/scaled_prices');


/**
 * scaledOrder
 * scaledOrder(from, to, orderCount, amount, side, tag)
 * scaledOrder(from, to, orderCount, position, tag)
 */
module.exports = async (context, args) => {
    const { ex = {}, symbol = '', session = '' } = context;

    const p = ex.assignParams({
        from: '0',
        to: '50',
        orderCount: '10',
        amount: '0',
        side: 'buy',
        easing: 'linear',
        varyAmount: '0',
        varyPrice: '0',
        tag: '',
        position: '',
    }, args);

    // show a little progress
    logger.progress(`SCALED ORDER - ${ex.name}`);
    logger.progress(p);

    // get the order count as a number (clamped below 100)
    p.orderCount = Math.min(parseInt(p.orderCount, 10), 100);
    p.varyAmount = ex.parsePercentage(p.varyAmount);
    p.varyPrice = ex.parsePercentage(p.varyPrice);

    // zero orders means nothing to do
    if (p.orderCount < 1) {
        logger.results('Scaled order not placed, as order count is Zero.');
        return [];
    }

    // Figure out the size of each order
    const modifiedPosition = await ex.positionToAmount(symbol, p.position, p.side, p.amount);
    if (modifiedPosition.amount.value === 0) {
        logger.results('Scaled order not placed, as order size is Zero.');
        return [];
    }

    // So we now know the desired position size and direction
    p.side = modifiedPosition.side;
    p.amount = modifiedPosition.amount;

    // Get from and to as absolute prices
    p.from = await ex.offsetToAbsolutePrice(symbol, p.side, p.from);
    p.to = await ex.offsetToAbsolutePrice(symbol, p.side, p.to);

    // get from and to in order
    if ((p.side === 'buy' && p.from < p.to) || (p.side === 'sell' && p.from > p.to)) {
        const tmp = p.from;
        p.from = p.to;
        p.to = tmp;
    }

    // check for from or to being below zero
    if (p.from <= 0 || p.to <= 0) {
        logger.results('Scaled order not placed, as price range goes below zero.');
        return [];
    }

    // Adjust the size to take into account available funds
    p.amount.value = await ex.support.scaledOrderSize(context, p);
    if (p.amount.value === 0) {
        logger.results('Scaled order would result in trying to place orders below min order size. Ignoring.');
        return [];
    }

    // Get an array of amounts
    const roundAsset = asset => ex.roundAsset(symbol, asset);
    const roundPrice = price => ex.roundPrice(symbol, price);
    const amounts = scaledAmounts(p.orderCount, p.amount.value, p.varyAmount, roundAsset);
    const prices = scaledPrices(p.orderCount, p.from, p.to, p.varyPrice, p.easing, roundPrice);

    logger.progress('Adjusted values based on Available Funds');
    logger.progress(p);

    // map the amount to a scaled amount (amount / steps, but keep units (eg %))
    return new Promise((resolve, reject) => timesSeries(p.orderCount, async (i) => {
        // Place the order
        try {
            // If there are no units we can place the order directly and save on API calls
            if (p.amount.units === '') {
                // Place the order
                const order = await ex.api.limitOrder(symbol, amounts[i], prices[i], p.side, true, false);
                ex.addToSession(session, p.tag, order);
                const now = new Date();
                logger.results(`Limit order placed at ${now.toTimeString()}. ${p.side} ${amounts[i]} at ${prices[i]}.`);
                logger.dim(order);
                return {
                    order,
                    side: p.side,
                    price: prices[i],
                    amount: amounts[i],
                    units: '',
                };
            }

            // A more complex case, we'll just push it to teh standard limit order solution
            const limitOrderArgs = [
                { name: 'side', value: p.side, index: 0 },
                { name: 'offset', value: `@${prices[i]}`, index: 1 },
                { name: 'amount', value: `${amounts[i]}${p.amount.units}`, index: 2 },
                { name: 'tag', value: p.tag, index: 3 },
            ];

            return await ex.executeCommand(symbol, 'limitOrder', limitOrderArgs, session);
        } catch (err) {
            logger.error(`Error placing a limit order as part of a scaled order - ${err}`);
            logger.error('Continuing to try and place the rest of the series...');
            return {
                order: null,
                side: p.side,
                price: prices[i],
                amount: amounts[i],
                units: p.amount.units,
            };
        }
    }, (err, orders) => (err ? reject(err) : resolve(orders))));
};
