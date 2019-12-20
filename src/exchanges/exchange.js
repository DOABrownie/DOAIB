const uuid = require('uuid/v4');
const logger = require('../common/logger').logger;
const util = require('../common/util');
const SymbolData = require('../common/symbol_data');
const ExchangeCommand = require('../commands/exchange_command');
const CommandState = require('../commands/command_state');
const AbortSequenceError = require('../exceptions/abort_sequence');


// Fetch the commands we support
const icebergOrder = require('./commands/algo/iceberg_order');
const scaledOrder = require('./commands/algo/scaled_order');
const twapOrder = require('./commands/algo/twap_order');
const pingPongOrder = require('./commands/algo/ping_pong');
const marketMakerOrder = require('./commands/algo/market_maker');
const aggressiveEntryOrder = require('./commands/algo/aggressive_entry');
const stopOrTakeProfitOrder = require('./commands/algo/stop_take_profit_order');

const limitOrder = require('./commands/orders/limit_order');
const marketOrder = require('./commands/orders/market_order');
const cancelOrders = require('./commands/cancel_orders');

const stopMarketOrder = require('../commands/stop_market');
const trailingStopLossCommand = require('../commands/trailing_stop');
const trailingTakeProfitCommand = require('../commands/trailing_takeprofit');

const notify = require('./commands/notify');
const balance = require('./commands/balance');
const wait = require('./commands/wait');
const continueCmd = require('./commands/continue');
const stopCmd = require('./commands/stop');

// and some support functions
const scaledOrderSize = require('./support/scaled_order_size');
const ticker = require('./support/ticker');
const accountBalances = require('./support/account_balances');


/**
 * Helper to build a class constructor wrapper
 * @param c
 * @returns {{class: *}}
 */
function addExchangeCommand(c) {
    return { class: c };
}

/**
 * Base Exchange class
 */
class Exchange {
    /**
     * ctor
     * @param credentials
     */
    constructor(credentials) {
        this.name = 'none';
        this.credentials = credentials;
        this.refCount = 1;

        this.minPollingDelay = 0;
        this.maxPollingDelay = 5;

        this.sessionOrders = [];
        this.algorithicOrders = [];
        this.symbolData = new SymbolData();
        this.api = null;

        this.backgroundTasks = [];
        this.isAlreadyWaiting = false;

        this.support = {
            scaledOrderSize,
            ticker,
            accountBalances,
        };

        this.commands = {
            // Algorithmic Orders
            aggressiveEntryOrder,
            aggressiveEntry: aggressiveEntryOrder,
            stopOrTakeProfitOrder,
            stopOrTakeProfit: stopOrTakeProfitOrder,
            icebergOrder,
            iceberg: icebergOrder,
            scaledOrder,
            scaled: scaledOrder,
            twapOrder,
            twap: twapOrder,
            pingPongOrder,
            pingPong: pingPongOrder,
            marketMakerOrder,
            marketMaker: marketMakerOrder,
            trailingStopLossOrder: addExchangeCommand(trailingStopLossCommand),
            trailingStopLoss: addExchangeCommand(trailingStopLossCommand),
            trailingTakeProfitOrder: addExchangeCommand(trailingTakeProfitCommand),
            trailingTakeProfit: addExchangeCommand(trailingTakeProfitCommand),

            // deprecated
            steppedMarketOrder: twapOrder, // duplicate using legacy name
            accDisOrder: icebergOrder, // duplicate for common names

            // Regular orders
            limitOrder,
            limit: limitOrder,
            marketOrder,
            market: marketOrder,
            stopMarketOrder: addExchangeCommand(stopMarketOrder),
            stopMarket: addExchangeCommand(stopMarketOrder),

            // Other commands
            cancelOrders,
            cancel: cancelOrders,
            wait,
            notify,
            balance,
            continue: continueCmd,
            stop: stopCmd,
        };

        this.commandWhiteList = [
            'trailingStopLoss', 'trailingTakeProfit',
            'stopOrTakeProfit', 'aggressiveEntry',
            'iceberg', 'scaled', 'twap', 'pingPong', 'marketMaker',
            'limit', 'market', 'stopMarket',
            'cancel',

            'trailingStopLossOrder', 'trailingTakeProfitOrder',
            'stopOrTakeProfitOrder', 'aggressiveEntryOrder',
            'icebergOrder', 'scaledOrder', 'twapOrder', 'pingPongOrder', 'marketMakerOrder',
            'limitOrder', 'marketOrder', 'stopMarketOrder',
            'cancelOrders',
            'steppedMarketOrder', 'accDisOrder',
            'continue', 'stop', 'wait', 'notify', 'balance',
        ];
    }

