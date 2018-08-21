'use strict';

const eq = require('./eq');

function generateJs(unit, write) {
  write("'use strict';\n");
  writePrelude(write);
  const funcJsNames = new Map();
  for (const func of unit.funcs) {
    let {name} = func;
    for (const arg of func.args) {
      name = (name || 'DEFAULT') + '_' + flattenType(arg.type);
    }
    funcJsNames.set(func, name);
  }
  const state = {write, scopes: []};
  for (const func of unit.funcs) {
    let name = funcJsNames.get(func);
    const locals = func.locals.map((local, i) => ({name: localNameOf(i + 1)}));
    state.scopes.push({locals});
    const argString = func.args.map(arg => locals[arg.localIx].name).join(', ');
    write(`function ${name}(${argString}) {\n`);
    for (const st of func.sts) {
      write('  ');
      if (st.type === 'exp') genExp(st.value, state, 0);
      else if (st.type === 'decl') {
        write('let ' + locals[st.localIx].name);
        if (st.init != null) {
          write('=');
          genExp(st.init, state, 0);
        }
      }
      else throw new Error('unknown statement type');
      write(';\n');
    }
    write('}\n\n');
    state.scopes.pop();
  }
  const entryPoint = unit.funcs.find(func => {
    return func.name === null && func.args.length === 1 &&
      eq(func.args[0].type.path, ['vec']) &&
      func.args[0].type.args.length === 1 &&
      eq(func.args[0].type.args[0].path, ['str']) &&
      func.isExported;
  });
  if (entryPoint == null) {
    throw new Error('could not find an entry point');
  }
  write(`${funcJsNames.get(entryPoint)}(process.argv.slice(1));\n`);
}

function localNameOf(id) {
  if (id < 1 || id > Number.MAX_SAFE_INTEGER) throw new Error('invalid id');
  let name = '';
  while (id > 0) {
    name = String.fromCharCode('a'.charCodeAt(0) + ((id - 1) % 26)) + name;
    id = ((id - 1) / 26) | 0;
  }
  return name;
}

function flattenType(type) {
  const baseName = type.path.join('_')
  if (type.args.length === 0) {
    return baseName;
  }
  return baseName + '_oA_' +
    type.args.map(arg => flattenType(arg)).join('_') + '_eA';
}

function genExp(exp, state, prc) {
  if (exp.type !== 'value') {
    throw new Error(`cannot write non-value to JS: ` + require('util').inspect(exp));
  }
  const {write} = state;
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
      genExp(arg, state, 0);
    }
    write(`)`);
    return;
  }
  if (value.type === 'sum') {
    if (prc > 10) write('(');
    genExp(value.left, state, 10);
    write('+');
    genExp(value.right, state, 10);
    if (prc > 10) write(')');
    return;
  }
  if (value.type === 'vec_access') {
    const {precedence} = state;
    write('v(')
    genExp(value.target, state, 0);
    write(',');
    genExp(value.key, state, 0);
    write(')');
    return;
  }
  if (value.type === 'ref') {
    const local = state.scopes[value.scopeIx].locals[value.localIx];
    write(local.name);
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
