const path = require('path');

module.exports.resolveRoot = function resolveRoot(base) {
  return path.resolve(base);
};

module.exports.VERSION = '1.0.0';

exports.shortName = (filePath) => path.basename(filePath);
