const sinon = require('sinon');
const chai = require('chai');
const aggressiveEntryOrder = require('../../src/exchanges/commands/algo/aggressive_entry');
const Exchange = require('../../src/exchanges/exchange');
const FakeTimers = require('../support/fake_timers');

const assert = chai.assert;

class MockAPI {
    ticker() {}
    walletBalances() {}
    limitOrder() {}
    order() {}
    cancelOrders() {}
}

describe('Aggressive Entry Orders', () => {
    let exchange;
    let fakeTimer;
    let ticker;
    let symbol;

    beforeEach(() => {
        fakeTimer = new FakeTimers();
        fakeTimer.start();

        symbol = 'BTCUSD';

        // runs before each test in this block
        exchange = new Exchange({});
        exchange.symbolData.update(symbol, {});

        // Build a mock API to call
        const api = new MockAPI();
        exchange.api = api;

        // Stub the ticker
        ticker = sinon.stub(api, 'ticker');
        ticker.resolves({ mid: '3025', bid: '3000', ask: '3050', last_price: '3010' });

        // Stub the wallet balances
        const wallet = sinon.stub(api, 'walletBalances');
        wallet.resolves([
            { type: 'exchange', currency: 'btc', amount: '10', available: '10' },
            { type: 'exchange', currency: 'usd', amount: '50000', available: '50000' },
        ]);
    });

    afterEach(() => {
        fakeTimer.restore();
    });

    it('can place basic aggressive entry order', async () => {
        const context = { ex: exchange, symbol };

        const limit = sinon.stub(exchange.api, 'limitOrder');
        limit.resolves({ id: 1 });

        const getOrder = sinon.stub(exchange.api, 'order');
        getOrder.resolves({ is_filled: false, is_open: true, executed: 0 });

        const cancelOrders = sinon.stub(exchange.api, 'cancelOrders');
        cancelOrders.resolves({});

        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'amount', value: '2', index: 1 },
            { name: 'tag', value: '', index: 2 },
        ];

        const finished = sinon.fake();
        aggressiveEntryOrder(context, args).then((orders) => {
            finished(orders);
        });

        // Should not have finished yet
        assert.equal(finished.callCount, 0);

        // wait a second - still not finished
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.equal(limit.callCount, 1);
        assert.deepEqual(limit.getCall(0).args, [symbol, 2, 3000, 'buy', true, false]);

        // move the price up
        ticker.resolves({ mid: '3030', bid: '3010', ask: '3050', last_price: '3010' });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.equal(limit.callCount, 2);
        assert.deepEqual(limit.getCall(1).args, [symbol, 2, 3010, 'buy', true, false]);

        // fill the order
        getOrder.resolves({ is_filled: true, is_open: false, executed: 2 });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 1);
        assert.equal(limit.callCount, 2);
    });


    it('aggressive entry order stops at time limit', async () => {
        const context = { ex: exchange, symbol };

        const limit = sinon.stub(exchange.api, 'limitOrder');
        limit.resolves({ id: 1 });

        const getOrder = sinon.stub(exchange.api, 'order');
        getOrder.resolves({ is_filled: false, is_open: true, executed: 0 });

        const cancelOrders = sinon.stub(exchange.api, 'cancelOrders');
        cancelOrders.resolves({});

        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'amount', value: '2', index: 1 },
            { name: 'timeLimit', value: '20s', index: 2 },
        ];

        const finished = sinon.fake();
        aggressiveEntryOrder(context, args).then((orders) => {
            finished(orders);
        });

        // Should not have finished yet
        assert.equal(finished.callCount, 0);

        // wait a second - still not finished
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.isTrue(limit.called);
        assert.deepEqual(limit.getCall(0).args, [symbol, 2, 3000, 'buy', true, false]);

        // move the price up
        ticker.resolves({ mid: '3030', bid: '3010', ask: '3050', last_price: '3010' });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.equal(limit.callCount, 2);
        assert.deepEqual(limit.getCall(1).args, [symbol, 2, 3010, 'buy', true, false]);

        // fill the order
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 1);
        assert.equal(limit.callCount, 2);
        assert.equal(cancelOrders.callCount, 2);
    });


    it('aggressive entry order stops at slippage limit', async () => {
        const context = { ex: exchange, symbol };

        const limit = sinon.stub(exchange.api, 'limitOrder');
        limit.resolves({ id: 1 });

        const getOrder = sinon.stub(exchange.api, 'order');
        getOrder.resolves({ is_filled: false, is_open: true, executed: 0 });

        const cancelOrders = sinon.stub(exchange.api, 'cancelOrders');
        cancelOrders.resolves({});

        ticker.resolves({ mid: '3001', bid: '3000', ask: '3001', last_price: '3000' });

        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'amount', value: '2', index: 1 },
            { name: 'slippageLimit', value: '20', index: 2 },
        ];

        const finished = sinon.fake();
        aggressiveEntryOrder(context, args).then((orders) => {
            finished(orders);
        });

        // Should not have finished yet
        assert.equal(finished.callCount, 0);

        // wait a second - still not finished
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.isTrue(limit.called);
        assert.deepEqual(limit.getCall(0).args, [symbol, 2, 3000, 'buy', true, false]);

        // move the price up
        ticker.resolves({ mid: '3011', bid: '3010', ask: '3012', last_price: '3011' });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.equal(limit.callCount, 2);
        assert.deepEqual(limit.getCall(1).args, [symbol, 2, 3010, 'buy', true, false]);

        // move the price up
        ticker.resolves({ mid: '3021', bid: '3020', ask: '3022', last_price: '3021' });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 0);
        assert.equal(limit.callCount, 3);
        assert.deepEqual(limit.getCall(2).args, [symbol, 2, 3020, 'buy', true, false]);

        // move the price up
        ticker.resolves({ mid: '3022', bid: '3022', ask: '3023', last_price: '3022' });
        await fakeTimer.tickAsync(10000, 100);
        assert.equal(finished.callCount, 1);
        assert.equal(limit.callCount, 3);
        assert.equal(cancelOrders.callCount, 3);
    });
});
