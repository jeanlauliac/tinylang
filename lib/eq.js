'use strict';

function eq(a, b, d = 10) {
  if (d === 0) throw new Error('maximum depth reached');
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length != b.length) return false;
    for (let i = 0; i < a.length; ++i) {
      if (!eq(a[i], b[i], d - 1)) return false;
    }
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) {
    return false;
  }
  const keys = Object.keys(a);
  if (!eq(keys, Object.keys(b), d - 1)) return false;
  for (const key of keys) {
    if (!eq(a[key], b[key], d - 1)) return false;
  }
  return true;
}

module.exports = eq;
