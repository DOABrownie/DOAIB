const logger = require('../common/logger').logger;
const CommandState = require('./command_state');
const StopMarketCommand = require('./stop_market');

/**
 * Trailing stop loss order
 * Starts by creating a stop loss order, then tracks it in the background.
 * It tracks the price and moves the order if needed.
 * Note: If the initial offset is given as an absolute price (eg '@9000')
 * then we work out offset from the current price to that price, and trail by that much.
 */
class TrailingStopCommand extends StopMarketCommand {
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
            tag: new Date().toISOString(),
            background: 'true',
        }, args);

        // Make adjustments to the trailing offset, esp if offset given as absolute price
        const initialPrice = await this.ex.offsetToAbsolutePrice(this.symbol, this.args.oppositeSide, '0');
        await this.calculateTrailingOffset(initialPrice);

        logger.progress(`TRAILING STOP LOSS ORDER - ${this.ex.name}`);
        logger.progress(this.args);
    }

    /**
     * Figure out how far away the trailing offset should be
     * @param initialPrice
     * @returns {Promise<void>}
     */
    async calculateTrailingOffset(initialPrice) {
        // use the same offset to trail
        this.args.trailingOffset = this.args.offset;

        // If our original offset is expressed as an absolute price, we calculate a new offset
        // from the current price, and use that for the trailing offset.
        const regex = /@([0-9]+(\.[0-9]*)?)/;
        const m = regex.exec(this.args.trailingOffset);
        if (m) {
            this.args.trailingOffset = `${Math.abs(initialPrice - this.args.orderPrice)}`;
        }
    }

    /**
     * Execute the command
     * @returns {Promise<number>}
     */
    async execute() {
        await this.openStopOrder();

        logger.progress('Trailing Stop tracking the price...');
        return CommandState.keepGoing;
    }

    /**
     *
     * @returns {Promise<number>}
     */
    async backgroundExecute() {
        return this.trackStopOrder();
    }

    /**
     * See if the background flag is set
     * @returns {boolean}
     */
    canCompleteInBackground() {
        return this.args.background;
    }


    /**
     * Called when the task is being cancelled. Clean up.
     * @returns {Promise<void>}
     */
    async onCancelled() {
        if (this.order) {
            logger.progress('Trailing Stop order cancelling...');
            await this.ex.api.cancelOrders([this.order]);
        }
        logger.results('Trailing stop has been cancelled');
    }

    /**
     * Tracks the open stop order, waiting for it to be filled or cancelled.
     * Also tracks the current price and keeps the order the correct distance from it.
     * @returns {Promise<number>}
     */
    async trackStopOrder() {
        // See if the order is still active
        const orderInfo = await this.ex.api.order(this.order);
        if ((orderInfo !== null) && ((orderInfo.is_filled) || (!orderInfo.is_open))) {
            logger.progress('Trailing Stop Loss order filled or closed');
            return CommandState.finished;
        }

        // See if it has moved
        const suggestedOrderPrice = await this.updateTrailingOrderPrice();
        if (suggestedOrderPrice !== this.lastPrice) {
            // Move the stop
            const now = new Date().toISOString();
            logger.progress(`Trailing order moving from ${this.lastPrice} to ${suggestedOrderPrice} at ${now}`);
            const newOrder = await this.ex.api.updateOrderPrice(this.order, suggestedOrderPrice);

            // update everything
            this.ex.updateInSession(this.session, this.args.tag, this.order, newOrder);
            this.lastPrice = suggestedOrderPrice;
            this.order = newOrder;

            // go back to tight polling
            return CommandState.keepGoing;
        }

        // nothing going on, so allow the polling to back off a bit
        return CommandState.keepGoingBackOff;
    }

    /**
     * Figure out the updated price for the order and return the new suggested price for the order
     * @returns {Promise<any>}
     */
    async updateTrailingOrderPrice() {
        // work out the new order price based on the current price and the trailing offset
        const updatedOrderPrice = await this.ex.offsetToAbsolutePrice(this.symbol, this.args.oppositeSide, this.args.trailingOffset);

        // return the price that the order should be at (same as before, or at a new better price)
        if (this.args.side === 'buy') {
            return updatedOrderPrice < this.lastPrice ? updatedOrderPrice : this.lastPrice;
        }

        return updatedOrderPrice > this.lastPrice ? updatedOrderPrice : this.lastPrice;
    }
}


/**
 * Place a stop order
 */
module.exports = TrailingStopCommand;
