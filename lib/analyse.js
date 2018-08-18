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
      'open': {type: 'fun', args: [{path: ['str'], args: []}], retType: {path: ['IO', 'file'], args: []}},
      'print': {type: 'fun', args: [{path: ['str'], args: []}], retType: null},
    },
  }
};

function analyse(unit) {
  const state = {
    expTypes: new Map(),
    scopes: [],
  };
  for (const func of unit.funcs) {
    state.scopes.push(
      new Map(func.args.map(arg => {
        return [arg.name, resolveType(arg.type)];
      })),
    );
    for (const st of func.sts) {
      if (st.type === 'exp') {
        const fc = st.value;
        evaluateExp(st.value, state);
        continue;
      }
      throw new Error('unknown statement type');
    }
    state.scopes.pop();
  }
  return state;
}

function resolveType(type) {
  const {path, spec} = resolveQualIdent([type.typeName]);
  if (spec.type !== 'type')
    throw new Error(`expected "${type.typeName}" to be a type`);
  return {path, args: type.args.map(arg => resolveType(arg))};
}

function evaluateExp(exp, state) {
  if (exp.type === 'str') {
    return {type: 'value', valueType: {path: ['str'], args: []}};
  }
  if (exp.type === 'num') {
    return {type: 'value', valueType: {path: ['u32'], args: []}};
  }
  if (exp.type === 'fun_call') {
    const callee = evaluateExp(exp.callee, state);
    if (callee.type != 'fun') {
      throw new Error(`not a function`);
    }
    if (callee.args.length != exp.args.length) {
      throw new Error(`expected ${callee.args.length} arguments`);
    }
    for (let i = 0; i < callee.args.length; ++i) {
      const validated = evaluateExp(exp.args[i], state);
      if (validated.type != 'value') throw new Error('expected value');
      if (!eq(callee.args[i], validated.valueType)) {
        console.error(callee.args[i], validated.valueType);
        throw new Error(`invalid argument #${i} type`);
      }
    }
    return {type: 'value', valueType: callee.retType};
  }
  if (exp.type === 'ref') {
    const decl = NATIVE_DECLS[exp.ident];
    if (decl != null) return decl;
    for (let i = state.scopes.length -1; i >= 0; ++i) {
      const localVar = state.scopes[i].get(exp.ident);
      if (localVar != null) return {type: 'value', valueType: localVar};
    }
    throw new Error(`unknown identifier "${exp.ident}"`);
  }
  if (exp.type === 'dot_access') {
    const resolved = evaluateExp(exp.target, state);
    if (resolved.type != 'ns') throw new Error('invalid dot access');
    const decl = resolved.decls[exp.member];
    if (decl != null) return decl;
    throw new Error(`cannot find name "${exp.member}"`);
  }
  if (exp.type === 'key_access') {
    const resolved = evaluateExp(exp.target, state);
    if (resolved.type != 'value') throw new Error('invalid key access');
    const resKey = evaluateExp(exp.key, state);
    if (eq(resolved.valueType.path, ['vec'])) {
      if (eq(resKey.path, ['u32'])) throw new Error('invalid key type');
      return {type: 'value', valueType: resolved.valueType.args[0]};
    }
    throw new Error('key access only works on vec');
  }
  if (exp.type === 'sum') {
    const left = evaluateExp(exp.left, state);
    if (left.type !== 'value' || !eq(left.valueType.path, ['str']))
      throw new Error('+ does not apply on this type');
    const right = evaluateExp(exp.right, state);
    if (right.type !== 'value' || !eq(left.valueType, right.valueType))
      throw new Error('both side of + must be the same type');
    return {type: 'value', valueType: left.valueType};
  }
  throw new Error('unknown expression type');
}

function resolveQualIdent(qualIdent, state) {
  const path = [];
  let spec = {type: 'ns', decls: NATIVE_DECLS};
  for (const ident of qualIdent) {
    if (spec.type != 'ns') throw new Error(`unable to resolve "${ident}"`);
    spec = spec.decls[ident];
    if (spec == null) {
      throw new Error(`"${ident}" does not exist`);
    }
    path.push(ident);
  }
  return {path, spec};
}

module.exports = analyse;