    /**
     * Adds a reference
     */
    addReference() {
        this.refCount += 1;
    }

    /**
     * Removes a reference
     */
    removeReference() {
        this.refCount -= 1;
        return this.refCount;
    }

    /**
     * Determine if this exchange is a match of the details given
     * @param credentials
     * @returns {boolean}
     */
    matches(credentials) {
        return JSON.stringify(credentials) === JSON.stringify(this.credentials);
    }

    /**
     * Called after the exchange has been created, but before it has been used.
     */
    async init() {
        // nothing
    }

    /**
     * Adding a symbol
     * @param symbol
     * @returns {Promise<void>}
     */
    async addSymbol(symbol) {
        // nothing
    }

    /**
     * Called before the exchange is destroyed
     */
    async terminate() {
        // chance for any last minute shutdown stuff
    }

    /**
     * Rounds the price. eg, on the BTCUSD pair, this would be rounding the amount of USD
     * @param symbol
     * @param price
     * @returns {*}
     */
    roundPrice(symbol, price) {
        return util.roundDown(price, this.symbolData.pricePrecision(symbol));
    }

    /**
     * Rounds an amount of assets. eg on BTCUSD pair, this would be round an amount of BTC
     * @param symbol
     * @param assets
     * @returns {*}
     */
    roundAsset(symbol, assets) {
        return util.round(assets, this.symbolData.assetPrecision(symbol));
    }

    /**
     * Adds the order to the session
     * @param session
     * @param tag
     * @param order
     */
    addToSession(session, tag, order) {
        this.sessionOrders.push({
            session,
            tag,
            order,
        });
    }

    /**
     * Removes an order from the session
     * @param session
     * @param order
     */
    removeFromSession(session, order) {
        this.sessionOrders = this.sessionOrders.filter(entry => entry.order !== order);
    }

    /**
     * Updates an order in the session. Allows for the order id to have changed too.
     * @param session
     * @param oldOrder
     * @param newOrder
     * @param tag
     */
    updateInSession(session, tag, oldOrder, newOrder) {
        this.removeFromSession(session, oldOrder);
        this.addToSession(session, tag, newOrder);
    }

    /**
     * Given a session id and tag, find everything that matches
     * @param session
     * @param tag
     * @returns {*[]}
     */
    findInSession(session, tag) {
        return this.sessionOrders
            .filter(entry => entry.session === session && (tag === null || entry.tag === tag))
            .map(entry => entry.order);
    }

    /**
     * Register an algorithmic order
     * @param id
     * @param side
     * @param session
     * @param tag
     */
    startAlgoOrder(id, side, session, tag) {
        this.algorithicOrders.push({ id, side, session, tag, cancelled: false });
    }

    /**
     * Remove an order from the list
     * @param id
     */
    endAlgoOrder(id) {
        this.algorithicOrders = this.algorithicOrders.filter(item => item.id !== id);
    }

    /**
     * Determine if an algorithmic order has been cancelled or not
     * @param id
     * @returns {boolean|*}
     */
    isAlgoOrderCancelled(id) {
        const order = this.algorithicOrders.find(item => item.id === id);
        if (!order) {
            return true;
        }

        return order.cancelled;
    }

    /**
     * Ask some of the algorithmic orders to cancel
     * @param which
     * @param tag
     * @param session
     */
    cancelAlgorithmicOrders(which, tag, session) {
        this.algorithicOrders = this.algorithicOrders.map((item) => {
            const all = which === 'all';
            const buy = which === 'buy' && item.side === which;
            const sell = which === 'sell' && item.side === which;
            const tagged = which === 'tagged' && item.tag === tag;
            const cancelSession = which === 'session' && item.session === session;

            if (all || buy || sell || tagged || cancelSession) {
                item.cancelled = true;
            }

            return item;
        });
    }

    /**
     * Converts a time string (12, 12s, 12h, 12m) to an int number of seconds
     * @param time
     * @param defValue
     * @returns {number}
     */
    timeToSeconds(time, defValue = 10) {
        const regex = /([0-9]+)(d|h|m|s)?/;
        const m = regex.exec(time);
        if (m !== null) {
            const delay = parseInt(m[1], 10);

            switch (m[2]) {
                case 'm':
                    return delay * 60;

                case 'h':
                    return delay * 60 * 60;

                case 'd':
                    return delay * 60 * 60 * 24;

                default:
                    return delay;
            }
        }

        return defValue;
    }

