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
  'push': {
    type: 'func',
    genericsCount: 1,
    args: [{path: ['vec'], args: [{genericIx: 0}], isRef: true}, {genericIx: 0}],
    retType: null,
    impl: {type: 'native', name: 'vec_push'},
  },
  'IO': {
    type: 'ns',
    decls: {
      'file': {type: 'type'},
      'token': {type: 'type'},
      'open': {
        type: 'func',
        args: [{path: ['str'], args: []}],
        retType: {path: ['IO', 'file'], args: []},
        impl: {type: 'native', name: 'IO.open'},
      },
      'print': {
        type: 'func',
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
  const ns = {names: {}, structs: [], funcs: []};
  const state = {
    scopes: [],
    ns,
    retType: null,
  };
  for (const decl of unit.decls) {
    if (decl.type === 'struct') {
      if (ns.names[decl.name.value] != null)
        throw new AnalysisError(`duplicate definition for "${decl.name.value}"`, decl.name.loc);
      ns.names[decl.name.value] = {
        type: 'struct',
        ix: ns.structs.length,
      };
      ns.structs.push(decl);
      continue;
    }
  }
  for (const decl of unit.decls) {
    if (decl.type === 'func') {
      if (decl.name != null) {
        if (ns.names[decl.name.value] != null)
          throw new AnalysisError(`duplicate definition for "${decl.name.value}"`, decl.name.loc);
        ns.names[decl.name.value] = {
          type: 'func',
          ix: ns.funcs.length,
        };
      }
      ns.funcs.push({
        name: decl.name && decl.name.value,
        isExported: decl.isExported,
        args: decl.args.map(arg => {
          return {name: arg.name, type: resolveType(arg.type), isRef: arg.isRef};
        }),
        retType: decl.retType && resolveType(decl.retType),
        sts: decl.sts,
      });
    }
  }
  const funcs = [];
  for (const func of ns.funcs) {
    const scope = freshScope();
    const args = [];
    let localIx = 0;
    for (const arg of func.args) {
      scope.names.set(arg.name, scope.locals.length);
      const {type, isRef} = arg;
      scope.locals.push({type});
      args.push({localIx, type, isRef});
      ++localIx;
    }
    state.retType = func.retType;
    state.scopes.push(scope);
    const sts = [];
    for (const st of func.sts) {
      sts.push(evaluateSt(state, st));
    }
    state.scopes.pop();
    const {retType, name, isExported} = func;
    const evFunc = {
      retType,
      name,
      isExported,
      args,
      locals: scope.locals,
      sts,
    };
    if (evFunc.retType != null && !checkStsReturns(evFunc.sts)) {
      throw new AnalysisError('function does not always return value');
    }
    funcs.push(evFunc);
  }
  return {funcs};
}

/**
 * Return `true` if the list of statements always return a value.
 */
function checkStsReturns(sts) {
  if (sts.length === 0) return false;
  let i = 0;
  let alwaysReturn;
  do {
    alwaysReturn = checkStReturns(sts[i++]);
  } while(i < sts.length && !alwaysReturn);
  if (i < sts.length) throw new AnalysisError('dead code after return statement');
  return alwaysReturn;
}

/**
 * Check if the specified statement *always* returns.
 */
function checkStReturns(st) {
  switch (st.type) {
  case 'exp':
  case 'if':
  case 'decl':
  case 'while':
  case 'empty':
    return false;
  case 'block':
    return checkStsReturns(st.sts);
  case 'return':
    return true;
  default:
    throw new Error('unknown st type');
  }
}

function evaluateSt(state, st) {
  if (st.type === 'exp') {
    return {type: 'exp', value: evaluateExp(st.value, state, {typeHint: null})};
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
    const cond = evaluateExp(st.cond, state, {typeHint: {path: ['bool'], args: []}});
    if (cond.type !== 'value' || !eq(cond.valueType.path, ['bool'])) {
      throw new AnalysisError(`'if' condition needs to be a boolean expression`, st.cond.loc);
    }
    return {
      type: 'if',
      cond,
      body: evaluateSt(state, st.body),
    };
  }
  if (st.type === 'while') {
    const cond = evaluateExp(st.cond, state, {typeHint: {path: ['bool'], args: []}});
    if (cond.type !== 'value' || !eq(cond.valueType.path, ['bool'])) {
      throw new AnalysisError(`'while' condition needs to be a boolean expression`, st.cond.loc);
    }
    return {
      type: 'while',
      cond,
      body: evaluateSt(state, st.body),
    };
  }
  if (st.type === 'return') {
    const value = evaluateExp(st.value, state, {typeHint: state.retType});
    if (value.type != 'value')
      throw new AnalysisError('expected return value', st.value.loc);
    if (!eq(value.valueType, state.retType))
      throw new AnalysisError('invalid return value type', st.value.loc);
    return {
      type: 'return',
      value,
    };
  }
  if (st.type === 'decl') {
    const scope = state.scopes[state.scopes.length - 1];
    if (scope.names.has(st.name.value)) {
      throw new AnalysisError(`name "${st.name.value}" already exist in scope`, st.name.loc);
    }
    scope.names.set(st.name.value, scope.locals.length);
    const type = resolveType(st.declType);
    const init = st.init && evaluateExp(st.init, state, {typeHint: type});
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
  if (st.type === 'empty') {
    return st;
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

function evaluateExp(exp, state, context) {
  if (exp.type === 'str') {
    return {type: 'value', valueType: {path: ['str'], args: []}, value: exp, isLValue: false};
  }
  if (exp.type === 'num') {
    if (
      context.typeHint == null ||
      context.typeHint.path.length != 1 ||
      ['u8', 'u16', 'u32', 'i8', 'i16', 'i32'].indexOf(context.typeHint.path[0]) < 0
    ) {
      throw new AnalysisError(`can't infer type of number literal from context`, exp.loc);
    }
    return {type: 'value', valueType: context.typeHint, value: exp, isLValue: false};
  }
  if (exp.type === 'bool') {
    return {type: 'value', valueType: {path: ['bool'], args: []}, value: exp, isLValue: false};
  }
  if (exp.type === 'fun_call') {
    const callee = evaluateExp(exp.callee, state, {typeHint: null});
    if (callee.type != 'func') {
      throw new AnalysisError(`not a function`, exp.callee.loc);
    }
    if (callee.args.length != exp.args.length) {
      throw new AnalysisError(`expected ${callee.args.length} arguments`, exp.loc);
    }
    const args = [];
    const generics = [];
    for (let i = 0; i < callee.args.length; ++i) {
      const argSpec = callee.args[i];
      const arg = evaluateExp(exp.args[i], state,
        {typeHint: argSpec.genericIx != null ? null : {path: argSpec.path, args: argSpec.args}});
      if (!argSpec.isRef && arg.type !== 'value')
        throw new AnalysisError('expected a value', exp.args[i].loc);
      if (argSpec.isRef && arg.type !== 'value_ref')
        throw new AnalysisError('expected a reference, not a value', exp.args[i].loc);
      checkFuncCallArg(argSpec, arg.valueType, generics, exp.args[i].loc);
      args.push(arg);
    }
    return {
      type: 'value',
      valueType: callee.retType,
      value: {type: 'fun_call', callee, args},
      isLValue: false,
    };
  }
  if (exp.type === 'ref') {
    const name = exp.ident.value;
    const decl = NATIVE_DECLS[name];
    if (decl != null) return decl;
    const nsDecl = state.ns.names[name];
    if (nsDecl != null) {
      if (nsDecl.type === 'func') {
        const func = state.ns.funcs[nsDecl.ix];
        return {
          type: 'func',
          args: func.args.map(arg => Object.assign({}, arg.type, {isRef: arg.isRef})),
          retType: func.retType,
          impl: {type: 'ns', ix: nsDecl.ix},
        }
      }
      throw new Error('unknown decl type');
    }
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
        isLValue: true,
      };
    }
    throw new AnalysisError(`unknown identifier "${name}"`, exp.ident.loc);
  }
  if (exp.type === 'dot_access') {
    const target = evaluateExp(exp.target, state, {typeHint: null});
    if (target.type != 'ns') throw new AnalysisError('invalid dot access', exp.loc);
    const decl = target.decls[exp.member.value];
    if (decl != null) return decl;
    throw new AnalysisError(`cannot find name "${exp.member.value}"`, exp.member.loc);
  }
  if (exp.type === 'key_access') {
    const target = evaluateExp(exp.target, state, {typeHint: null});
    if (target.type != 'value') throw new AnalysisError('invalid key access', exp.loc);
    const key = evaluateExp(exp.key, state, {typeHint: {path: ['u32'], args: []}});
    if (eq(target.valueType.path, ['vec'])) {
      if (!eq(key.valueType.path, ['u32'])) throw new AnalysisError('invalid key type', exp.key.loc);
      return {type: 'value', valueType: target.valueType.args[0], value: {
        type: 'vec_access',
        target,
        key,
      }, isLValue: target.isLValue};
    }
    throw new AnalysisError('key access only works on vec', exp.loc);
  }
  if (exp.type === 'bin_op') {
    const left = evaluateExp(exp.left, state, {typeHint: exp.op === '==' ? null : context.typeHint});
    if (left.type !== 'value')
      throw new AnalysisError('expected a value', left.loc);
    if (['+', '-', '/', '*'].indexOf(exp.op) >= 0) {
      if (exp.op === '+' && !eq(left.valueType.path, ['str']) && !eq(left.valueType.path, ['u32']))
        throw new AnalysisError('expected a string or number', left.loc);
      if (exp.op !== '+' && !eq(left.valueType.path, ['u32']))
        throw new AnalysisError('expected a number', left.loc);
    }
    const right = evaluateExp(exp.right, state,
      {typeHint: exp.op === '==' ? left.valueType : context.typeHint});
    if (right.type !== 'value' || !eq(left.valueType, right.valueType))
      throw new AnalysisError('both sides of "+/-" must be the same type', exp.loc);
    return {
      type: 'value',
      valueType: exp.op == '==' ? {path: ['bool'], args: []} : left.valueType,
      value: {type: 'bin_op', op: exp.op, left, right},
      isLValue: false,
    };
  }
  if (exp.type === 'vec') {
    // TODO: decompose context.typeHint if it's a vector
    const items = exp.items.map(value => evaluateExp(value, state, {typeHint: null}));
    if (items.length === 0) throw new Error('not implemented');
    if (items[0].type !== 'value') throw new AnalysisError('expected value');
    const {valueType} = items[0];
    for (let i = 1; i < items.length; ++i) {
      if (items[i].type !== 'items') throw new AnalysisError('expected value');
      if (!eq(items[i].valueType, valueType)) {
        throw new AnalysisError('inconsistent vector value types');
      }
    }
    return {
      type: 'value',
      valueType: {path: ['vec'], args: [valueType]},
      value: {type: 'vec', items},
      isLValue: false,
    }
  }
  if (exp.type === 'assign') {
    const assignee = evaluateExp(exp.assignee, state, {typeHint: null});
    if (assignee.type !== 'value' || !assignee.isLValue)
      throw new AnalysisError('expected an lvalue to assign to');
    const from_value = evaluateExp(exp.from_value, state, {typeHint: assignee.valueType});
    if (from_value.type !== 'value')
      throw new AnalysisError('expected value to assign from');
    return {
      type: 'value',
      valueType: assignee.valueType,
      value: {
        type: 'assign',
        assignee,
        from_value,
      },
      isLValue: false,
    }
  }
  if (exp.type === 'ref_exp') {
    const target = evaluateExp(exp.target, state, {typeHint: context.typeHint});
    if (target.type != 'value' || !target.isLValue)
      throw new AnalysisError('expected lvalue to be referred to');
    return {
      type: 'value_ref',
      valueType: target.valueType,
      value: target.value,
      isLValue: false,
    }
  }
  throw new AnalysisError(`unknown expression type "${exp.type}"`, exp.loc);
}

/**
 * Check that `argType` can fit into `argSpec` argument type specification.
 * `argSpec` might be a generic. The mutable `generics` stores the generic
 * types that were resolved so far.
 */
function checkFuncCallArg(argSpec, argType, generics, loc) {
  if (argSpec.genericIx != null) {
    if (generics[argSpec.generics] != null) {
      if (!eq(generics[argSpec.generics], argType))
        throw new AnalysisError('generic argument type mismatch', loc);
      return;
    }
    generics[argSpec.generics] = argType;
    return;
  }
  if (!eq(argSpec.path, argType.path)) {
    throw new AnalysisError(`invalid argument type`, loc);
  }
  for (let i = 0; i < argSpec.args.length; ++i) {
    checkFuncCallArg(argSpec.args[i], argType.args[i], generics, loc);
  }
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
