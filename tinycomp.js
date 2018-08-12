'use strict';

const fs = require('fs');
const parse = require('./lib/parse');
const typecheck = require('./lib/typecheck');
const generateJs = require('./lib/generateJs');

function main() {
  if (process.argv.length < 3) {
    console.error('usage: tinycomp <entry_file>');
    process.exitCode = 1;
    return;
  }
  const filePath = process.argv[2];
  const code = fs.readFileSync(filePath, 'utf8');
  const unit = parse(filePath, code);
  typecheck(unit);
  generateJs(unit, process.stdout.write.bind(process.stdout));
}

main();
