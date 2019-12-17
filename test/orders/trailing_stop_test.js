const assert = require('chai').assert;
const sinon = require('sinon');
const Exchange = require('../../src/exchanges/exchange');
const TrailingStopCommand = require('../../src/commands/trailing_stop');
const CommandState = require('../../src/commands/command_state');
const logger = require('../../src/common/logger').logger;


class MockAPI {
    ticker() {}
    walletBalances() {}
    order() {}
    stopOrder() {}
    updateOrderPrice() {}
    cancelOrders() {}
}


describe('Trailing stop tests', async () => {
    const exchange = new Exchange({});
    let ticker = null;
    let stopOrder = null;
    let updateOrderPrice = null;
    let getOrder = null;
    let cancelOrders = null;

    beforeEach(() => {
        // Build a mock API to call
        const api = new MockAPI();
        exchange.api = api;

        // Stub the ticker
        ticker = sinon.stub(api, 'ticker');
        ticker.resolves({ bid: '1000', ask: '1001', last_price: '1000' });

        // Stub the wallet balances
        const wallet = sinon.stub(api, 'walletBalances');
        wallet.resolves([
            { type: 'exchange', currency: 'btc', amount: '10', available: '10' },
            { type: 'exchange', currency: 'usd', amount: '50000', available: '50000' },
        ]);

        getOrder = sinon.stub(api, 'order');
        getOrder.resolves({
            id: 1,
            ordType: 'stop',
            side: 'sell',
            amount: 1,
            remaining: 1,
            executed: 0,
            is_filled: false,
            is_open: true,
        });

        stopOrder = sinon.stub(api, 'stopOrder');
        stopOrder.resolves({ id: 1 });

        updateOrderPrice = sinon.stub(api, 'updateOrderPrice');
        updateOrderPrice.resolves({ id: 2 });

        cancelOrders = sinon.stub(api, 'cancelOrders');
        cancelOrders.resolves({ id: 1 });
    });

    it('can calculate trailing offset correctly', async () => {
        const context = { ex: null, symbol: 'btcusd', session: '123' };
        const stop = new TrailingStopCommand(context);

        // test relative offset
        stop.args.offset = '10';
        stop.args.orderPrice = 990;
        await stop.calculateTrailingOffset(1000);
        assert.equal(stop.args.trailingOffset, 10);

        // test percentage offset
        stop.args.offset = '5%';
        stop.args.orderPrice = 950;
        await stop.calculateTrailingOffset(1000);
        assert.equal(stop.args.trailingOffset, '5%');

        // test absolute offset
        stop.args.offset = '@900';
        stop.args.orderPrice = 900;
        await stop.calculateTrailingOffset(1000);
        assert.equal(stop.args.trailingOffset, '100');
    });

    it('can pass no arguments', async () => {
        const context = { ex: exchange, symbol: 'btcusd', session: '123' };
        const task = new TrailingStopCommand(context);

        try {
            await task.setup([]);
            await task.execute();
            assert.isOk(false, 'Should not get here');
        } catch (err) {
            assert.equal(err.message, 'No funds available or order size is 0');
        }
    });

    it('can place a trailing stop', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
        ];

        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingStopCommand(context);

        await task.setup(args);
        const state = await task.execute();
        const order = await task.results();

        const expected = ['BTCUSD', 1, 900, 'sell', 'last'];
        assert.deepEqual(order, { id: 1 });
        assert.equal(stopOrder.callCount, 1);
        assert.deepEqual(stopOrder.args[0], expected);
        assert.equal(state, CommandState.keepGoing);
    });

    it('finishes when the order is filled', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
        ];

        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingStopCommand(context);

        await task.setup(args);
        await task.execute();

        // mark the order as filled
        getOrder.resolves({
            id: 1,
            ordType: 'stop',
            side: 'sell',
            amount: 1,
            remaining: 0,
            executed: 1,
            is_filled: true,
            is_open: false,
        });

        // run one background loop with the filled order
        const state = await task.backgroundExecute();
        const order = await task.results();

        // check we got the expected result
        assert.deepEqual(order, { id: 1 });
        assert.equal(state, CommandState.finished);
    });

    it('can update the trailing stop', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
        ];

        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingStopCommand(context);

        await task.setup(args);
        await task.execute();

        // Update the price
        ticker.resolves({ bid: '1050', ask: '1051', last_price: '1050' });

        // run one background loop with the new price
        const state = await task.backgroundExecute();
        const order = await task.results();

        // check we got the expected result
        const expected = [{ id: 1 }, 950];
        assert.deepEqual(order, { id: 2 });
        assert.equal(updateOrderPrice.callCount, 1);
        assert.deepEqual(updateOrderPrice.args[0], expected);
        assert.equal(state, CommandState.keepGoing);
    });

    it('does not update the stop if the price moves towards the stop', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
        ];

        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingStopCommand(context);

        await task.setup(args);
        await task.execute();

        // Update the price
        ticker.resolves({ bid: '990', ask: '991', last_price: '991' });

        // run one background loop with the new price
        const state = await task.backgroundExecute();
        const order = await task.results();

        // check we got the expected result
        assert.deepEqual(order, { id: 1 });
        assert.equal(updateOrderPrice.callCount, 0);
        assert.equal(state, CommandState.keepGoingBackOff);
    });

    it('can be cancelled', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
            { name: 'tag', value: 'test', index: 3 },
        ];

        // start the order
        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingStopCommand(context);
        await task.setup(args);
        await exchange.addTask(task);
        const order = await task.results();

        // cancel it
        exchange.cancelAlgorithmicOrders('tagged', 'test', 123);
        await exchange.waitForBackgroundTasks();

        // check we got the expected result
        const expected = [[{ id: 1 }]];
        assert.equal(cancelOrders.callCount, 1);
        assert.deepEqual(cancelOrders.args[0], expected);

        // Check that the order was actually placed as expected
        const expectedStop = ['BTCUSD', 1, 900, 'sell', 'last'];
        assert.deepEqual(order, { id: 1 });
        assert.equal(stopOrder.callCount, 1);
        assert.deepEqual(stopOrder.args[0], expectedStop);
    });
});
