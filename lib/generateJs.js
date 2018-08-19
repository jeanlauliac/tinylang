'use strict';

const eq = require('./eq');

function generateJs(unit, write) {
  write("'use strict';\n");
  writePrelude(write);
  const funcJsNames = new Map();
  for (const func of unit.funcs) {
    let {name} = func;
    if (name === 'def') name = 'DEF';
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
      else throw new Error('unknown statement type');
      write(';\n');
    }
    write('}\n\n');
  }
  const entryPoint = unit.funcs.find(func => {
    return func.name === 'def' && func.args.length === 1 &&
      func.args[0].type.typeName === 'vec' &&
      func.args[0].type.args.length === 1 &&
      func.args[0].type.args[0].typeName === 'str';
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
  if (exp.type !== 'value') {
    throw new Error(`cannot write non-value to JS: ` + require('util').inspect(exp));
  }
  const {value} = exp;
  if (value.type === 'str') {
    writeStrLit(value.value, write);
    return;
  }
  if (value.type === 'num') {
    writeNumLit(value.value, write);
    return;
  }
  if (value.type === 'fun_call') {
    let js_func;
    if (value.callee.impl.type === 'native' && value.callee.impl.name === 'IO.print') {
      js_func = 'console.log';
    }
    if (js_func == null)
      throw new Error(`no such func "${value.callee.impl}"`);
    write(`${js_func}(`);
    let first = true;
    for (const arg of value.args) {
      if (!first) write(', ');
      first = false;
      genExp(arg, idt + '  ', write);
    }
    write(`)`);
    return;
  }
  if (value.type === 'sum') {
    write('(');
    genExp(value.left, idt, write);
    write(' + ');
    genExp(value.right, idt, write);
    write(')');
    return;
  }
  if (value.type === 'vec_access') {
    write('v(')
    genExp(value.target, idt, write);
    write(', ');
    genExp(value.key, idt, write);
    write(')');
    return;
  }
  if (value.type === 'ref') {
    write(value.ident);
    return;
  }
  throw new Error(`unknown expression type "${value.type}"`);
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

function writeNumLit(value, write) {
  write(value.toString(10));
}

function writePrelude(write) {
  write(`
function v(a,k) {if(k<0||k>=a.length)throw new Error('index out of bounds');return a[k];}

`);
}

module.exports = generateJs;
