const logger = require('../common/logger').logger;
const util = require('../common/util');

class NullApi {
    /**
     */
    constructor() {
        this.nextId = 0;
        this.tickerTime = 0;
    }

    /**
     * Called when the exchange is created, allowing the exchange to start up any sockets
     * or look up details of the symbol being traded.
     * @param symbol
     * @returns {Promise<void>}
     */
    async init() {
        // a chance for any start up stuff
        logger.info('Null API init()');
    }

    /**
     * Called before commands are executed on an exchange to tell it about the symbol
     * the commands will relate to. This gives the exchange a chance to start listening
     * of any events relevant to the symbol.
     * @param symbol
     * @returns {Promise<void>}
     */
    async addSymbol(symbol) {
        // called to add a symbol to an already open exchange
        // symbol may already have been added before, so check if that matters
        logger.info(`Null API adding symbol - ${symbol}`);
        if (symbol !== 'BTCUSD') {
            throw Error('Use BTCUSD for Null API');
        }
    }

    /**
     * Called before the API is destroyed
     */
    async terminate() {
        // chance for any last minute shutdown stuff
        logger.info('Null API Terminate');
    }

    /**
     * Get the ticker for a symbol
     * @param symbol
     * @returns {*}
     */
    ticker(symbol) {
        // make the price wobble up and down
        this.tickerTime += 2;
        const offset = util.round(150 * Math.sin(((2 * 3.1415927) * this.tickerTime) / 360), 2);
        const bid = 1000 + offset;
        const ask = bid + 1;
        const last = ask;

        logger.info(`Nul API Ticker: symbol: ${symbol}, bid: ${bid}, Ask: ${ask}, Last: ${last}`);
        return Promise.resolve({
            symbol,
            bid: `${bid}`,
            ask: `${ask}`,
            last_price: `${last}`,
        });
    }

    /**
     * Wallet details
     * @returns {*}
     */
    walletBalances() {
        logger.info('Null API wallet balances');
        return Promise.resolve([
            {
                type: 'exchange',
                currency: 'usd',
                amount: '2000000',
                available: '2000000',
            },
            {
                type: 'exchange',
                currency: 'btc',
                amount: '1000',
                available: '1000',
            },
        ]);
    }

    /**
     * place a limit order
     * @param symbol
     * @param amount
     * @param price
     * @param side
     * @param postOnly
     * @param reduceOnly
     * @returns {*}
     */
    limitOrder(symbol, amount, price, side, postOnly, reduceOnly) {
        logger.info(`Null API limit order - ${symbol}, amount:${amount}, price:${price}, side:${side}, postOnly:${postOnly}, reduceOnly:${reduceOnly}`);

        this.nextId += 1;
        return Promise.resolve({ id: this.nextId });
    }

    /**
     * Place a market order
     * @param symbol
     * @param amount
     * @param side - buy or sell
     * @param isEverything
     */
    marketOrder(symbol, amount, side, isEverything) {
        logger.info(`Null API market order - ${symbol}, amount:${amount}, side:${side}`);

        this.nextId += 1;
        return Promise.resolve({ id: this.nextId });
    }

    /**
     * Place a stop market order
     * @param symbol
     * @param amount
     * @param price
     * @param side - buy or sell
     * @param trigger
     */
    stopOrder(symbol, amount, price, side, trigger) {
        logger.info(`Null API stop order - ${symbol}, amount:${amount}, price: ${price}, side:${side}, trigger:${trigger}`);

        this.nextId += 1;
        return Promise.resolve({ id: this.nextId });
    }


    /**
     * Find active orders
     * @param symbol
     * @param side - buy, sell or all
     * @returns {*}
     */
    activeOrders(symbol, side) {
        logger.info(`Null API active orders - ${symbol}, side:${side}`);
        return Promise.resolve([]);
    }

    /**
     * Cancel some orders
     * @param orders
     * @returns {*}
     */
    cancelOrders(orders) {
        logger.info('Null API cancel orders');
        logger.info(orders);
        return Promise.resolve({});
    }

    /**
     * Find out about a specific order
     * @param orderId
     * @returns {PromiseLike<{id: *, side: *, amount: number, remaining: number, executed: number, is_filled: boolean}> | Promise<{id: *, side: *, amount: number, remaining: number, executed: number, is_filled: boolean}>}
     */
    order(orderId) {
        logger.info('Null API order.');
        logger.info(orderId);

        const isFilled = (Math.random() > 0.95);

        return Promise.resolve({
            id: orderId,
            ordType: 'limit',
            side: 'buy',
            amount: 1,
            remaining: isFilled ? 0 : 1,
            executed: isFilled ? 1 : 0,
            is_filled: isFilled,
            is_open: !isFilled,
        });
    }

    /**
     * Updates the price of a given order. Returns a new order id (which may be the same as the input order id,
     * but might be different, depending on the exchange.
     * @param order
     * @param price
     * @returns {Promise<never>}
     */
    updateOrderPrice(order, price) {
        logger.info(`Null API update order price. orderId:${order.id}, price:${price}`);
        return Promise.resolve({ id: order.id });
    }
}

module.exports = NullApi;
