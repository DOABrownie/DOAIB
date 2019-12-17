const assert = require('chai').assert;
const expect = require('chai').expect;
const sinon = require('sinon');
const Exchange = require('../src/exchanges/exchange');
const ExchangeCommand = require('../src/commands/exchange_command');

describe('Exchange Command Test', () => {
    it('can set default values', async () => {
        const ex = new Exchange();

        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        const expected = { test: 'example' };
        await cmd.prepareArguments(expected, []);

        assert.deepEqual(cmd.args, expected, 'default params should be set');
    });

    it('can override defaults', async () => {
        const ex = new Exchange();

        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { test: 'example', unchanged: 'not changed' };
        const passed = [
            { name: 'test', value: 'passed', index: 0 },
            { name: 'another', value: 'addon', index: 1 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);

        const expected = { test: 'passed', unchanged: 'not changed' };
        assert.deepEqual(cmd.args, expected, 'default params should be set');
    });

    it('can clean up side', async () => {
        const ex = new Exchange();

        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy' };
        const passed = [
            { name: 'side', value: 'Buy', index: 0 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);

        const expected = { side: 'buy', oppositeSide: 'sell' };
        assert.deepEqual(cmd.args, expected);
    });

    it('throws an error when side is not valid', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy' };
        const passed = [
            { name: 'side', value: 'fish', index: 0 },
        ];

        return cmd.prepareArguments(defaultArgs, passed)
            .then((m) => { throw new Error('was not supposed to succeed'); })
            .catch((m) => { expect(m.message).to.equal('side must be buy or sell'); });
    });

    it('ignores position when side and amount given priority', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy', amount: '0', position: '' };
        const passed = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'amount', value: '42', index: 0 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);
        const expected = { side: 'buy', oppositeSide: 'sell', amount: '42', position: '' };
        assert.deepEqual(cmd.args, expected);
    });

    it('ignores side and amount when position given priority', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Build a mock API to call
        class MockAPI { walletBalances() {}}
        const api = new MockAPI();
        ex.api = api;

        // Mock out the function for testing
        const wallet = [
            {
                type: 'exchange',
                currency: 'btc',
                amount: '10',
                available: '10',
            },
        ];
        const mock = sinon.mock(api);
        mock.expects('walletBalances').once().returns(Promise.resolve(wallet));

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy', amount: '0', position: '' };
        const passed = [
            { name: 'position', value: '42', index: 0 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);
        const expected = { side: 'buy', oppositeSide: 'sell', amount: '32', position: '42' };
        assert.deepEqual(cmd.args, expected);
    });

    it('converts offset to price', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Build a mock API to call
        class MockAPI {
            ticker() {}
        }
        const api = new MockAPI();
        ex.api = api;

        // Mock out the function for testing
        const ticker = {
            symbol: 'btcusd',
            bid: '1000',
            ask: '1010',
            last_price: '1000',
        };
        const mock = sinon.mock(api);
        mock.expects('ticker').once().returns(Promise.resolve(ticker));

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy', offset: '0' };
        const passed = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'offset', value: '75', index: 1 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);
        const expected = {
            side: 'buy',
            oppositeSide: 'sell',
            offset: '75',
            orderPrice: 925,    // 75 down from bid
        };
        assert.deepEqual(cmd.args, expected);
    });

    it('limits order size based on available funds', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Build a mock API to call
        class MockAPI {
            walletBalances() {}
            ticker() {}
        }
        const api = new MockAPI();
        ex.api = api;

        // Mock out the function for testing
        const ticker = {
            symbol: 'btcusd',
            bid: '1000',
            ask: '1010',
            last_price: '1000',
        };
        const wallet = [
            {
                type: 'exchange',
                currency: 'usd',
                amount: '2700',
                available: '1800',
            },
        ];
        const mock = sinon.mock(api);
        mock.expects('ticker').once().returns(Promise.resolve(ticker));
        mock.expects('walletBalances').once().returns(Promise.resolve(wallet));

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { side: 'buy', amount: '0', offset: '0' };
        const passed = [
            { name: 'side', value: 'buy', index: 0 },
            { name: 'offset', value: '100', index: 1 },
            { name: 'amount', value: '10', index: 2 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);
        const expected = {
            side: 'buy',
            oppositeSide: 'sell',
            offset: '100',
            orderPrice: 900,
            amount: 2,
            originalAmount: 10,
        };
        assert.deepEqual(cmd.args, expected);
    });

    it('validate trigger settings', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { trigger: 'mark' };
        const passed = [
            { name: 'trigger', value: 'Index', index: 0 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);

        const expected = { trigger: 'index' };
        assert.deepEqual(cmd.args, expected);
    });

    it('defaults trigger to last when given bad data', async () => {
        const ex = new Exchange();
        const cmd = new ExchangeCommand({ ex, symbol: 'BTCUSD' });

        // Default should be replaced, 'another' should be ignored
        const defaultArgs = { trigger: 'mark' };
        const passed = [
            { name: 'trigger', value: 'fish', index: 0 },
        ];

        await cmd.prepareArguments(defaultArgs, passed);

        const expected = { trigger: 'last' };
        assert.deepEqual(cmd.args, expected);
    });
});
