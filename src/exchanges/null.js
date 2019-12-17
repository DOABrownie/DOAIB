const logger = require('../common/logger').logger;
const Exchange = require('./exchange');
const NullApi = require('../apis/null_api');


/**
 * Bitfinex version of the exchange
 */
class NullExchange extends Exchange {
    /**
     * set up the supported commands and API
     * @param credentials
     */
    constructor(credentials) {
        super(credentials);
        this.name = 'null';

        this.minPollingDelay = 0;
        this.maxPollingDelay = 2;

        // start up any sockets or create API handlers here.
        this.api = new NullApi();
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

        const minOrderSize = 1;
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
        logger.progress('Null exchange closing down');
        super.terminate();

        await this.api.terminate();
    }
}

module.exports = NullExchange;
