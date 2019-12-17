const log = require('../common/logger');
const Exchange = require('./exchange');
const CoinbaseApi = require('../apis/coinbase');
const NotSupported = require('./commands/not_supported');

const logger = log.logger;


/**
 * Coinbase version of the exchange
 */
class Coinbase extends Exchange {
    /**
     * set up the supported commands and API
     * @param credentials
     */
    constructor(credentials) {
        super(credentials);
        this.name = 'coinbase';

        this.minPollingDelay = 1;
        this.maxPollingDelay = 10;

        // start up any sockets or create API handlers here.
        this.api = new CoinbaseApi(credentials.key, credentials.secret, credentials.passphrase, credentials.endpoint);

        // trailing commands are not supported here yet (need updateOrderPrice in the API driver)
        this.commands.trailingStopLossOrder = NotSupported;
        this.commands.trailingStopLoss = NotSupported;
        this.commands.trailingTakeProfitOrder = NotSupported;
        this.commands.trailingTakeProfit = NotSupported;
    }

    /**
     * Adds a new symbol
     * @param symbol
     * @returns {Promise<void>}
     */
    async addSymbol(symbol) {
        // start the api
        const symbolDetails = await this.api.addSymbol(symbol);
        if (symbolDetails) {
            logger.dim(symbolDetails);
            const minOrderSize = parseFloat(symbolDetails.base_min_size);

            const calcPrecision = (v) => {
                let precision = 0;
                let value = parseFloat(v);
                while (value < 1) {
                    value *= 10;
                    precision += 1;
                }
                return precision;
            };

            // How to round prices
            const pricePrecision = calcPrecision(symbolDetails.quote_increment);

            // allow a bit more precision where some is allowed, as the exchange does not seem to stop this
            const ap = calcPrecision(symbolDetails.base_min_size);
            const assetPrecision = ap === 0 ? 0 : ap + 1;

            this.symbolData.update(symbol, {
                minOrderSize,
                assetPrecision,
                pricePrecision,
            });
        }
    }

    /**
     * Handle shutdown
     */
    terminate() {
        logger.progress('Coinbase exchange closing down');
        super.terminate();
    }

    /**
     * Given a symbol (like BTC-USD), figure out the pair (btc & usd)
     * @param symbol
     * @returns {*}
     */
    splitSymbol(symbol) {
        const regex = /^([a-z]+)-([a-z]+)/;
        const m = regex.exec(symbol.toLowerCase());
        if (m) {
            return { asset: m[1], currency: m[2] };
        }

        return { asset: 'btc', currency: 'usd' };
    }
}

module.exports = Coinbase;
