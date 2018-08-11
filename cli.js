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
  console.log(unit);
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
    return unit;
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    throw Error(`${filePath}:${state.line}:${state.col}: ${error.message}`);
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
  if (parseOp(state) !== '}') throw new ParseError("expected left brace");
  return {typeName, funName, isExported, args};
}

function parseFunArg(state) {
  const typeName = parseType(state);
  if (typeName == null) throw new ParseError('expected type');
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected ident');
  return {typeName, name};
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
  if (/^[(){}[\]<>]$/.test(op)) {
    forward(state);
    skipSpaces(state);
    return op;
  }
  return null;
}

function skipSpaces(state) {
  const {code} = state;
  while (state.idx < code.length && /^[ \t\n]$/.test(code[state.idx])) {
    forward(state);
  }
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
