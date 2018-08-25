'use strict';

const eq = require('./eq');

const NATIVE_DECLS = {
  'vec': {type: 'type', argCount: 1},
  'dict': {type: 'type', argCount: 2},
  'i32': {type: 'type'},
  'i16': {type: 'type'},
  'u16': {type: 'type'},
  'u32': {type: 'type'},
  'f16': {type: 'type'},
  'f32': {type: 'type'},
  'str': {type: 'type'},
  'bool': {type: 'type'},
  'IO': {
    type: 'ns',
    decls: {
      'file': {type: 'type'},
      'token': {type: 'type'},
      'open': {
        type: 'fun',
        args: [{path: ['str'], args: []}],
        retType: {path: ['IO', 'file'], args: []},
        impl: {type: 'native', name: 'IO.open'},
      },
      'print': {
        type: 'fun',
        args: [{path: ['str'], args: []}],
        retType: null,
        impl: {type: 'native', name: 'IO.print'},
      },
    },
  }
};

class AnalysisError extends Error {
  constructor(message, loc = [{line: 0, col: 0}]) {
    super(`${loc[0].line}:${loc[0].col}: ${message}`);
    this.loc = loc;
  }
}

function analyse(filePath, unit) {
  try {
    return analyseImpl(unit);
  } catch (error) {
    if (error instanceof AnalysisError) {
      error.message = `${filePath}:${error.message}`;
    }
    throw error;
  }
}

function analyseImpl(unit) {
  const funcs = [];
  const state = {
    scopes: [],
  };
  for (const func of unit.funcs) {
    const {typeName, name, isExported} = func;
    const scope = freshScope();
    const args = [];
    let localIx = 0;
    for (const arg of func.args) {
      scope.names.set(arg.name, scope.locals.length);
      const type = resolveType(arg.type);
      scope.locals.push({type});
      args.push({localIx, type});
      ++localIx;
    }
    state.scopes.push(scope);
    const sts = [];
    for (const st of func.sts) {
      sts.push(evaluateSt(state, st));
    }
    state.scopes.pop();
    funcs.push({
      typeName: typeName.value,
      name: name && name.value,
      isExported,
      args,
      locals: scope.locals,
      sts,
    });
  }
  return {funcs};
}

function evaluateSt(state, st) {
  if (st.type === 'exp') {
    return {type: 'exp', value: evaluateExp(st.value, state)};
  }
  if (st.type === 'block') {
    const scope = freshScope();
    state.scopes.push(scope);
    const sts = [];
    for (const sst of st.sts) {
      sts.push(evaluateSt(state, sst));
    }
    state.scopes.pop();
    return {
      type: 'block',
      sts,
      locals: scope.locals,
    };
  }
  if (st.type === 'if') {
    const cond = evaluateExp(st.cond, state);
    if (cond.type !== 'value' || !eq(cond.valueType.path, ['bool'])) {
      throw new AnalysisError(`'if' condition needs to be a boolean expression`, st.cond.loc);
    }
    return {
      type: 'if',
      cond,
      body: evaluateSt(state, st.body),
    };
  }
  if (st.type === 'decl') {
    const scope = state.scopes[state.scopes.length - 1];
    if (scope.names.has(st.name.value)) {
      throw new AnalysisError(`name "${st.name.value}" already exist in scope`, st.name.loc);
    }
    scope.names.set(st.name.value, scope.locals.length);
    const init = st.init && evaluateExp(st.init, state);
    const type = resolveType(st.declType);
    if (init != null) {
      if (!eq(init.valueType, type))
        throw new AnalysisError('invalid initializer type', st.init.loc);
    }
    scope.locals.push({type});
    return {
      type: 'decl',
      localIx: scope.locals.length - 1,
      init,
    };
  }
  throw new AnalysisError('unknown statement type', st.loc);
}

function freshScope() {
  return {names: new Map(), locals: []};
}

function resolveType(type) {
  const {path, spec} = resolveQualIdent([type.typeName]);
  if (spec.type !== 'type')
    throw new AnalysisError(`expected "${type.typeName}" to be a type`);
  return {path, args: type.args.map(arg => resolveType(arg))};
}