    /**
     * Look for valid units of quantity...
     * 12, 12btc, 12usd, 12% (% of total funds) or 12%% (% of available funds)
     * @param qty
     * @returns {*}
     */
    parseQuantity(qty) {
        const regex = /^([0-9]+(\.[0-9]+)?)\s*([a-zA-Z]+|%{1,2})?$/;
        const m = regex.exec(qty);
        if (m) {
            return { value: parseFloat(m[1]), units: m[3] === undefined ? '' : m[3] };
        }

        // Does not look like a valid quantity, so treat it as zero, as that is safest
        return { value: 0, units: '' };
    }

    /**
     * Treat a number as a number or percentage. (0.01 or 1% both return 0.01)
     * @param value
     * @returns {number}
     */
    parsePercentage(value) {
        const regex = /^([0-9]+(\.[0-9]+)?)\s*(%{1,2})?$/;
        const m = regex.exec(value);
        if (m) {
            return parseFloat(m[1]) * (m[3] === '%' ? 0.01 : 1);
        }

        // Does not look like a valid quantity, so treat it as zero, as that is safest
        return 0;
    }

    /**
     * Support for named params
     * @param expected - map of expected values, with default {name: default}
     * @param named - the input argument list
     * @returns map of the arguments { name: value }
     */
    assignParams(expected, named) {
        const result = {};
        Object.keys(expected).forEach((item, i) => {
            result[item] = named.reduce((best, p) => {
                if ((p.name.toLowerCase() === item.toLowerCase()) || (p.name === '' && p.index === i)) {
                    return p.value;
                }
                return best;
            }, expected[item]);
        });

        return result;
    }

    /**
     * Execute a command on an exchange.
     * symbol - the symbol we are trading on
     * name - name of the command to execute
     * params - an array of arguments to pass the command
     */
    async executeCommand(symbol, name, params, session) {
        try {
            // Look up the command, ignoring case
            const toExecute = this.commandWhiteList.find(el => (el.toLowerCase() === name.toLowerCase()));
            if (!toExecute) {
                logger.error(`Unknown command: ${name}`);
                throw new Error('Unknown Command');
            }

            // The command is in the whitelist, so try and build and execute it
            const command = this.commands[toExecute];
            const context = { ex: this, symbol, session };
            let result = null;
            if (typeof command === 'object') {
                // new ExchangeCommand
                const CommandClass = command.class;
                const task = new CommandClass(context);
                if (task instanceof ExchangeCommand) {
                    await task.setup(params);
                    result = await this.addTask(task);
                }
            } else if (typeof command === 'function') {
                // Older function command
                result = await command(context, params);
            }

            return result;
        } catch (err) {
            if (err instanceof AbortSequenceError) {
                logger.error(`${name} FAILED. Stopping all command execution`);
                throw err;
            }

            logger.error(`${name} FAILED: ${err}`);
        }
    }

    /**
     * Given a symbol (like BTCUSD), figure out the pair (btc & usd)
     * @param symbol
     * @returns {*}
     */
    splitSymbol(symbol) {
        const regex = /^(.{3,4})(.{3})/u;
        const m = regex.exec(symbol.toLowerCase());
        if (m) {
            return { asset: m[1], currency: m[2] };
        }

        // Default to btc / usd - not sure about this...
        // should really just throw an error
        return { asset: 'btc', currency: 'usd' };
    }

    /**
     * Works out the current value of the portfolio by looking
     * at the amount of BTC and USD, and using the current price
     * Returns the value, in BTC
     * @param symbol
     * @param balances
     * @param price
     */
    balanceTotalAsset(symbol, balances, price) {
        // Work out the total value of the portfolio
        const asset = this.splitSymbol(symbol);
        const total = balances.reduce((t, item) => {
            if (item.currency === asset.currency) {
                return t + (parseFloat(item.amount) / price);
            } else if (item.currency === asset.asset) {
                return t + parseFloat(item.amount);
            }

            return t;
        }, 0);

        const roundedTotal = this.roundAsset(symbol, total);
        logger.results(`Total @ ${price}: ${roundedTotal} ${asset.asset}`);
        return roundedTotal;
    }

    /**
     * Get the balance total in the fiat currency
     * @param symbol
     * @param balances
     * @param price
     * @returns {*}
     */
    balanceTotalFiat(symbol, balances, price) {
        // Work out the total value of the portfolio
        const asset = this.splitSymbol(symbol);
        const total = balances.reduce((t, item) => {
            if (item.currency === asset.currency) {
                return t + parseFloat(item.amount);
            } else if (item.currency === asset.asset) {
                return t + (parseFloat(item.amount) * price);
            }

            return t;
        }, 0);

        const roundedTotal = this.roundPrice(symbol, total);
        logger.results(`Total @ ${price}: ${roundedTotal} ${asset.currency}`);
        return roundedTotal;
    }

