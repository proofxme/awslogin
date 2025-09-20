'use strict';

const readline = require('readline');

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askText(message, {
  defaultValue,
  validate,
  maskDefault = false
} = {}) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const suffix = defaultValue !== undefined ? ` [default: ${maskDefault ? '••••' : defaultValue}]` : '';
    const answer = await askQuestion(`${message}${suffix}: `);
    const value = answer || (defaultValue !== undefined ? defaultValue : '');

    if (typeof validate === 'function') {
      const validationMessage = validate(value);
      if (validationMessage) {
        console.log(`⚠️  ${validationMessage}`);
        continue;
      }
    }

    return value;
  }
}

async function askNonEmpty(message, options = {}) {
  return askText(message, {
    ...options,
    validate: (value) => {
      if (!value || !value.trim()) {
        return 'Value cannot be empty.';
      }
      if (typeof options.validate === 'function') {
        return options.validate(value);
      }
      return null;
    }
  });
}

async function askYesNo(question, { defaultYes = true } = {}) {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = await askQuestion(`${question}${suffix} `);

  if (!answer) {
    return defaultYes;
  }

  const normalized = answer.toLowerCase();
  if (['y', 'yes'].includes(normalized)) {
    return true;
  }
  if (['n', 'no'].includes(normalized)) {
    return false;
  }
  return defaultYes;
}

async function selectFromList(options, {
  header,
  prompt = 'Enter selection number',
  formatOption,
  valueSelector,
  defaultValue
} = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('selectFromList requires at least one option');
  }

  const getValue = typeof valueSelector === 'function' ? valueSelector : (option) => option;
  const getLabel = typeof formatOption === 'function'
    ? (option, index) => formatOption(option, index)
    : (option) => {
      if (typeof option === 'string') {
        return option;
      }
      if (option && typeof option === 'object') {
        return option.label || option.name || option.title || JSON.stringify(option);
      }
      return String(option);
    };

  const defaultIndex = defaultValue !== undefined
    ? options.findIndex((option) => {
        const optionValue = getValue(option);
        return optionValue === defaultValue || option === defaultValue;
      })
    : -1;

  if (header) {
    console.log(header);
  }

  options.forEach((option, index) => {
    const label = getLabel(option, index);
    const marker = defaultIndex === index ? ' (default)' : '';
    console.log(`   ${index + 1}. ${label}${marker}`);
  });

  const promptSuffix = defaultIndex >= 0 ? ` [default ${defaultIndex + 1}]` : '';

  while (true) {
    const answer = await askQuestion(`\n${prompt}${promptSuffix}: `);

    if (!answer && defaultIndex >= 0) {
      return options[defaultIndex];
    }

    const index = Number.parseInt(answer, 10) - 1;

    if (!Number.isNaN(index) && index >= 0 && index < options.length) {
      return options[index];
    }

    console.log('⚠️  Invalid selection, please try again.');
  }
}

module.exports = {
  askQuestion,
  askText,
  askNonEmpty,
  askYesNo,
  selectFromList
};
