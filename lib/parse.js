'use strict';

class ParseError extends Error {}

function parse(filePath, code) {
  const state = {code, line: 1, col: 1, idx: 0};
  try {
    skipSpaces(state);
    let unit = {funcs: []};
    let func = parseFunction(state);
    while (func != null) {
      unit.funcs.push(func);
      func = parseFunction(state)
    }
    if (state.idx < code.length) throw new ParseError('unexpected character');
    return unit;
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    error.message = `${filePath}:${state.line}:${state.col}: ${error.message}`;
    throw error;
  }
}

function parseFunction(state) {
  let typeNameOrQualifier = parseIdent(state);
  if (typeNameOrQualifier == null) return null;
  let isExported = false, typeName;
  if (typeNameOrQualifier == 'export') {
    isExported = true;
    typeName = parseIdent(state);
  } else {
    typeName = typeNameOrQualifier;
  }
  if (typeName == null) throw new ParseError('expected function return type');
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected function name');
  if (/[A-Z]/.test(name)) throw new ParseError('function names must be all lowercase');
  if (parseOp(state) !== '(') throw new ParseError("expected left paren");
  const args = [];
  let op;
  let arg = parseFunArg(state);
  while (arg != null) {
    args.push(arg);
    op = parseOp(state);
    if (op !== ',') {
      arg = null;
      continue;
    }
    arg = parseFunArg(state);
    if (arg == null) {
      op = parseOp(state);
    }
  }
  if (op == null) op = parseOp(state);
  if (op !== ')') throw new ParseError("expected right paren");
  if (parseOp(state) !== '{') throw new ParseError("expected left brace");
  const sts = [];
  let st = parseFunSt(state);
  while (st != null) {
    sts.push(st);
    st = parseFunSt(state);
  }
  if (parseOp(state) !== '}') throw new ParseError("expected left brace");
  return {typeName, name, isExported, args, sts};
}

function parseFunArg(state) {
  const type = parseType(state);
  if (type == null) return null;
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected argument name');
  return {type, name};
}

function parseFunSt(state) {
  const value = parseExp(state);
  if (value == null) return null;
  if (parseOp(state) !== ';') throw new ParseError("expected semicolon");
  return {type: 'exp', value};
}

function parseExp(state) {
  return parseSumExp(state);
}

function parseSumExp(state) {
  let left = parseFinalExp(state);
  if (left == null) return null;
  let op = parseOp(state, /^[+-]$/);
  while (op != null) {
    let right = parseFinalExp(state);
    if (right == null) throw new ParseError("expected expression");
    left = {type: op === '+' ? 'sum' : 'subt', left, right};
    op = parseOp(state, /^[+-]$/);
  }
  return left;
}

function parseFinalExp(state) {
  let op = parseOp(state, /^\($/);
  if (op != null) {
    const exp = parseExp(state);
    if (exp == null) throw new ParseError("expected expression");
    op = parseOp(state, /^\)$/);
    if (op == null) throw new ParseError("expected right paren");
    return exp;
  }
  let exp;
  if (exp = parseString(state)) return exp;
  if (exp = parseNumber(state)) return exp;
  if (exp = parseFunCall(state)) return exp;
  return null;
}

function parseString(state) {
  const {code} = state;
  if (code[state.idx] !== '"') return null;
  forward(state);
  let value = '';
  while (state.idx < code.length && code[state.idx] !== '"') {
    if (code[state.idx] === '\n') {
      throw new ParseError("invalid newline within a string literal");
    }
    if (code[state.idx] === '\\') {
      forward(state);
    }
    value += code[state.idx];
    forward(state);
  }
  if (state.idx === state.code.length) {
    throw new ParseError("reached end of file within a string literal");
  }
  forward(state);
  skipSpaces(state);
  return {type: 'str', value};
}

function parseNumber(state) {
  const {code} = state;
  if (!/^[0-9.]$/.test(code[state.idx])) return null;
  const snap = save(state);
  let value = 0;
  let decimal = 0;
  do {
    if (code[state.idx] === '.') {
      if (decimal !== 0)
        throw new Error('cannot have 2 decimal markers in number literal');
      decimal = 0.1;
    } else if (decimal === 0) {
      value = value * 10 + (code[state.idx] - '0');
    } else {
      value = value + (code[state.idx] - '0') * decimal;
      decimal /= 10;
    }
    forward(state);
  } while (state.idx < code.length && /^[0-9.]$/.test(code[state.idx]));
  skipSpaces(state);
  return {type: 'num', value};
}

function parseFunCall(state) {
  const qualIdent = parseQualIdent(state);
  if (qualIdent == null) return null;
  if (parseOp(state) !== '(') throw new ParseError("expected left paren");
  const args = [];
  let arg = parseExp(state);
  let op;
  while (arg != null) {
    args.push(arg);
    op = parseOp(state);
    if (op !== ',') {
      arg = null;
      continue;
    }
    arg = parseExp(state);
  }
  if (op == ',' || !op) op = parseOp(state);
  if (op !== ')') throw new ParseError("expected right paren");
  return {type: 'fun_call', qualIdent, args};
}

function parseQualIdent(state) {
  let ident = parseIdent(state);
  if (ident == null) return null;
  const idents = [ident];
  let snap, op;
  do {
    snap = save(state);
    op = parseOp(state);
    if (op !== '.') {
      continue;
    }
    ident = parseIdent(state);
    idents.push(ident);
  } while (op === '.');
  restore(state, snap);
  return idents;
}

function parseIdent(state) {
  const {code} = state;
  const startIdx = state.idx;
  if (!/^[a-zA-Z_]$/.test(code[state.idx])) return null;
  while (state.idx < code.length && /^[a-zA-Z0-9_]$/.test(code[state.idx])) {
    forward(state);
  }
  const endIdx = state.idx;
  skipSpaces(state);
  return code.substring(startIdx, endIdx);
}

function parseType(state) {
  const typeName = parseIdent(state);
  if (typeName == null) return null;
  const snap = save(state);
  let op = parseOp(state);
  const args = [];
  if (op !== '<') {
    restore(state, snap)
    return {typeName, args};
  }
  do {
    const arg = parseType(state);
    if (arg == null) throw new ParseError('expected type name');
    args.push(arg);
    op = parseOp(state);
  } while (op === ',');
  if (op !== '>') throw new ParseError('expected right caret');
  return {typeName, args};
}

function parseOp(state, regExp = /^[(){}[\]<>;.,]$/) {
  const op = state.code[state.idx];
  if (regExp.test(op)) {
    forward(state);
    skipSpaces(state);
    return op;
  }
  return null;
}

function skipSpaces(state) {
  const {code} = state;
  let startIdx;
  do {
    startIdx = state.idx;
    while (state.idx < code.length && /^[ \t\n]$/.test(code[state.idx])) {
      forward(state);
    }
    if (code[state.idx] === '/' && code[state.idx + 1] === '*') {
      forward(state);
      forward(state);
      while (state.idx < code.length - 1 && !(code[state.idx] === '*' && code[state.idx + 1] === '/')) {
        forward(state);
      }
      forward(state);
      if (state.idx == code.length - 1) {
        throw new ParseError('unexpected end of file within comment');
      }
      forward(state);
    }
  } while (state.idx > startIdx);
}

function forward(state) {
  if (state.code[state.idx] === '\n') {
    ++state.line;
    state.col = 0;
  }
  ++state.col;
  ++state.idx;
}

function save(state) {
  return {idx: state.idx, line: state.line, col: state.col};
}

function restore(state, target) {
  state.idx = target.idx;
  state.line = target.line;
  state.col = target.col;
}

module.exports = parse;
