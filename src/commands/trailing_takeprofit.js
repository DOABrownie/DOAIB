const logger = require('../common/logger').logger;
const TrailingStopCommand = require('./trailing_stop');
const CommandState = require('./command_state');

/**
 * Trailing take profit order
 * Does nothing initially, and drops into the background watching the price.
 * When the price hits the initial trigger price, it places a trailing stop order
 * that continues to track the price, moving if needed.
 * Note: If the initial offset is given as an absolute price (eg '@9000')
 * then we work out offset from the current price to that price, and trail by that much.
 * Example, triggerOffset = 100, trailingOffset = 20, taking profit in a long.
 * Long entry at 1000, initial trigger at 1100. When the price reaches 1100,
 * then a trailing sell order will be placed at 1080 (20 below) and trail the high by
 * 20 until the order is filled or cancelled.
 */
class TrailingTakeProfitCommand extends TrailingStopCommand {
    /**
     *
     * @param context
     */
    constructor(context) {
        super(context);
        this.hasTriggered = false;
    }

    /**
     * Prepare the arguments
     * @param expected
     * @param passed
     * @returns {Promise<*>}
     */
    async prepareArguments(expected, passed) {
        await super.prepareArguments(expected, passed);
        await this.triggerOffsetToPrice();
    }

    /**
     * Prepare everything
     * @param args
     * @returns {Promise<void>}
     */
    async setup(args) {
        await this.prepareArguments({
            side: 'sell',
            amount: '0',
            position: '',
            offset: '0',
            trigger: 'last',
            triggerOffset: '1%',
            tag: new Date().toISOString(),
            background: 'true',
        }, args);

        // Adjust the trailing offset, if needed
        await this.calculateTrailingOffset(this.args.triggerPrice);

        logger.progress(`TRAILING TAKE PROFIT ORDER - ${this.ex.name}`);
        logger.progress(this.args);
    }

    /**
     * Execute the command
     * @returns {Promise<number>}
     */
    async execute() {
        // Check if the trigger offset was zero - if so, just straight in with starting the order now.

        // does nothing at this stage
        logger.progress(`Trailing take profit waiting for price to cross ${this.args.triggerPrice}.`);
        return CommandState.keepGoingBackOff;
    }

    /**
     *
     * @returns {Promise<number>}
     */
    async backgroundExecute() {
        return this.hasTriggered ? this.trackStopOrder() : this.waitForTriggerPrice();
    }

    /**
     * Check the price and see if it has crossed the trigger price yet
     * @returns {Promise<number>}
     */
    async waitForTriggerPrice() {
        const ticker = await this.ex.ticker(this.symbol);
        const price = (this.args.side === 'sell') ?
            Math.max(ticker.bid, ticker.ask, ticker.last_price) :
            Math.min(ticker.bid, ticker.ask, ticker.last_price);

        const hasCrossed = (this.args.side === 'sell') ? price >= this.args.triggerPrice : price <= this.args.triggerPrice;
        if (hasCrossed) {
            logger.progress('Trailing take profit triggered. Placing trailing stop order.');
            this.hasTriggered = true;

            // Work out the correct offset price and place the stop order
            await this.offsetToPrice(this.args.oppositeSide);
            await this.openStopOrder();
        }

        return CommandState.keepGoingBackOff;
    }

    /**
     * work out the price from the offset
     * @returns {Promise<void>}
     */
    async triggerOffsetToPrice() {
        if ((!this.hasArg('side')) || (!this.hasArg('triggerOffset'))) {
            return;
        }

        this.args.triggerPrice = await this.ex.offsetToAbsolutePrice(this.symbol, this.args.side, this.args.triggerOffset);
    }
}


/**
 * Place a stop order
 */
module.exports = TrailingTakeProfitCommand;