function evaluateExp(exp, state) {
  if (exp.type === 'str') {
    return {type: 'value', valueType: {path: ['str'], args: []}, value: exp};
  }
  if (exp.type === 'num') {
    return {type: 'value', valueType: {path: ['u32'], args: []}, value: exp};
  }
  if (exp.type === 'bool') {
    return {type: 'value', valueType: {path: ['bool'], args: []}, value: exp};
  }
  if (exp.type === 'fun_call') {
    const callee = evaluateExp(exp.callee, state);
    if (callee.type != 'fun') {
      throw new AnalysisError(`not a function`, exp.callee.loc);
    }
    if (callee.args.length != exp.args.length) {
      throw new AnalysisError(`expected ${callee.args.length} arguments`, exp.loc);
    }
    const args = [];
    for (let i = 0; i < callee.args.length; ++i) {
      const arg = evaluateExp(exp.args[i], state);
      if (arg.type != 'value') throw new AnalysisError('expected a value', exp.args[i].loc);
      if (!eq(callee.args[i], arg.valueType)) {
        throw new AnalysisError(`invalid argument type`, exp.args[i].loc);
      }
      args.push(arg);
    }
    return {
      type: 'value',
      valueType: callee.retType,
      value: {type: 'fun_call', callee, args},
    };
  }
  if (exp.type === 'ref') {
    const name = exp.ident.value;
    const decl = NATIVE_DECLS[name];
    if (decl != null) return decl;
    for (let i = state.scopes.length - 1; i >= 0; --i) {
      const localIx = state.scopes[i].names.get(name);
      if (localIx == null) continue;
      return {
        type: 'value',
        valueType: state.scopes[i].locals[localIx].type,
        value: {
          type: 'ref',
          scopeIx: i,
          localIx,
        },
      };
    }
    throw new AnalysisError(`unknown identifier "${name}"`, exp.ident.loc);
  }
  if (exp.type === 'dot_access') {
    const target = evaluateExp(exp.target, state);
    if (target.type != 'ns') throw new AnalysisError('invalid dot access', exp.loc);
    const decl = target.decls[exp.member.value];
    if (decl != null) return decl;
    throw new AnalysisError(`cannot find name "${exp.member.value}"`, exp.member.loc);
  }
  if (exp.type === 'key_access') {
    const target = evaluateExp(exp.target, state);
    if (target.type != 'value') throw new AnalysisError('invalid key access', exp.loc);
    const key = evaluateExp(exp.key, state);
    if (eq(target.valueType.path, ['vec'])) {
      if (!eq(key.valueType.path, ['u32'])) throw new AnalysisError('invalid key type', exp.key.loc);
      return {type: 'value', valueType: target.valueType.args[0], value: {
        type: 'vec_access',
        target,
        key,
      }};
    }
    throw new AnalysisError('key access only works on vec', exp.loc);
  }
  if (exp.type === 'sum') {
    const left = evaluateExp(exp.left, state);
    if (left.type !== 'value' || !eq(left.valueType.path, ['str']))
      throw new AnalysisError('+ does not apply on this type', left.loc);
    const right = evaluateExp(exp.right, state);
    if (right.type !== 'value' || !eq(left.valueType, right.valueType))
      throw new AnalysisError('both side of "+" must be the same type', exp.loc);
    return {
      type: 'value',
      valueType: left.valueType,
      value: {type: 'sum', left, right},
    };
  }
  if (exp.type === 'eq') {
    const left = evaluateExp(exp.left, state);
    if (left.type !== 'value')
      throw new AnalysisError('left of equality check needs to be a value');
    const right = evaluateExp(exp.right, state);
    if (right.type !== 'value' || !eq(left.valueType, right.valueType))
      throw new AnalysisError('both side of "==" must be the same type', exp.loc);
    return {
      type: 'value',
      valueType: {path: ['bool'], args: []},
      value: {type: 'eq', left, right},
    };
  }
  throw new AnalysisError('unknown expression type', exp.loc);
}

function resolveQualIdent(qualIdent, state) {
  const path = [];
  let spec = {type: 'ns', decls: NATIVE_DECLS};
  for (const ident of qualIdent) {
    if (spec.type != 'ns') throw new AnalysisError(`unable to resolve "${ident}"`);
    spec = spec.decls[ident];
    if (spec == null) {
      throw new AnalysisError(`"${ident}" does not exist`);
    }
    path.push(ident);
  }
  return {path, spec};
}

module.exports = analyse;
