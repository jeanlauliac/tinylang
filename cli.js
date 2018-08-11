'use strict';

const fs = require('fs');

class ParseError extends Error {}

function main() {
  if (process.argv.length < 3) {
    console.error('usage: tinylang <entry_file>');
    process.exitCode = 1;
    return;
  }
  const filePath = process.argv[2];
  const code = fs.readFileSync(filePath, 'utf8');
  const unit = parse(filePath, code);
  console.log(unit.funcs[0].sts[0]);
}

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
  if (typeName == null) throw new ParseError('expected ident');
  const funName = parseIdent(state);
  if (funName == null) throw new ParseError('expected ident');
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
  if (op !== ')') throw new ParseError("expected right paren");
  if (parseOp(state) !== '{') throw new ParseError("expected left brace");
  const sts = [];
  let st = parseFunSt(state);
  while (st != null) {
    sts.push(st);
    st = parseFunSt(state);
  }
  if (parseOp(state) !== '}') throw new ParseError("expected left brace");
  return {typeName, funName, isExported, args, sts};
}

function parseFunArg(state) {
  const typeName = parseType(state);
  if (typeName == null) throw new ParseError('expected type');
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected ident');
  return {typeName, name};
}

function parseFunSt(state) {
  const exp = parseExp(state);
  if (exp == null) return null;
  if (parseOp(state) !== ';') throw new ParseError("expected semicolon");
  return {exp};
}

function parseExp(state) {
  const str = parseString(state);
  if (str) return str;
  const funCall = parseFunCall(state);
  if (funCall) return funCall;
  return null;
}

function parseString(state) {
  const {code} = state;
  if (code[state.idx] !== '"') return null;
  forward(state);
  let result = '';
  while (state.idx < code.length && code[state.idx] !== '"') {
    if (code[state.idx] === '\n') {
      throw new ParseError("invalid newline within a string literal");
    }
    if (code[state.idx] === '\\') {
      forward(state);
    }
    result += code[state.idx];
    forward(state);
  }
  if (state.idx === state.code.length) {
    throw new ParseError("reached end of file within a string literal");
  }
  forward(state);
  skipSpaces(state);
  return result;
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
  if (op !== ')') throw new ParseError("expected right paren");
  return {qualIdent, args};
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
  if (!/^[a-zA-Z]$/.test(code[state.idx])) return null;
  while (state.idx < code.length && /^[a-zA-Z0-9]$/.test(code[state.idx])) {
    forward(state);
  }
  const endIdx = state.idx;
  skipSpaces(state);
  return code.substring(startIdx, endIdx);
}

function parseType(state) {
  const typeName = parseIdent(state);
  if (typeName == null) throw new ParseError('expected ident');
  const snap = save(state);
  let op = parseOp(state);
  const args = [];
  if (op !== '<') {
    restore(state, snap)
    return {typeName, args};
  }
  do {
    const arg = parseType(state);
    args.push(arg);
    op = parseOp(state);
  } while (op === ',');
  if (op !== '>') throw new ParseError('expected right caret');
  return {typeName, args};
}

function parseOp(state) {
  const op = state.code[state.idx];
  if (/^[(){}[\]<>;.,]$/.test(op)) {
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

main();
