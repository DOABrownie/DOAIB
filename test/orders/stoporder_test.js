const assert = require('chai').assert;
const sinon = require('sinon');
const Exchange = require('../../src/exchanges/exchange');
const StopOrderCommand = require('../../src/commands/stop_market');
const logger = require('../../src/common/logger').logger;

class MockAPI {
    ticker() {}
    walletBalances() {}
    stopOrder() {}
}


describe('Stop Orders', async () => {
    const exchange = new Exchange({});
    let stop;

    beforeEach(() => {
        // runs before each test in this block

        // Build a mock API to call
        const api = new MockAPI();
        exchange.api = api;

        // Stub the ticker
        const ticker = sinon.stub(api, 'ticker');
        ticker.resolves({ mid: '3025', bid: '3000', ask: '3050', last_price: '3010' });

        // Stub the wallet balances
        const wallet = sinon.stub(api, 'walletBalances');
        wallet.resolves([
            { type: 'exchange', currency: 'btc', amount: '10', available: '10' },
            { type: 'exchange', currency: 'usd', amount: '50000', available: '50000' },
        ]);

        stop = sinon.stub(api, 'stopOrder');
        stop.resolves({ id: 1 });
    });


    it('can place a stop order', async () => {
        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 1 },
        ];

        const stopOrder = new StopOrderCommand({ ex: exchange, symbol: 'BTCUSD', session: 'test-session' });
        await stopOrder.setup(args);
        await stopOrder.execute();

        const order = await stopOrder.results();

        assert.deepEqual(order, { id: 1 });
        assert.isTrue(stop.calledWith('BTCUSD', 1, 3150, 'buy', 'mark'));
    });


    it('defaults to the mark price', async () => {
        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 1 },
            { name: 'trigger', value: 'fish ', index: 1 },
        ];

        const stopOrder = new StopOrderCommand({ ex: exchange, symbol: 'BTCUSD', session: 'test-session' });
        await stopOrder.setup(args);
        await stopOrder.execute();

        const order = await stopOrder.results();
        const expected = ['BTCUSD', 1, 3150, 'buy', 'last'];

        assert.deepEqual(order, { id: 1 });
        assert.deepEqual(stop.args[0], expected);
    });

    it('can link to index price', async () => {
        const args = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '1', index: 1 },
            { name: 'trigger', value: 'index', index: 1 },
        ];

        const stopOrder = new StopOrderCommand({ ex: exchange, symbol: 'BTCUSD', session: 'test-session' });
        await stopOrder.setup(args);
        await stopOrder.execute();

        const order = await stopOrder.results();
        const expected = ['BTCUSD', 1, 3150, 'buy', 'index'];

        assert.deepEqual(order, { id: 1 });
        assert.deepEqual(stop.args[0], expected);
    });

    it('can ignore zero sized orders', async () => {
        try {
            const args = [
                { name: 'side', value: 'buy', index: 0 },
                { name: 'offset', value: '100', index: 1 },
                { name: 'amount', value: '0', index: 1 },
                { name: 'trigger', value: 'index', index: 1 },
            ];

            const stopOrder = new StopOrderCommand({ ex: exchange, symbol: 'BTCUSD', session: 'test-session' });
            await stopOrder.setup(args);
            await stopOrder.execute();
            await stopOrder.results();

            assert.isTrue(false, 'should not get here');
        } catch (err) {
            assert.isTrue(stop.notCalled);
        }
    });
});
