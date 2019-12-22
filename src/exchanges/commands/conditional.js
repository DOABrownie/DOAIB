const logger = require('../../common/logger').logger;
const moment = require('moment');

/**
 * Checks really simple conditions
 * @param context
 * @param condition
 * @returns {Promise<*>}
 */
async function simpleConditions(context, condition) {
    // Start by checking conditions that have no external dependencies
    if ((condition === 'always') || (condition === 'true')) {
        return true;
    }

    if ((condition === 'never') || (condition === 'false')) {
        return false;
    }

    return null;
}

/**
 * Checks date and time
 * @param context
 * @param condition
 * @param value
 * @returns {Promise<*>}
 */
async function dateTimeConditions(context, condition, value) {
    // Some date and time related conditions
    const now = moment.utc();
    const targetDate = moment.utc(value, 'YYYY-MM-DD', true);
    logger.progress(`Time and Date is ${now.format()}`);

    if (condition === 'isafterdate') {
        return now.isAfter(targetDate, 'day');
    }

    if (condition === 'isonorafterdate') {
        return now.isSameOrAfter(targetDate, 'day');
    }

    if (condition === 'isbeforedate') {
        return now.isBefore(targetDate, 'day');
    }

    if (condition === 'isonorbeforedate') {
        return now.isSameOrBefore(targetDate, 'day');
    }

    if (condition === 'issamedate') {
        return now.isSame(targetDate, 'day');
    }

    const targetTime = moment.utc(value, 'HH:mm', true);
    if (condition === 'isaftertime') {
        return now.isAfter(targetTime);
    }

    if (condition === 'isbeforetime') {
        return now.isBefore(targetTime);
    }

    return null;
}

/**
 * Various tests against your position
 * @param context
 * @param condition
 * @param value
 * @returns {Promise<null>}
 */
async function positionConditions(context, condition, value) {
    const { ex = {}, symbol = '' } = context;

    const getCurrencyFromSymbol = (symbol) => {
        const regex = /^(.{3})-(.*)/u;
        const m = regex.exec(symbol);
        if (m) {
            return m[1];
        }

        // Default to btc / usd - not sure about this...
        // should really just throw an error
        return 'BTC';
    };

    const currency = getCurrencyFromSymbol(symbol);


    // Get the open position
    const position = await ex.positionSize(symbol);
    const target = parseFloat(value);
    const unPnl = await ex.unrealizedPnl();
    const fixed = unPnl[0].floatingPl.toFixed(6);
    logger.progress(`Current position size is ${position}`);

    // Test agains Unrealized PNL
    if (condition === 'inProfit') {
        logger.progress(`Current UnPNL: ${fixed}`);
        return unPnl > 0;
    }

    if (condition === 'inLoss') {
        logger.progress(`Current UnPNL: ${fixed}`);
        return unPnl < 0;
    }

    if (condition === 'inProfitBy') {
        logger.progress(`Current UnPNL: ${fixed}, target UnPNL: ${target}`);
        return unPnl > target;
    }

    if (condition === 'inLossBy') {
        logger.progress(`Current UnPNL: ${fixed}, target UnPNL: ${target}`);
        return unPnl < target;
    }

    // Test against the position size
    if (condition === 'positionlessthan') {
        return position < target;
    }

    if (condition === 'positiongreaterthan') {
        return position > target;
    }

    if (condition === 'positionlessthaneq') {
        return position <= target;
    }

    if (condition === 'positiongreaterthaneq') {
        return position >= target;
    }

    if (condition === 'positionlong') {
        return position > 0;
    }

    if (condition === 'positionshort') {
        return position < 0;
    }

    if (condition === 'positionnone') {
        return position === 0;
    }

    return null;
}

/**
 * Conditions based on the current price (uses average of bid and ask for last price)
 * @param context
 * @param condition
 * @param value
 * @returns {Promise<boolean>}
 */
async function lastPriceConditions(context, condition, value) {
    const { ex = {} } = context;

    const orderBook = await ex.support.ticker(context);
    const price = (parseFloat(orderBook.bid) + parseFloat(orderBook.ask)) / 2;
    const target = parseFloat(value);
    logger.progress(`Current price is ${price}`);

    if (condition === 'pricelessthan') {
        return price < target;
    }

    if (condition === 'pricegreaterthan') {
        return price > target;
    }

    if (condition === 'pricelessthaneq') {
        return price <= target;
    }

    if (condition === 'pricegreaterthaneq') {
        return price >= target;
    }

    return null;
}

/**
 * Determine if condition is true or false
 */
module.exports = async (context, condition, value) => {
    // Check any simple conditions
    const simple = await simpleConditions(context, condition);
    if (simple !== null) {
        return simple;
    }

    // Check the date and time conditions
    const datetime = await dateTimeConditions(context, condition, value);
    if (datetime !== null) {
        return datetime;
    }

    // Check the position size conditions
    const position = await positionConditions(context, condition, value);
    if (position !== null) {
        return position;
    }

    // Check the position size conditions
    const lastPrice = await lastPriceConditions(context, condition, value);
    if (lastPrice !== null) {
        return lastPrice;
    }

    return false;
};
