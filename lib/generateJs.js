'use strict';

const eq = require('./eq');

function generateJs(unit, write) {
  write("'use strict';\n\n");
  const funcJsNames = new Map();
  for (const func of unit.funcs) {
    let {name} = func;
    if (name === 'default') name = 'Default';
    for (const arg of func.args) {
      name += '_' + flattenType(arg.type);
    }
    funcJsNames.set(func, name);
  }
  for (const func of unit.funcs) {
    let name = funcJsNames.get(func);
    write(`function ${name}(${func.args.map(arg => arg.name).join(', ')}) {\n`);
    for (const st of func.sts) {
      write('  ');
      if (st.type === 'exp') genExp(st.value, '  ', write);
      write(';\n');
    }
    write('}\n\n');
  }
  const entryPoint = unit.funcs.find(func => {
    return func.name === 'default' && func.args.length === 1 &&
      func.args[0].type.typeName === 'vec' &&
      func.args[0].type.args.length === 1 &&
      func.args[0].type.args[0].typeName === 'string';
  });
  if (entryPoint == null) {
    throw new Error('could not find an entry point');
  }
  write(`${funcJsNames.get(entryPoint)}(process.argv.slice(1));\n`);
}

function flattenType(type) {
  if (type.args.length === 0) {
    return type.typeName;
  }
  return type.typeName + '_oA_' +
    type.args.map(arg => flattenType(arg)).join('_') + '_eA';
}

function genExp(exp, idt, write) {
  if (exp.type === 'str') {
    writeStrLit(exp.value, write);
    return;
  }
  if (exp.type === 'fun_call') {
    let js_func;
    if (eq(exp.qualIdent, ['IO', 'print'])) {
      js_func = 'console.log';
    }
    if (js_func == null)
      throw new Error(`no such func "${exp.qualIdent.join('.')}"`);
    write(`${js_func}(`);
    let first = true;
    for (const arg of exp.args) {
      if (!first) write(', ');
      first = false;
      genExp(arg, idt + '  ', write);
    }
    write(`)`);
    return;
  }
  if (exp.type === 'sum') {
    genExp(exp.left, idt, write);
    write(' + ');
    genExp(exp.right, idt, write);
    return;
  }
  throw new Error('unknown expression type');
}

function writeStrLit(value, write) {
  write('"');
  for (const ch of value) {
    if (ch === '\n') write("\\n");
    else if (ch === '\\') write ("\\\\");
    else if (ch === '\t') write ("\\t");
    else write(ch);
  }
  write('"');
}

module.exports = generateJs;
