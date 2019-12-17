const assert = require('chai').assert;
const nock = require('nock');
const Api = require('../../src/apis/');


describe(' API', async () => {
    it('start it add a symbol', async () => {
        const scope = nock('https://test.deribit.com/api/v1')
            .get('/api/v1/public/getinstruments?expired=false')
            .reply(200, { result: [{ instrumentName: 'BTC-PERPETUAL' }] });

        const api = new Api('key', 'secret');
        await api.addSymbol('BTC-PERPETUAL');
        scope.done();
    });

    it('can request a ticker', async () => {
        const scope = nock('https://www..com')
            .get('/api/v1/public/getorderbook?instrument=BTC-PERPETUAL')
            .reply(200, {
                result: {
                    instrument: 'BTC-PERPETUAL',
                    bids: [
                        {
                            quantity: 800,
                            price: 10322.56,
                            cm: 800,
                        },
                    ],
                    asks: [
                        {
                            quantity: 510,
                            price: 10334.06,
                            cm: 510,
                        },
                    ],
                    last: 10350,
                },
            });

        const api = new Api('key', 'secret');
        const ticker = await api.ticker('BTC-PERPETUAL');
        assert.deepEqual(ticker, { bid: '10322.56', ask: '10334.06', last_price: '10350' });
        scope.done();
    });
});
