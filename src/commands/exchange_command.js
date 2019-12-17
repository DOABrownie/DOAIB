const uuid = require('uuid/v4');
const logger = require('../common/logger').logger;
const CommandState = require('./command_state');

class ExchangeCommand {
    /**
     *
     * @param context
     */
    constructor(context) {
        const { ex = {}, symbol = '', session = '' } = context;
        this.context = context;
        this.ex = ex;
        this.symbol = symbol;
        this.session = session;
        this.args = {};
        this.id = uuid();
    }

    /**
     * called to prepare the command for action (process arguments really)
     * @param _args
     * @returns {Promise<void>}
     */
    async setup(_args) {
        logger.error('setup() not implemented');
    }

    /**
     * executes the command. Should returned finished, keepGoing or keepGoingBackOff
     * @returns {Promise<number>}
     */
    async execute() {
        logger.error('execute() not implemented');
        return CommandState.finished;
    }

    /**
     * Called while performing background steps. Called every few seconds
     * Should returned finished, keepGoing or keepGoingBackOff to indicate if it needs more time
     * @returns {Promise<number>}
     */
    async backgroundExecute() {
        return CommandState.finished;
    }

    /**
     * returns true to allow the task to push to the background
     * false to wait for completion and not let the next command execute until we are done
     * @returns {boolean}
     */
    canCompleteInBackground() {
        return true;
    }

    /**
     * Offers the task a chance to run to completion, without being pushed into the background
     * If it returns a 'more work needed' state, then it will go into the background.
     * Returning Finished will treat it as done and the task will do no additional processing.
     * Tasks that want to run to completion can use this notification to call runToCompletion()
     * @param state
     * @returns {Promise<*>}
     */
    async maybeRunToCompletion(state) {
        // If we were already done, stay done.
        if (state === CommandState.finished) {
            return state;
        }

        // If we would prefer to complete in the background, do that
        if (this.canCompleteInBackground()) {
            return state;
        }

        // We want to complete now...
        await this.runToCompletion();

        // State that we are done now.
        return CommandState.finished;
    }

    /**
     * Runs this task to completion, looping and waiting until the task reaches the finished state.
     * This operates the run looping, polling the command automatically using the same interface as
     * the background tasks. The task does not need to know which way things are happening.
     * @returns {Promise<void>}
     */
    async runToCompletion() {
        // Background task loop
        logger.progress('running command to completion...');
        let waitTime = this.ex.minPollingDelay;
        let state = CommandState.keepGoing;
        while (state !== CommandState.finished) {
            // wait a while
            await this.ex.waitSeconds(waitTime);
            waitTime = (waitTime >= this.ex.maxPollingDelay) ? this.ex.maxPollingDelay : waitTime + 1;

            // If the task has been added as an algo order, see if it has been cancelled.
            if (this.ex.isAlgoOrderCancelled(this.id)) {
                await this.onCancelled();
                state = CommandState.finished;
            } else {
                // poll the background task
                state = await this.backgroundExecute();

                // drop the polling back to min if anyone wants another fast poll
                if (state === CommandState.keepGoing) {
                    waitTime = this.ex.minPollingDelay;
                }
            }

            // If the command has finished, remove it from the algo order list
            if (state === CommandState.finished) {
                this.ex.endAlgoOrder(this.id);
            }
        }
    }

    /**
     * Called when the task is being cancelled. Clean up.
     * @returns {Promise<void>}
     */
    async onCancelled() {
        // cancel self
    }

    /**
     * a route to being able to return a result from the command
     * @returns {Promise<{}>}
     */
    async results() {
        return {};
    }

    /**
     * Helper to process command arguments. Does some standard validation and expansion
     * @param expected
     * @param passed
     * @returns {Promise<{}|*>}
     */
    async prepareArguments(expected, passed) {
        // map the arguments
        this.args = this.ex.assignParams(expected, passed);

        // These have no dependencies and just ensure values are mapped
        // to internal types correctly and consistently.
        await this.validateSide();
        await this.validateTrigger();
        await this.validateBackground();

        // these three depend on side and some values from the previous one
        // so the order of these 3 functions matters.
        await this.calculatePosition();
        await this.offsetToPrice(this.args.side);
        await this.calculateAmount();
    }

