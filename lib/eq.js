'use strict';

function eq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length != b.length) return false;
    for (let i = 0; i < a.length; ++i) {
      if (!eq(a[i], b[i])) return false;
    }
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  const keys = Object.keys(a);
  if (!eq(keys, Object.keys(b))) return false;
  for (const key of keys) {
    if (!eq(a[key], b[key])) return false;
  }
  return true;
}

module.exports = eq;
