
var _ = require('lodash');
var glob = require('glob');
var Promise = require('bluebird');
var path = require('path');

var fs = require('fs');
var grammar = fs.readFileSync(path.resolve(__dirname, 'chain.peg'), 'utf8');
var PEG = require('pegjs');
var Parser = PEG.buildParser(grammar);
var parseDateMath = require('../lib/date_math.js');

var config = require('../timelion.json');

var tlConfig = {
  time: {
    min: parseDateMath('now-12M').valueOf(),
    max: parseDateMath('now').valueOf(),
  },
  file: config
};

var stats = {};

// Load function plugins
var functions  = _.chain(glob.sync(path.resolve(__dirname, '../series_functions/*.js'))).map(function (file) {

  console.log(file);
  var fnName = file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.'));
  return [fnName, require('../series_functions/' + fnName + '.js')];
}).zipObject().value();

function getQueryCacheKey(query) {
  return JSON.stringify(_.omit(query, 'label'));
}

var sheet;
var queryCache = {};

function argType(arg) {
  if (_.isObject(arg) && arg) {
    return arg.type;
  }
  if (arg == null) {
    return 'null';
  }
  return typeof arg;
}

function repositionArguments(functionDef, unorderedArgs) {
  var args = [];

  _.each(unorderedArgs, function (unorderedArg, i) {
    if (_.isObject(unorderedArg) && unorderedArg.type === 'namedArg') {

      var argIndex = _.findIndex(functionDef.args, function (orderedArg) {
        return unorderedArg.name === orderedArg.name;
      });

      args[argIndex] = unorderedArg.value;
    } else {
      args[i] = unorderedArg;
    }
  });

  return args;
}

// Invokes a modifier function, resolving arguments into series as needed
function invoke(fnName, args) {
  var functionDef = functions[fnName];
  args = repositionArguments(functionDef, args);
  args = _.map(args, function (item) {

    if (_.isObject(item)) {
      switch (item.type) {
        case 'function':
          if (queryCache[getQueryCacheKey(item)]) {
            stats.queryCount++;
            return Promise.resolve(_.cloneDeep(queryCache[getQueryCacheKey(item)]));
          }
          return invoke(item.function, item.arguments);
        case 'reference':
          var reference = sheet[item.plot - 1][item.series - 1];
          return invokeChain(reference);
        case 'chain':
          return invokeChain(item);
        case 'chainList':
          return resolveChainList(item.list);
        case 'seriesList':
          return item;
      }
      throw new Error ('Argument type not supported: ' + JSON.stringify(item));
    }
    return item;
  });


  return Promise.all(args).then(function (args) {
    if (!functions[fnName]) {
      throw new Error('Function not found');
    }

    if (args.length > functionDef.args.length) {
      throw new Error ('Too many arguments passed to: ' + fnName);
    }

    _.each(args, function (arg, i) {
      var type = argType(arg);
      var required = functionDef.args[i].types;
      var name = functionDef.args[i].name;

      if (!(_.contains(required, type))) {
        throw new Error (fnName + '(' + name + ') must be one of ' + JSON.stringify(required) + '. Got: ' + type);
      }
    });
    return functionDef.fn(args, tlConfig);
  });
}

function invokeChain(chainObj, result) {
  if (chainObj.chain.length === 0) {
    return result[0];
  }

  var chain = _.clone(chainObj.chain);
  var link = chain.shift();

  var promise;
  if (link.type === 'chain') {
    promise = invokeChain(link);
  } else if (!result) {
    promise = invoke('first', [link]);
  } else {
    var args = link.arguments ? result.concat(link.arguments) : result;
    promise = invoke(link.function, args);
  }

  return promise.then(function (result) {
    return invokeChain({type:'chain', chain: chain}, [result]);
  });

}

function resolveChainList(chainList) {
  var seriesList = _.map(chainList, function (chain) {
    var values = invoke('first', [chain]);
    return values.then(function (args) {
      return args;
    });
  });
  return Promise.all(seriesList).then(function (args) {
    var list = _.chain(args).pluck('list').flatten().value();
    return {type: 'seriesList', list: list};
  });
}

function preProcessSheet(sheet) {
  var queries = [];

  function storeQueryObj(query) {
    var cacheKey = getQueryCacheKey(query);
    queries[cacheKey] = query;
  }

  function validateAndCache(chain) {

    function checkFunc(func) {
      if (_.isObject(func) && func.type === 'function') {
        if (!functions[func.function]) {
          throw new Error('Unknown function: ' + func.function);
        }

        if (functions[func.function].dataSource) {
          storeQueryObj(func);
          return true;
        } else {
          return false;
        }
      }
    }

    if (checkFunc(chain) || !_.isArray(chain)) {
      return;
    }

    _.each(chain, function (operator) {
      if (!_.isObject(operator)) {
        return;
      }
      switch (operator.type) {
      case 'chain':
        validateAndCache(operator.chain);
        break;
      case 'chainList':
        validateAndCache(operator.list);
        break;
      case 'function':
        if (checkFunc(operator)) {
          break;
        } else {
          validateAndCache(operator.arguments);
        }
        break;
      }
    });
  }

  _.each(sheet, function (chainList) {
    validateAndCache(chainList);
  });

  queries = _.values(queries);

  var promises = _.map(queries, function (item) {
    return invoke(item.function, item.arguments);
  });

  return Promise.all(promises).then(function (results) {
    _.each(queries, function (item, i) {
      queryCache[getQueryCacheKey(item)] = results[i];
    });

    stats.cacheCount = _.keys(queryCache).length;
    stats.queryTime = (new Date()).getTime();
    return queryCache;
  });
}



function resolveSheet(sheet) {
  return _.map(sheet, function (plot) {
    try {
      return Parser.parse(plot);
    } catch (e) {
      throw new Error('Expected: ' + e.expected[0].description + ' @ character ' + e.column);
    }
  });
}

function processRequest(request) {
  if (!request) {
    throw new Error('Empty request body');
  }
  tlConfig.time = request.time;

  stats.invokeTime = (new Date()).getTime();
  stats.queryCount = 0;
  queryCache = {};
  // This is setting the "global" sheet
  sheet = resolveSheet(request.sheet);


  return preProcessSheet(sheet).then(function () {
    return _.map(sheet, function (chainList) {
      return resolveChainList(chainList).then(function (seriesList) {
        stats.sheetTime = (new Date()).getTime();
        return seriesList.list;
      });
    });
  });
}

module.exports = {
  processRequest: processRequest,
  getStats: function () { return stats; }
};


function logObj(obj, thing) {
  return JSON.stringify(obj, null, thing ? ' ' : undefined);
}
/*
function debugSheet (sheet) {
  sheet = processRequest(sheet);
  Promise.all(sheet).then(function (sheet) {
    //console.log(logObj(sheet, 1));
    console.log(logObj({done:true}));
    return sheet;
  });
}

debugSheet(
  ['es(1)']
  //['(`US`).divide((`*`).sum(1000))']
  //['(`*`).divide(100)']
);
*/