    /**
     * Returns the available balance of the account, in BTC
     * This is the amount of the account that can actually be traded.
     * If it is less that the total amount, some of the value will be
     * locked up in orders, or is on the wrong side of the account
     * (eg, if you want to buy BTC, then only the available USD will
     * be taken into account).
     * @param symbol - eg BTCUSD
     * @param balances
     * @param price
     * @param side
     */
    balanceAvailableAsset(symbol, balances, price, side) {
        const asset = this.splitSymbol(symbol);
        const spendable = balances.reduce((total, item) => {
            if (side === 'buy') {
                // looking to buy BTC, so need to know USD available
                if (item.currency === asset.currency) {
                    return total + (parseFloat(item.available) / price);
                }
            } else if (item.currency === asset.asset) {
                return total + parseFloat(item.available);
            }

            return total;
        }, 0);

        const roundedTotal = this.roundAsset(symbol, spendable);
        logger.results(`Asset balance available @ ${price}: ${roundedTotal}`);
        return roundedTotal;
    }

    /**
     * Calculate the size of the order, taking into account available balance
     * @param symbol
     * @param side
     * @param amount - an amount as a number of coins or % of total worth
     * @param balances
     * @param price
     * @returns {{total: *, available: *, isAllAvailable: boolean, orderSize: *}}
     */
    calcOrderSize(symbol, side, amount, balances, price) {
        const asset = this.splitSymbol(symbol);
        const total = this.balanceTotalAsset(symbol, balances, price);
        const available = this.balanceAvailableAsset(symbol, balances, price, side);

        // calculate the order size (% or absolute, within limits, rounded)
        let orderSize = amount.value;
        if (amount.units === '%') orderSize = total * (amount.value / 100);
        if (amount.units === '%%') orderSize = available * (amount.value / 100);
        if (amount.units.toLowerCase() === asset.currency) orderSize = amount.value / price;

        // remember the order size before we cap and reduce it
        const rawOrderSize = orderSize;

        // make sure it's no more than what we have available.
        orderSize = orderSize > available ? available : orderSize;

        // Prevent silly small orders
        const minOrderSize = this.symbolData.minOrderSize(symbol);
        if (orderSize < minOrderSize) {
            logger.results(`ordersize ${orderSize} is below min order size of ${minOrderSize}`);
            orderSize = 0;
        }

        return {
            total,
            available,
            isAllAvailable: (orderSize === available),
            rawOrderSize,
            orderSize: this.roundAsset(symbol, orderSize),
        };
    }

    /**
     * Figure out the absolute price to trade at, given an offset from the current price
     * @param symbol
     * @param side
     * @param offsetStr
     * @returns {Promise<any>}
     */
    async offsetToAbsolutePrice(symbol, side, offsetStr) {
        // Look for an absolute price (eg @6250.23)
        const regex = /@([0-9]+(\.[0-9]*)?)/;
        const m = regex.exec(offsetStr);
        if (m) {
            return Promise.resolve(this.roundPrice(symbol, parseFloat(m[1])));
        }

        // must be a regular offset or % offset, so we'll need to know the current price
        const orderbook = await this.support.ticker({ ex: this, symbol });
        const offset = this.parseQuantity(offsetStr);
        if (side === 'buy') {
            const currentPrice = parseFloat(orderbook.bid);
            const finalOffset = offset.units === '%' ? currentPrice * (offset.value / 100) : offset.value;

            return this.roundPrice(symbol, currentPrice - finalOffset);
        }
        const currentPrice = parseFloat(orderbook.ask);
        const finalOffset = offset.units === '%' ? currentPrice * (offset.value / 100) : offset.value;
        return this.roundPrice(symbol, currentPrice + finalOffset);
    }

    /**
     * Gets the current ticker info
     * @param symbol
     * @returns {Promise<*>}
     */
    async ticker(symbol) {
        return this.support.ticker({ ex: this, symbol });
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
        const balances = await this.support.accountBalances({ ex: this, symbol });
        const amount = this.parseQuantity(amountStr);

        // Finally, work out the size of the order
        return this.calcOrderSize(symbol, side, amount, balances, orderPrice);
    }