    /**
     * Prepare the 'side' argument
     * @returns {Promise<void>}
     */
    async validateSide() {
        if (!this.hasArg('side')) {
            return;
        }

        // validate the side
        this.args.side = this.args.side.toLowerCase();
        if ((this.args.side !== 'buy') && (this.args.side !== 'sell')) {
            throw new Error('side must be buy or sell');
        }

        // work out the opposite side (handy in some cases)
        this.args.oppositeSide = (this.args.side === 'buy') ? 'sell' : 'buy';
    }

    /**
     * work out the price from the offset
     * @param side
     * @returns {Promise<void>}
     */
    async offsetToPrice(side) {
        if ((side === undefined) || (!this.hasArg('offset'))) {
            return;
        }

        this.args.orderPrice = await this.ex.offsetToAbsolutePrice(this.symbol, side, this.args.offset);
    }

    /**
     * Work out the order size, based on position, side and amount
     * @returns {Promise<void>}
     */
    async calculatePosition() {
        // Only do this if side, amount and position are present in the arguments
        if ((!this.hasArg('side')) || (!this.hasArg('amount')) || (!this.hasArg('position'))) {
            return;
        }

        // Figure out the amount to trade
        const modifiedPosition = await this.ex.positionToAmount(this.symbol, this.args.position, this.args.side, this.args.amount);
        if (modifiedPosition.amount.value === 0) {
            logger.results('Calculated order size as Zero.');
            throw new Error('No funds available or order size is 0');
        }

        this.args.side = modifiedPosition.side;
        this.args.amount = `${modifiedPosition.amount.value}${modifiedPosition.amount.units}`;
        this.args.oppositeSide = (this.args.side === 'buy') ? 'sell' : 'buy';
    }

    /**
     * Calculate the amount of the order, based on desired amount, side and order price
     * Limits you to what you have.
     * @returns {Promise<void>}
     */
    async calculateAmount() {
        // Only do this if side, amount and position are present in the arguments
        if ((!this.hasArg('side')) || (!this.hasArg('orderPrice')) || (!this.hasArg('amount'))) {
            return;
        }

        // Go work out the amount from the information we have
        const adjusted = await this.ex.orderSizeFromAmount(this.symbol, this.args.side, this.args.orderPrice, this.args.amount);
        this.args.amount = adjusted.orderSize;
        this.args.originalAmount = adjusted.rawOrderSize;

        // did it end up at zero?
        if (this.args.amount === 0) {
            throw new Error('No funds available or order size is 0');
        }
    }

    /**
     * Validate the values for 'trigger'
     * @returns {Promise<void>}
     */
    async validateTrigger() {
        if (!this.hasArg('trigger')) {
            return;
        }

        // make sure trigger is a supported value
        this.args.trigger = this.args.trigger.toLowerCase();
        if (this.args.trigger !== 'mark' && this.args.trigger !== 'index' && this.args.trigger !== 'last') {
            logger.error(`Trigger of ${this.args.trigger} not supported. Defaulting to 'last' price`);
            this.args.trigger = 'last';
        }
    }

    /**
     * Looks for the 'background' arg and forces it to be true or false. defaults to true
     * @returns {Promise<void>}
     */
    async validateBackground() {
        if (!this.hasArg('background')) {
            return;
        }

        // force the value to a bool "true" is true, anything else is false.
        this.args.background = (this.args.background.toLowerCase() === 'true');
    }

    /**
     * Does the given arg exist
     * @param name
     * @returns {boolean}
     */
    hasArg(name) {
        return this.args.hasOwnProperty(name);
    }
}

module.exports = ExchangeCommand;
