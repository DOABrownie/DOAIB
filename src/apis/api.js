
class ApiInterface {
    /**
     *
     * @param key
     * @param secret
     */
    constructor(key, secret) {
    }

    /**
     * Called when the exchange is created, allowing the exchange to start up any sockets
     * or look up details of the symbol being traded.
     * @param symbol
     * @returns {Promise<void>}
     */
    async init() {
        // a chance for any start up stuff
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
    }

    /**
     * Called before the API is destroyed
     */
    async terminate() {
        // chance for any last minute shutdown stuff
    }

    /**
     * Get the ticker for a symbol
     * @param symbol
     * @returns {*}
     */
    ticker(symbol) {
        return Promise.reject(new Error('Not implemented'));
    }

    /**
     * Wallet details
     * @returns {*}
     */
    walletBalances() {
        return Promise.reject(new Error('Not implemented'));
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
        return Promise.reject(new Error('Not implemented'));
    }

    /**
     * Place a market order
     * @param symbol
     * @param amount
     * @param side - buy or sell
     * @param isEverything
     */
    marketOrder(symbol, amount, side, isEverything) {
        return Promise.reject(new Error('Not implemented'));
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
        return Promise.reject(new Error('Not implemented'));
    }


    /**
     * Find active orders
     * @param symbol
     * @param side - buy, sell or all
     * @returns {*}
     */
    activeOrders(symbol, side) {
        return Promise.reject(new Error('Not implemented'));
    }

    /**
     * Cancel some orders
     * @param orders
     * @returns {*}
     */
    cancelOrders(orders) {
        return Promise.reject(new Error('Not implemented'));
    }

    /**
     * Find out about a specific order
     * @param orderId
     * @returns {PromiseLike<{id: *, side: *, amount: number, remaining: number, executed: number, is_filled: boolean}> | Promise<{id: *, side: *, amount: number, remaining: number, executed: number, is_filled: boolean}>}
     */
    order(orderId) {
        return Promise.reject(new Error('Not implemented'));
    }

    /**
     * Updates the price of a given order. Returns a new order id (which may be the same as the input order id,
     * but might be different, depending on the exchange.
     * @param orderId
     * @param price
     * @returns {Promise<never>}
     */
    updateOrderPrice(orderId, price) {
        return Promise.reject(new Error('Not implemented'));
    }
}

module.exports = ApiInterface;
