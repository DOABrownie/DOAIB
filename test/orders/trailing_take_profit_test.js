const assert = require('chai').assert;
const sinon = require('sinon');
const Exchange = require('../../src/exchanges/exchange');
const TrailingTakeProfitCommand = require('../../src/commands/trailing_takeprofit');
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


describe('Trailing take profit tests', async () => {
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

    it('can pass no arguments', async () => {
        const context = { ex: exchange, symbol: 'btcusd', session: '123' };
        const task = new TrailingTakeProfitCommand(context);

        try {
            await task.setup([]);
            await task.execute();
            assert.isOk(false, 'Should not get here');
        } catch (err) {
            assert.equal(err.message, 'No funds available or order size is 0');
        }
    });

    it('waits for trigger price and tracks upwards', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
            { name: 'triggerOffset', value: '50', index: 3 },
        ];

        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingTakeProfitCommand(context);

        await task.setup(args);
        await task.execute();
        assert.equal(await task.results(), null);

        // Update the price (still below trigger)
        ticker.resolves({ bid: '1049', ask: '1050', last_price: '1049' });
        await task.backgroundExecute();
        assert.equal(await task.results(), null);

        // Update the price (at trigger)
        ticker.resolves({ bid: '1050', ask: '1051', last_price: '1050' });
        const state = await task.backgroundExecute();
        assert.deepEqual(await task.results(), { id: 1 });

        const order = await task.results();
        assert.deepEqual(order, { id: 1 });

        // check we got the expected result
        const expected = ['BTCUSD', 1, 950, 'sell', 'last'];
        assert.equal(stopOrder.callCount, 1);
        assert.deepEqual(stopOrder.args[0], expected);
        assert.equal(state, CommandState.keepGoingBackOff);

        // Update the price (going up, so order should move)
        ticker.resolves({ bid: '1075', ask: '1076', last_price: '1076' });
        await task.backgroundExecute();
        const movedOrder = await task.results();
        assert.deepEqual(movedOrder, { id: 2 });

        const expectedUpdate = [{id:1}, 975];
        assert.equal(updateOrderPrice.callCount, 1);
        assert.deepEqual(updateOrderPrice.args[0], expectedUpdate);

    });

    it('can be cancelled before triggering', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
            { name: 'tag', value: 'test', index: 3 },
            { name: 'triggerOffset', value: '50', index: 4 },
        ];

        // start the order
        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingTakeProfitCommand(context);
        await task.setup(args);
        await exchange.addTask(task);

        // cancel it
        exchange.cancelAlgorithmicOrders('tagged', 'test', 123);
        await exchange.waitForBackgroundTasks();

        // check the order has been removed, before it was triggered
        assert.deepEqual(exchange.backgroundTasks, []);
    });

    it('can be cancelled after triggering', async () => {
        const args = [
            { name: 'side', value: 'sell', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 2 },
            { name: 'tag', value: 'test', index: 3 },
            { name: 'triggerOffset', value: '50', index: 4 },
        ];

        // start the order
        const context = { ex: exchange, symbol: 'BTCUSD', session: '123' };
        const task = new TrailingTakeProfitCommand(context);
        await task.setup(args);
        await exchange.addTask(task);

        // Update the price (at trigger)
        ticker.resolves({ bid: '1050', ask: '1051', last_price: '1050' });
        task.backgroundExecute();

        // cancel it
        exchange.cancelAlgorithmicOrders('tagged', 'test', 123);
        await exchange.waitForBackgroundTasks();

        // check the order has been removed, before it was triggered
        assert.deepEqual(exchange.backgroundTasks, []);

        const expected = ['BTCUSD', 1, 950, 'sell', 'last'];
        assert.equal(stopOrder.callCount, 1);
        assert.deepEqual(stopOrder.args[0], expected);

        const expectedCancel = [[{ id: 1 }]];
        assert.equal(cancelOrders.callCount, 1);
        assert.deepEqual(cancelOrders.args[0], expectedCancel);
    });
});
