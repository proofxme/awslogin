'use strict';

const OUTPUT_FORMATS = [
  { value: 'json', label: 'json — structured JSON output (default AWS CLI format)' },
  { value: 'yaml', label: 'yaml — human-readable YAML output' },
  { value: 'text', label: 'text — plain text response' },
  { value: 'table', label: 'table — column-aligned table output' }
];

function buildOutputChoices(currentValue, { includeKeepCurrent = true } = {}) {
  const items = OUTPUT_FORMATS.map((format) => ({
    value: format.value,
    label: format.label
  }));

  if (includeKeepCurrent) {
    items.push({
      value: currentValue || null,
      label: currentValue ? `Keep current setting (${currentValue})` : 'Keep output format unset'
    });
  }

  return items;
}

module.exports = {
  buildOutputChoices
};
