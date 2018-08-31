'use strict';

const eq = require('./eq');

function generateJs(unit, write) {
  writePrelude(write);
  const state = {write, ns: {funcs: []}, scopes: [], indent: 1};
  let nsNextId = 1;
  for (const func of unit.funcs) {
    state.ns.funcs.push({name: localNameOf(nsNextId)});
    ++nsNextId;
  }
  for (const [ix, func] of unit.funcs.entries()) {
    let name = state.ns.funcs[ix].name;
    const locals = func.locals.map((local, i) => ({name: localNameOf(i + nsNextId)}));
    state.scopes.push({locals, localsMaxId: locals.length + nsNextId - 1});
    const argsString = func.args.map(arg => locals[arg.localIx].name).join(', ');
    write(`function ${name}(${argsString}) {\n`);
    for (const st of func.sts) {
      write('  '.repeat(state.indent));
      writeSt(state, st);
    }
    write('}\n\n');
    state.scopes.pop();
  }
  const entryPoint = unit.funcs.findIndex(func => {
    return func.name === null && func.args.length === 1 &&
      eq(func.args[0].type.path, ['vec']) &&
      func.args[0].type.args.length === 1 &&
      eq(func.args[0].type.args[0].path, ['str']) &&
      func.isExported;
  });
  if (entryPoint == null) {
    throw new Error('could not find an entry point');
  }
  write(`process.exitCode=${state.ns.funcs[entryPoint].name}(process.argv.slice(1));\n`);
}

function writeSt(state, st) {
  const {write} = state;
  if (st.type === 'exp') {
    genExp(st.value, state, 0);
    write(';\n');
    return;
  }
  if (st.type === 'decl') {
    const {locals} = state.scopes[state.scopes.length - 1];
    write('let ' + locals[st.localIx].name);
    if (st.init != null) {
      write('=');
      genCopyExp(st.init, state, 0);
    }
    write(';\n');
    return;
  }
  if (st.type === 'if') {
    write('if(');
    genExp(st.cond, state, 0);
    write(')');
    writeSt(state, st.body);
    return;
  }
  if (st.type === 'return') {
    write('return ');
    genExp(st.value, state, 0);
    write(';\n');
    return;
  }
  if (st.type === 'block') {
    write('{\n');
    const base = state.scopes[state.scopes.length - 1].localsMaxId + 1;
    const locals = st.locals.map((local, i) => ({name: localNameOf(base + i)}));
    state.scopes.push({locals, localsMaxId: base + locals.length - 1});
    ++state.indent;
    for (const sst of st.sts) {
      write('  '.repeat(state.indent));
      writeSt(state, sst);
    }
    --state.indent;
    state.scopes.pop();
    write('  '.repeat(state.indent));
    write('}\n');
    return;
  }
  throw new Error('unknown statement type');
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

const EXP_PRCS = (() => {
  const prcs = ['eq', 'sum', 'MAX'];
  const res = {};
  for (let i = 0; i < prcs.length; ++i) {
    res[prcs[i]] = i + 1;
  }
  return res;
})();

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
  if (value.type === 'bool') {
    write(value.value ? 'true' : 'false');
    return;
  }
  if (value.type === 'fun_call') {
    let js_func, is_method = false;
    if (value.callee.impl.type === 'native') {
      switch (value.callee.impl.name) {
      case 'IO.print':
        js_func = 'console.log';
        break;
      case 'vec_push':
        js_func = 'push';
        is_method = true;
      }
    }
    if (value.callee.impl.type === 'ns') {
      js_func = state.ns.funcs[value.callee.impl.ix].name;
    }
    if (js_func == null)
      throw new Error(`no such func`);
    if (is_method) {
      genExp(value.args.shift(), state, EXP_PRCS.MAX);
      write('.');
    }
    write(`${js_func}(`);
    let first = true;
    for (const arg of value.args) {
      if (!first) write(', ');
      first = false;
      genCopyExp(arg, state, 0);
    }
    write(`)`);
    return;
  }
  if (value.type === 'sum') {
    if (prc > EXP_PRCS.sum) write('(');
    genExp(value.left, state, EXP_PRCS.sum);
    write('+');
    genExp(value.right, state, EXP_PRCS.sum);
    if (prc > EXP_PRCS.sum) write(')');
    return;
  }
  if (value.type === 'eq') {
    if (prc > EXP_PRCS.eq) write('(');
    genExp(value.left, state, EXP_PRCS.eq);
    write('==');
    genExp(value.right, state, EXP_PRCS.eq);
    if (prc > EXP_PRCS.eq) write(')');
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
  if (value.type === 'vec') {
    write('[');
    for (const item of value.items) {
      genCopyExp(item, state, 0);
    }
    write(']');
    return;
  }
  throw new Error(`unknown expression type "${value.type}"`);
}

function genCopyExp(exp, state, prc) {
  genExp(exp, state, prc);
  if (eq(exp.valueType.path, ['vec'])) {
    // TODO: avoid cloning if we can transfer ownership.
    state.write('.slice()');
  }
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
  write(`'use strict';
function v(a,k) {if(k<0||k>=a.length)throw new Error('index out of bounds');return a[k];}

`);
}

module.exports = generateJs;
