const logger = require('../common/logger').logger;
const util = require('../common/util');
const Exchange = require('./exchange');
const BitfinexApiv2 = require('../apis/bitfinexv2');
const NotSupported = require('./commands/not_supported');


/**
 * Bitfinex version of the exchange
 */
class Bitfinex extends Exchange {
    /**
     * set up the supported commands and API
     * @param credentials
     */
    constructor(credentials) {
        super(credentials);
        this.name = 'bitfinex';

        this.minPollingDelay = 0;
        this.maxPollingDelay = 3;

        this.isMargin = !!(credentials.margin || false);

        // start up any sockets or create API handlers here.
        this.api = new BitfinexApiv2(credentials.key, credentials.secret, credentials);

        // trailing commands are not supported here yet (need updateOrderPrice in the API driver)
        this.commands.trailingStopLossOrder = NotSupported;
        this.commands.trailingStopLoss = NotSupported;
        this.commands.trailingTakeProfitOrder = NotSupported;
        this.commands.trailingTakeProfit = NotSupported;
    }

    /**
     * Called after the exchange has been created, but before it has been used.
     */
    async init() {
        // start the socket connections etc
        await this.api.init();
    }

    /**
     * Let the api know that we are interested in a new symbol
     * @param symbol
     * @returns {Promise<void>}
     */
    async addSymbol(symbol) {
        await this.api.addSymbol(symbol);

        // Using v2 of the API, there does not appear to be a way to find out the min order size.
        // This article (https://support.bitfinex.com/hc/en-us/articles/115003283709-What-is-the-minimum-order-size-)
        // suggests between $10 and $25 as the min order size, so I am taking the worst case value
        // and using that to work out a min.

        let minOrderSize = 1;
        const pair = this.splitSymbol(symbol);
        if (pair.currency.toUpperCase() === 'USD') {
            const ticker = await this.api.ticker(symbol);
            minOrderSize = util.roundDown(10 / parseFloat(ticker.bid), 5);
        } else {
            // look up the asset / USD pair, so we can work out how many == $10ish
            const dummySymbol = `${pair.asset}USD`;
            const ticker = await this.api.tickerDirect(dummySymbol.toUpperCase());
            minOrderSize = util.roundDown(10 / parseFloat(ticker.bid), 5);
            if (minOrderSize > 5) {
                minOrderSize = Math.ceil(minOrderSize);
            }
        }

        logger.info(`Min order size for ${symbol} is assumed to be ${minOrderSize}`);
        this.symbolData.update(symbol, {
            minOrderSize,
            assetPrecision: 8,
            pricePrecision: 5,
        });
    }

    /**
     * Handle shutdown
     */
    async terminate() {
        logger.progress('Bitfinex exchange closing down');
        super.terminate();

        await this.api.terminate();
    }

    /**
     * Rounds the price to 50c values
     * @param symbol
     * @param price
     * @returns {*}
     */
    roundPrice(symbol, price) {
        return util.roundSignificantFigures(price, this.symbolData.pricePrecision(symbol));
    }

    /**
     * Find the order size from the amount
     * @param symbol
     * @param side
     * @param orderPrice
     * @param amountStr
     * @returns {Promise<{total: *, available: *, isAllAvailable: boolean, orderSize: *}>}
     */
    async orderSizeFromAmount(symbol, side, orderPrice, amountStr) {
        // Get the normal response
        const orderInfo = super.orderSizeFromAmount(symbol, side, orderPrice, amountStr);

        // adjust if using margin to not cap the order by balance
        if (this.isMargin) {
            orderInfo.orderSize = orderInfo.rawOrderSize;
        }

        return orderInfo;
    }
}

module.exports = Bitfinex;
