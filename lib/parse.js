'use strict';

class ParseError extends Error {}

function parse(filePath, code) {
  const state = {code, line: 1, col: 1, idx: 0, locRs: []};
  try {
    skipSpaces(state);
    let unit = {decls: []};
    let decl = parseDecl(state);
    while (decl != null) {
      unit.decls.push(decl);
      decl = parseDecl(state);
    }
    if (state.idx < code.length)
      throw new ParseError(`unexpected character "${code[state.idx]}"`);
    return unit;
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    error.message = `${filePath}:${state.line}:${state.col}: ${error.message}`;
    throw error;
  }
}

function parseDecl(state) {
  let decl;
  if (decl = parseStruct(state)) return decl;
  if (decl = parseFunction(state)) return decl;
  return null;
}

function parseStruct(state) {
  const qualifier = parseKeyword(state, new Set(['struct']));
  if (qualifier == null) return null;
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected struct name');
  if (parseOp(state, ['{']) !== '{') throw new ParseError("expected left brace");
  const fields = [];
  let field = parseStructField(state);
  while (field != null) {
    fields.push(field);
    if (parseOp(state, [',']) === ',') {
      field = parseStructField(state);
    } else {
      field = null;
    }
  }
  if (parseOp(state, ['}']) !== '}')
    throw new ParseError("expected right brace or field");
  return {type: 'struct', name, fields};
}

function parseStructField(state) {
  const type = parseType(state);
  if (type == null) return null;
  const name = parseIdent(state);
  if (name == null) throw new ParseError('expected field name');
  return {type, name};
}

function parseFunction(state) {
  let qualifier = parseKeyword(state, new Set(['export']));
  let isExported = qualifier != null;
  let retType = parseIdent(state);
  if (retType == null) {
    const voidKeyword = parseKeyword(state, new Set(['void']));
    if (voidKeyword == null) {
      if (isExported) throw new ParseError('expected function return type');
      return null;
    }
    retType = {value: null, loc: voidKeyword.loc};
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
  if (parseOp(state) !== '}') throw new ParseError("expected statement or right brace");
  return {type: 'func', retType, name, isExported, args, sts};
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
    if (parseOp(state, [';']) !== ';') throw new ParseError("expected semicolon");
    return st;
  }
  if (parseOp(state, ['{']) === '{') {
    const sts = [];
    let st = parseFunSt(state);
    while (st != null) {
      sts.push(st);
      st = parseFunSt(state);
    }
    if (parseOp(state, ['}']) != '}') throw new ParseError("expected right brace");
    return {type: 'block', sts};
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
  const keyword = parseKeyword(state, new Set(['return']));
  if (keyword != null) {
    if (keyword.value === 'return') return parseReturnSt(state);
  }
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
  if (parseOp(state, ['=']) === '=') {
    init = parseExp(state);
    if (init == null) throw new ParseError('expected initializer expression');
  }
  return {type: 'decl', loc: [blc, loc(state)], declType, name, init};
}

function parseIfSt(state) {
  if (parseOp(state, ['(']) !== '(') throw new ParseError("expected left paren");
  const cond = parseExp(state);
  if (cond == null) throw new ParseError('expected expression');
  if (parseOp(state, [')']) !== ')') throw new ParseError("expected right paren");
  const body = parseFunSt(state);
  if (body == null) throw new ParseError('expected statement');
  return {type: 'if', cond, body};
}

function parseReturnSt(state) {
  const value = parseExp(state);
  if (value == null) throw new ParseError('expected expression');
  return {type: 'return', value};
}

function parseExp(state) {
  return parseCompExp(state);
}

function parseCompExp(state) {
  const blr = loc(state);
  let left = parseSumExp(state);
  if (left == null) return null;
  let op = parseOp(state, ['==']);
  while (op != null) {
    let right = parseSumExp(state);
    if (right == null) throw new ParseError("expected expression");
    left = {type: 'eq', left, right, loc: [blr, loc(state)]};
    op = parseOp(state, ['==']);
  }
  return left;
}

function parseSumExp(state) {
  const blr = loc(state);
  let left = parsePrimaryExp(state);
  if (left == null) return null;
  let op = parseOp(state, ['+', '-']);
  while (op != null) {
    let right = parsePrimaryExp(state);
    if (right == null) throw new ParseError("expected expression");
    left = {type: op === '+' ? 'sum' : 'subt', left, right, loc: [blr, loc(state)]};
    op = parseOp(state, ['+', '-']);
  }
  return left;
}

function parsePrimaryExp(state) {
  let op = parseOp(state, ['(']);
  if (op != null) {
    const exp = parseExp(state);
    if (exp == null) throw new ParseError("expected expression");
    op = parseOp(state, [')']);
    if (op == null) throw new ParseError("expected right paren");
    return exp;
  }
  let exp;
  if (exp = parseVector(state)) return exp;
  if (exp = parseString(state)) return exp;
  if (exp = parseNumber(state)) return exp;
  if (exp = parseBool(state)) return exp;
  if (exp = parseAccessExp(state)) return exp;
  return null;
}

function parseVector(state) {
  const blr = loc(state);
  if (parseOp(state, ['[']) == null) return null;
  const items = [];
  let item = parseExp(state);
  while (item != null) {
    items.push(item);
    if (parseOp(state, [',']) == null) {
      item = null;
      continue;
    }
    item = parseExp(state);
  }
  if (parseOp(state, [']']) == null)
    throw new ParseError("expected right bracket");
  return {type: 'vec', items, loc: [blr, loc(state)]};
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

function parseBool(state) {
  const keyword = parseKeyword(state, new Set(['true', 'false']));
  if (keyword == null) return null;
  return {type: 'bool', value: keyword.value === 'true', loc: keyword.loc};
}

function parseAccessExp(state) {
  const blr = loc(state);
  let ident = parseIdent(state);
  if (ident == null) return null;
  let exp = {type: 'ref', ident, loc: [blr, loc(state)]};
  const OPS = ['.', '(', '['];
  let op = parseOp(state, OPS);
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
        if (parseOp(state, [']']) !== ']') throw new Error('expected right bracket');
        return {type: 'key_access', target: exp, key, loc: [blr, loc(state)]};
        break;
    }
    op = parseOp(state, OPS);
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

const KEYWORDS = new Set([
  'export', 'if', 'return', 'true', 'false', 'struct',
  'void',
]);

function parseKeyword(state, set) {
  const snap = save(state);
  const keyword = parseIdentOrKeyword(state);
  if (keyword == null) return null;
  if (set.has(keyword.value)) {
    if (!KEYWORDS.has(keyword.value))
      throw new Error(`invalid keyword "${keyword.value}"`);
    return keyword;
  }
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

const DEFAULT_OPS = ['(', ')', '{', '}', '[', ']', '<', '>', ';', '.', ','];
function parseOp(state, ops = DEFAULT_OPS) {
  const {code, idx} = state;
  for (let i = 0; i < ops.length; ++i) {
    const op = ops[i];
    let j = 0;
    while (j < op.length && j + idx < code.length && code[j + idx] === op[j]) ++j;
    if (j < op.length) continue;
    for (let k = 0; k < op.length; ++k) forward(state);
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
      if (state.idx == code.length - 1) {
        throw new ParseError('unexpected end of file within comment');
      }
      forward(state);
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
