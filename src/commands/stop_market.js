const logger = require('../common/logger').logger;
const ExchangeCommand = require('./exchange_command');
const CommandState = require('./command_state');

/**
 * Stop market order
 * Places a stop market order
 */
class StopMarketCommand extends ExchangeCommand {
    /**
     * @param context
     */
    constructor(context) {
        super(context);
        this.order = null;
        this.lastPrice = 0;
    }

    /**
     * Prepare the arguments
     * @param expected
     * @param passed
     * @returns {Promise<*>}
     */
    async prepareArguments(expected, passed) {
        await super.prepareArguments(expected, passed);
        await this.offsetToPrice(this.args.oppositeSide);
        await this.validateTrigger();
    }

    /**
     * Prepare everything
     * @param args
     * @returns {Promise<void>}
     */
    async setup(args) {
        await this.prepareArguments({
            side: 'buy',
            offset: '0',
            amount: '0',
            position: '',
            trigger: 'mark',
            tag: new Date().toISOString(),
        }, args);

        logger.progress(`STOP LOSS MARKET ORDER - ${this.ex.name}`);
        logger.progress(this.args);
    }

    /**
     * Execute the command
     * @returns {Promise<number>}
     */
    async execute() {
        // open the order
        await this.openStopOrder();

        // We're done
        return CommandState.finished;
    }

    /**
     * a route to being able to return a result from the command
     * @returns {Promise<{}>}
     */
    async results() {
        return this.order;
    }

    /**
     * Places the initial stop order that we'll track later.
     * @returns {Promise<number>}
     */
    async openStopOrder() {
        const p = this.args;
        this.order = await this.ex.api.stopOrder(this.symbol, p.amount, p.orderPrice, p.side, p.trigger);
        this.lastPrice = p.orderPrice;
        this.ex.addToSession(this.session, p.tag, this.order);

        logger.results('Stop market order placed.');
        logger.dim(this.order);
    }
}


/**
 * Place a stop order
 */
module.exports = StopMarketCommand;
