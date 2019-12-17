const Bitfinex = require('./bitfinex');
const Deribit = require('./deribit');
const Coinbase = require('./coinbase');
const Null = require('./null');

// A list of all the supported exchanges
module.exports = [
    {
        name: 'bitfinex',
        description: 'Bitfinex',
        class: Bitfinex,
    },
    {
        name: 'deribit',
        description: 'Deribit',
        class: Deribit,
    },
    {
        name: 'coinbase',
        description: 'Coinbase Pro',
        class: Coinbase,
    },
    {
        name: 'null',
        description: 'Null',
        class: Null,
    },
];
