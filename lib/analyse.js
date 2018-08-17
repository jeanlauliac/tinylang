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
  'IO': {
    type: 'ns',
    decls: {
      'file': {type: 'type'},
      'open': {type: 'fun', args: [{path: ['str']}], retType: {path: ['IO', 'file']}},
      'print': {type: 'fun', args: [{path: ['str']}], retType: null},
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
        validateExp(st.value, state);
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

function validateExp(exp, state) {
  if (exp.type === 'str') {
    return {type: {path: ['str']}};
  }
  if (exp.type === 'num') {
    return {type: {path: ['int32']}};
  }
  if (exp.type === 'fun_call') {
    const {path, spec} = resolveQualIdent(exp.qualIdent, state);
    if (spec.type != 'fun') {
      throw new Error(`${exp.qualIdent.join('.')} is not a function`);
    }
    if (spec.args.length != exp.args.length) {
      throw new Error(`${exp.qualIdent.join('.')} expects ${spec.args.length} arguments`);
    }
    for (let i = 0; i < spec.args.length; ++i) {
      const validated = validateExp(exp.args[i], state);
      if (!eq(spec.args[i], validated.type)) {
        throw new Error(`invalid argument type`);
      }
    }
    return {type: spec.retType};
  }
  if (exp.type === 'key_access') {
    // FIXME: resolve qual idents recursively instead of left-to-right, as
    // each level may actually be an expression. (should 'dot_access' exps)
    const {path, spec} = resolveQualIdent(exp.qualIdent, state);
    return {type: ''};
  }
  if (exp.type === 'sum') {
    const left = validateExp(exp.left, state);
    if (!eq(left.type, {path: ['str']}))
      throw new Error('+ does not apply on this type');
    const right = validateExp(exp.right, state);
    if (!eq(left.type, right.type))
      throw new Error('both side of + must be the same type');
    return {type: left.type};
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
