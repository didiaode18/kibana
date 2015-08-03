'use strict';


var path = require('path');


module.exports = function (kibana) {
  return new kibana.Plugin({
    require: ['kibana'],
    uiExports: {
      app: {
        title: 'Timelion',
        description: 'Rawr',
        icon: 'http://placekitten.com/g/400/302',
        main: 'plugins/timelion/app'
      },
      modules: {
        flot$: {
          path: path.resolve(__dirname, 'bower_components/flot/jquery.flot'),
          imports: 'jquery'
        },
        flotTime$: {
          path: path.resolve(__dirname, 'bower_components/flot/jquery.flot.time'),
          imports: 'flot'
        }
      }
    },
    init: require('./init.js')
  });

};
