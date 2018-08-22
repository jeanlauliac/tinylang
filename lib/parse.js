'use strict';

class ParseError extends Error {}

function parse(filePath, code) {
  const state = {code, line: 1, col: 1, idx: 0, locRs: []};
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
  let qualifier = parseKeyword(state, new Set(['export']));
  let isExported = qualifier != null;
  let typeName = parseIdent(state);
  if (typeName == null) {
    if (isExported) throw new ParseError('expected function return type');
    return null;
  }
  const name = parseIdent(state);
  if (parseOp(state) !== '(')
    throw new ParseError("expected left paren or function name");
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
  if (parseOp(state) !== '}') throw new ParseError("expected right brace");
  return {typeName, name, isExported, args, sts};
}

function parseFunArg(state) {
  const type = parseType(state);
  if (type == null) return null;
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected argument name');
  return {type, name: name.value};
}

function parseFunSt(state) {
  const st = parsePrimarySt(state);
  if (st != null) {
    if (parseOp(state, /^;$/) !== ';') throw new ParseError("expected semicolon");
    return st;
  }
  const keyword = parseKeyword(state, new Set(['if']));
  if (keyword == null) return null;
  if (keyword.value === 'if') return parseIfSt(state);
  return null;
}

function parsePrimarySt(state) {
  const decl = parseLocalDecl(state);
  if (decl != null) return decl;
  const value = parseExp(state);
  if (value != null) return {type: 'exp', value};
  return null;
}

function parseLocalDecl(state) {
  const blc = loc(state);
  const snap = save(state);
  const declType = parseType(state);
  if (declType == null) return null;
  const name = parseIdent(state);
  if (name == null) {
    restore(state, snap);
    return null;
  }
  let init = null;
  if (parseOp(state, /^=$/) === '=') {
    init = parseExp(state);
    if (init == null) throw new ParseError('expected initializer expression');
  }
  return {type: 'decl', loc: [blc, loc(state)], declType, name, init};
}

function parseIfSt(state) {
  if (parseOp(state, /^\($/) !== '(') throw new ParseError("expected left paren");
  const cond = parseExp(state);
  if (cond == null) throw new ParseError('expected expression');
  if (parseOp(state, /^\)$/) !== ')') throw new ParseError("expected right paren");
  const body = parseExp(state);
  if (body == null) throw new ParseError('expected expression');
  if (parseOp(state, /^;$/) !== ';') throw new ParseError("expected semicolon");
  return {type: 'if', cond, sts: [body]};
}

function parseExp(state) {
  return parseSumExp(state);
}

function parseSumExp(state) {
  const blr = loc(state);
  let left = parsePrimaryExp(state);
  if (left == null) return null;
  let op = parseOp(state, /^[+-]$/);
  while (op != null) {
    let right = parsePrimaryExp(state);
    if (right == null) throw new ParseError("expected expression");
    left = {type: op === '+' ? 'sum' : 'subt', left, right, loc: [blr, loc(state)]};
    op = parseOp(state, /^[+-]$/);
  }
  return left;
}

function parsePrimaryExp(state) {
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
  if (exp = parseAccessExp(state)) return exp;
  return null;
}

function parseString(state) {
  const {code} = state;
  if (code[state.idx] !== '"') return null;
  const blr = loc(state);
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
  return {type: 'str', value, loc: [blr, loc(state)]};
}

function parseNumber(state) {
  const {code} = state;
  if (!/^[0-9.]$/.test(code[state.idx])) return null;
  const blr = loc(state);
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
  return {type: 'num', value, loc: [blr, loc(state)]};
}

function parseAccessExp(state) {
  const blr = loc(state);
  let ident = parseIdent(state);
  if (ident == null) return null;
  let exp = {type: 'ref', ident, loc: [blr, loc(state)]};
  const OP_RE = /^[.([]$/;
  let op = parseOp(state, OP_RE);
  while (op != null) {
    switch (op) {
      case '.':
        const member = parseIdent(state);
        if (member == null) throw new ParseError('expected identifier after dot');
        exp = {type: 'dot_access', target: exp, member, loc: [blr, loc(state)]};
        break;
      case '(':
        exp = parseFunCall(state, exp, blr);
        break;
      case '[':
        const key = parseExp(state);
        if (key == null) throw new Error('expected expression for key access');
        if (parseOp(state, /^\]$/) !== ']') throw new Error('expected right bracket');
        return {type: 'key_access', target: exp, key, loc: [blr, loc(state)]};
        break;
    }
    op = parseOp(state, OP_RE);
  }
  return exp;
}

function parseFunCall(state, callee, blr) {
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
  return {type: 'fun_call', callee, args, loc: [blr, loc(state)]};
}

const KEYWORDS = new Set(['export', 'if', 'return']);

function parseKeyword(state, set) {
  const snap = save(state);
  const keyword = parseIdentOrKeyword(state);
  if (keyword == null) return null;
  if (KEYWORDS.has(keyword.value) && set.has(keyword.value)) return keyword;
  restore(state, snap);
  return null;
}

function parseIdent(state) {
  const snap = save(state);
  const ident = parseIdentOrKeyword(state);
  if (ident == null) return null;
  if (!KEYWORDS.has(ident.value)) return ident;
  restore(state, snap);
  return null;
}

function parseIdentOrKeyword(state) {
  const blr = loc(state);
  const {code} = state;
  const startIdx = state.idx;
  if (state.idx >= code.length) return null;
  if (!/^[a-zA-Z_]$/.test(code[state.idx]) && code[state.idx].charCodeAt(0) < 128) return null;
  while (state.idx < code.length && (
    /^[a-zA-Z0-9_]$/.test(code[state.idx]) ||
    code[state.idx].charCodeAt(0) >= 128
  )) {
    forward(state);
  }
  const endIdx = state.idx;
  skipSpaces(state);
  return {value: code.substring(startIdx, endIdx), loc: [blr, loc(state)]};
}

function parseType(state) {
  const typeName = parseIdent(state);
  if (typeName == null) return null;
  const snap = save(state);
  let op = parseOp(state);
  const args = [];
  if (op !== '<') {
    restore(state, snap)
    return {typeName: typeName.value, args};
  }
  do {
    const arg = parseType(state);
    if (arg == null) throw new ParseError('expected type name');
    args.push(arg);
    op = parseOp(state);
  } while (op === ',');
  if (op !== '>') throw new ParseError('expected right caret');
  return {typeName: typeName.value, args};
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

function loc(state) {
  const {line, col} = state;
  return {line, col};
}

module.exports = parse;
