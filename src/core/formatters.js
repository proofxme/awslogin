'use strict';

function slugify(value, { fallback = 'profile' } = {}) {
  if (!value) {
    return fallback;
  }

  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

module.exports = {
  slugify
};
