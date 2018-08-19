'use strict';

const eq = require('./eq');

const NATIVE_DECLS = {
  'vec': {type: 'type', argCount: 1},
  'map': {type: 'type', argCount: 2},
  'i32': {type: 'type'},
  'i16': {type: 'type'},
  'u16': {type: 'type'},
  'u32': {type: 'type'},
  'f16': {type: 'type'},
  'f32': {type: 'type'},
  'str': {type: 'type'},
  'IO': {
    type: 'ns',
    decls: {
      'file': {type: 'type'},
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

class AnalysisError extends Error {}

function analyse(unit) {
  const funcs = [];
  const state = {
    scopes: [],
  };
  for (const func of unit.funcs) {
    const {typeName, name, isExported} = func;
    const scope = {names: new Map(), locals: []};
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
      if (st.type === 'exp') {
        const fc = st.value;
        sts.push({type: 'exp', value: evaluateExp(st.value, state)});
        continue;
      }
      throw new AnalysisError('unknown statement type');
    }
    state.scopes.pop();
    funcs.push({
      typeName, name, isExported, args,
      locals: scope.locals, sts,
    });
  }
  return {funcs};
}

function resolveType(type) {
  const {path, spec} = resolveQualIdent([type.typeName]);
  if (spec.type !== 'type')
    throw new AnalysisError(`expected "${type.typeName}" to be a type`);
  return {path, args: type.args.map(arg => resolveType(arg))};
}

function evaluateExp(exp, state) {
  try {
    return evaluateExpImpl(exp, state);
  } catch (error) {
    if (error instanceof AnalysisError && exp.loc != null) {
      error.message = exp.loc.line + ':' + exp.loc.column + ':' + error.message;
    }
    throw error;
  }
}

function evaluateExpImpl(exp, state) {
  if (exp.type === 'str') {
    return {type: 'value', valueType: {path: ['str'], args: []}, value: exp};
  }
  if (exp.type === 'num') {
    return {type: 'value', valueType: {path: ['u32'], args: []}, value: exp};
  }
  if (exp.type === 'fun_call') {
    const callee = evaluateExp(exp.callee, state);
    if (callee.type != 'fun') {
      throw new AnalysisError(`not a function`);
    }
    if (callee.args.length != exp.args.length) {
      throw new AnalysisError(`expected ${callee.args.length} arguments`);
    }
    const args = [];
    for (let i = 0; i < callee.args.length; ++i) {
      const arg = evaluateExp(exp.args[i], state);
      if (arg.type != 'value') throw new AnalysisError('expected value');
      if (!eq(callee.args[i], arg.valueType)) {
        throw new AnalysisError(`invalid argument #${i} type`);
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
    const decl = NATIVE_DECLS[exp.ident];
    if (decl != null) return decl;
    for (let i = state.scopes.length - 1; i >= 0; --i) {
      const localIx = state.scopes[i].names.get(exp.ident);
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
    throw new AnalysisError(`unknown identifier "${exp.ident}"`);
  }
  if (exp.type === 'dot_access') {
    const target = evaluateExp(exp.target, state);
    if (target.type != 'ns') throw new AnalysisError('invalid dot access');
    const decl = target.decls[exp.member];
    if (decl != null) return decl;
    throw new AnalysisError(`cannot find name "${exp.member}"`);
  }
  if (exp.type === 'key_access') {
    const target = evaluateExp(exp.target, state);
    if (target.type != 'value') throw new AnalysisError('invalid key access');
    const key = evaluateExp(exp.key, state);
    if (eq(target.valueType.path, ['vec'])) {
      if (!eq(key.valueType.path, ['u32'])) throw new AnalysisError('invalid key type');
      return {type: 'value', valueType: target.valueType.args[0], value: {
        type: 'vec_access',
        target,
        key,
      }};
    }
    throw new AnalysisError('key access only works on vec');
  }
  if (exp.type === 'sum') {
    const left = evaluateExp(exp.left, state);
    if (left.type !== 'value' || !eq(left.valueType.path, ['str']))
      throw new AnalysisError('+ does not apply on this type');
    const right = evaluateExp(exp.right, state);
    if (right.type !== 'value' || !eq(left.valueType, right.valueType))
      throw new AnalysisError('both side of + must be the same type');
    return {
      type: 'value',
      valueType: left.valueType,
      value: {type: 'sum', left, right},
    };
  }
  throw new AnalysisError('unknown expression type');
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
