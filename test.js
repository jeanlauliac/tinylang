'use strict';

const fs = require('fs');
const child_process = require('child_process');

function main() {
  const tmpPath = mktemp();
  const binPath = mktemp();
  try {
    const cases = fs.readFileSync('./test_cases.tn', 'utf8')
      .split('>>>>\n').map(caseStr => {
        const pair = caseStr.split('####\n');
        return {
          args: [],
          comp_status: 0,
          status: 0,
          ...JSON.parse(pair[1]),
          code: pair[0],
        };
      });
    for (const cs of cases) {
      fs.writeFileSync(tmpPath, cs.code);
      const tinycomp = child_process.spawnSync(
        process.argv[0],
        [require.resolve('./tinycomp'), tmpPath],
      );
      if (tinycomp.status !== cs.comp_status) {
        console.error(tinycomp.stderr.toString('utf8')
          .split('\n').map(line => '> ' + line).join('\n'));
        throw new Error('wrong status');
      }
      if (tinycomp.status !== 0) continue;
      fs.writeFileSync(binPath, tinycomp.stdout);
      const proc = child_process.spawnSync(
        process.argv[0],
        [binPath].concat(cs.args),
      );
      if (proc.status !== 0) throw new Error('code run failed');
      const output = proc.stdout.toString('utf8');
      if (output === cs.output) continue;
      throw new Error('code run produced wrong output.\n' +
        'Expected: ' + JSON.stringify(cs.output) + '\n' +
        'Actual: ' + JSON.stringify(output));
    }
  } finally {
    fs.unlinkSync(tmpPath);
    fs.unlinkSync(binPath);
  }
}

function mktemp() {
  const mktemp = child_process.spawnSync('mktemp');
  if (mktemp.status !== 0) throw new Error('failed to mktemp');
  return mktemp.stdout.toString('utf8').split('\n')[0];
}

main();
