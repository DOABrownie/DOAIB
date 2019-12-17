const assert = require('chai').assert;
const sinon = require('sinon');
const ExchangeManager = require('../src/exchanges/manager');
const Exchange = require('../src/exchanges/exchange');


describe('Exchange Manager tests', () => {
    it('can see when there is no matching exchange', () => {
        const manager = new ExchangeManager([]);
        const nothing = manager.findOpened('test', {});
        assert.equal(nothing, undefined);
    });

    it('can ask for an exchange that does not exist', async () => {
        const manager = new ExchangeManager([]);
        const ex = await manager.openExchange('test', {});
        assert.isNull(ex);
    });

    it('can create an exchange when asked', async () => {
        class DummyExchange { init() {} validate() { return 'valid'; }}
        const manager = new ExchangeManager([{ name: 'test', class: DummyExchange }]);
        const ex = await manager.openExchange('test', { exchange: 'test' });
        assert.equal(ex.validate(), 'valid');
    });

    it('can find the exchange when its there', async () => {
        const manager = new ExchangeManager([{ name: 'test', class: Exchange }]);
        const ex = await manager.openExchange('test', {});
        const ex2 = await manager.openExchange('test', {});
        assert.deepEqual(ex, ex2);
    });

    it('can close exchanges that dont exist', async () => {
        const manager = new ExchangeManager([]);
        const ex = new Exchange({});
        manager.closeExchange(null);
        manager.closeExchange(ex);
    });

    it('can close exchanges that do exist', async () => {
        const manager = new ExchangeManager([{ name: 'test', class: Exchange }]);
        const ex = await manager.openExchange('test', { exchange: 'test' });
        assert.lengthOf(manager.opened, 1);
        await manager.closeExchange(ex);
        assert.lengthOf(manager.opened, 0);
    });
});