    /**
     * Converts a target position size to an amount to trade
     * Default behaviour here is just to use the amount. Leveraged exchanges
     * might work out the diff needed to get to the target position and use that instead.
     * @param symbol
     * @param position - positive for long positions, negative for short positions
     * @param side
     * @param amount
     * @returns {*}
     */
    async positionToAmount(symbol, position, side, amount) {
        // First see if we work using a target position, or a fixed amount
        if (position === '') {
            // use the amount as an absolute change (units not support here)
            return Promise.resolve({ side, amount: this.parseQuantity(amount) });
        }

        // They asked for a position, instead of a side / amount compbo,
        // so work out the side and amount
        const balances = await this.support.accountBalances({ ex: this, symbol });

        // Add up all the coins on the asset side
        const asset = this.splitSymbol(symbol);
        const total = balances.reduce((t, item) => {
            if (item.currency === asset.asset) {
                return t + parseFloat(item.amount);
            }

            return t;
        }, 0);

        // We want `position`, but have `total`
        const target = parseFloat(position);
        const change = this.roundAsset(symbol, target - total);

        return { side: change < 0 ? 'sell' : 'buy', amount: { value: Math.abs(change), units: '' } };
    }

    /**
     * Find out the position size
     * @param symbol
     * @returns {Promise<*>}
     */
    async positionSize(symbol) {
        const adjustToZero = await this.positionToAmount(symbol, '0', '', '');
        if (adjustToZero.side === 'buy') {
            return -adjustToZero.amount.value;
        }

        return adjustToZero.amount.value;
    }

    /**
     * Just wait for a file, with no output
     * @param delay
     * @returns {Promise<any>}
     */
    waitSeconds(delay) {
        return new Promise((resolve) => {
            // wait the required time (plus a tiny bit to ensure other tasks get a look in)
            const waitFor = delay < 1 ? 50 : delay * 1000;
            setTimeout(() => resolve({}), waitFor);
        });
    }

    /**
     * Adds a task for processing
     * @param task
     * @returns {Promise<void>}
     */
    async addTask(task) {
        // ignore things we can't process
        if (!(task instanceof ExchangeCommand)) {
            return {};
        }

        // execute the command
        const state = await task.execute();
        if (state === CommandState.finished) {
            return task.results();
        }

        // wanted more, so push it onto the background processing list
        this.startAlgoOrder(task.id, task.hasArg('side') ? task.args.side : 'buy', task.session, task.args.tag);
        this.backgroundTasks.push({ task, state: await task.maybeRunToCompletion(state) });

        return task.results();
    }

    /**
     * Waits for background tasks to complete (if ever)
     * @returns {Promise<void>}
     */
    async waitForBackgroundTasks() {
        // probably another instance already waiting
        if (this.isAlreadyWaiting) {
            logger.info('Another process already waiting for background tasks - leave them to it.');
            return;
        }

        try {
            // note that we are waiting now...
            this.isAlreadyWaiting = true;

            // Clean out any tasks that are already done
            this.backgroundTasks = this.backgroundTasks.filter(item => item.state !== CommandState.finished);

            // Background task loop
            let waitTime = this.minPollingDelay;
            while (this.backgroundTasks.length > 0) {
                // wait a while
                await this.waitSeconds(waitTime);

                // do a pass of the background tasks
                waitTime = await this.backgroundTasksSinglePass((waitTime >= this.maxPollingDelay) ? this.maxPollingDelay : waitTime + 1);

                // remove any tasks that are finished
                this.backgroundTasks = this.backgroundTasks.filter(item => item.state !== CommandState.finished);
            }

            // note that we are done waiting now...
            this.isAlreadyWaiting = false;
        } catch (err) {
            // note that we are done waiting now...
            this.isAlreadyWaiting = false;
            throw err;
        }
    }

    /**
     * Run a single pass through the background tasks.
     * @param waitTime
     * @returns {Promise<*>}
     */
    async backgroundTasksSinglePass(waitTime) {
        let updateWait = waitTime;

        // give all the task some time to work
        for (const item of this.backgroundTasks) {
            if (this.isAlgoOrderCancelled(item.task.id)) {
                await item.task.onCancelled();
                item.state = CommandState.finished;
            } else {
                // poll the background task
                const state = await item.task.backgroundExecute();

                // drop the polling back to min if anyone wants another fast poll
                if (state === CommandState.keepGoing) {
                    updateWait = this.minPollingDelay;
                }

                // update the state in the task list
                item.state = state;
            }

            // If the command has finished, remove it from the algo order list
            if (item.state === CommandState.finished) {
                this.endAlgoOrder(item.task.id);
            }
        }

        return updateWait;
    }
}

module.exports = Exchange;