'use strict';

const NATIVE_DECLS = {
  'vec': {type: 'type', argCount: 1},
  'dict': {type: 'type', argCount: 2},
  'int32': {type: 'type'},
  'int16': {type: 'type'},
  'float32': {type: 'type'},
  'string': {type: 'type'},
  'IO': {
    type: 'ns',
    decls: {
      'file': {type: 'type'},
      'open': {type: 'fun', args: [{path: ['string']}], retType: {path: ['IO', 'file']}},
      'print': {type: 'fun', args: [{path: ['string']}], retType: null},
    },
  }
};

function analyse(unit) {
  const state = {
    expTypes: new Map(),
  };
  for (const func of unit.funcs) {
    for (const st of func.sts) {
      if (st.type !== 'exp') continue;
      const fc = st.value;
      validateExp(st.value, state);
    }
  }
  return state;
}

function validateExp(exp, state) {
  if (exp.type === 'str') {
    return {type: 'string'};
  }
  if (exp.type === 'fun_call') {
    const {path, spec} = resolveQualIdent(exp.qualIdent, state);
    if (spec.type != 'fun') {
      console.log(spec);
      throw new Error(`${exp.qualIdent.join('.')} is not a function`);
    }
    if (spec.args.length != exp.args.length) {
      throw new Error(`${exp.qualIdent.join('.')} expects ${spec.args.length} arguments`);
    }
    return {type: spec.retType};
  }
  throw new Error('unknown expression');
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
