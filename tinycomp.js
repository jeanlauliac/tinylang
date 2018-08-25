'use strict';

const fs = require('fs');
const compile = require('./lib/compile');

function main() {
  if (process.argv.length < 3) {
    console.error('usage: tinycomp <entry_file>');
    process.exitCode = 1;
    return;
  }
  const filePath = process.argv[2];
  const code = fs.readFileSync(filePath, 'utf8');
  compile(filePath, code, process.stdout.write.bind(process.stdout));
}

main();
