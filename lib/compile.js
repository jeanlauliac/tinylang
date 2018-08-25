'use strict';

const parse = require('./parse');
const analyse = require('./analyse');
const generateJs = require('./generateJs');

function compile(filePath, code, write) {
  const unit = parse(filePath, code);
  const inter = analyse(filePath, unit);
  generateJs(inter, write);
}

module.exports = compile;
