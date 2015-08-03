var reduce = require('../lib/reduce.js');

module.exports = {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList']
    },
    {
      name: 'multiplier',
      types: ['seriesList', 'number']
    }
  ],
  help: 'Multiply the values of one or more series in a seriesList to each position, in each series, of the input seriesList',
  fn: function multiplyFn(args) {
    return reduce(args, function (a, b) {
      return a * b;
    });
  }
};
