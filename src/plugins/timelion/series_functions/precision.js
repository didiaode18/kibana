var reduce = require('../lib/reduce.js');

module.exports = {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList']
    },
    {
      name: 'precision',
      types: ['number']
    }
  ],
  help: 'number of digits to round the decimal portion of the value to',
  fn: function precisionFn(args) {
    return reduce(args, function (a, b) {
      return parseInt(a * Math.pow(10, b), 10) / Math.pow(10, b);
    });
  }
};
