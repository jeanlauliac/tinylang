'use strict';

const fs = require('fs');
const child_process = require('child_process');
const compile = require('./lib/compile');

const TEST_CASES_PATH = './test_cases.tn';

function main() {
  let line = 1;
  const cases = fs.readFileSync(TEST_CASES_PATH, 'utf8')
    .split('/'.repeat(79) + '\n').map(caseStr => {
      const pair = caseStr.split('####\n');
      const res = {
        args: [],
        comp_status: 0,
        status: 0,
        line,
        ...JSON.parse(pair[1]),
        code: pair[0],
      };
      line += (caseStr.match(/\n/g) || []).length + 1;
      return res;
    });
  for (const cs of cases) {
    let compCode = '';
    compile('test.js', cs.code, chunk => compCode += chunk);
    const proc = child_process.spawnSync(
      process.argv[0],
      ['-e', compCode, '--' ,'test.js'].concat(cs.args),
    );
    if (proc.status !== 0) throw new Error('code run failed');
    const output = proc.stdout.toString('utf8');
    if (output === cs.output) continue;
    throw new Error(
      TEST_CASES_PATH + ':' + cs.line + ': ' +
      'code run produced wrong output.\n' +
      'Expected: ' + JSON.stringify(cs.output) + '\n' +
      'Actual:   ' + JSON.stringify(output));
  }
}

main();
