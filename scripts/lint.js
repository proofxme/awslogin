#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const { join } = require('path');

function collectJsFiles(root) {
  const files = [];

  function walk(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  if (statSync(root).isDirectory()) {
    walk(root);
  }

  return files;
}

const targets = ['src', 'bin', 'scripts'].filter((dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch (error) {
    return false;
  }
});

const filesToCheck = targets.flatMap((dir) => collectJsFiles(dir));

if (filesToCheck.length === 0) {
  console.log('No JavaScript files found to lint.');
  process.exit(0);
}

let hasErrors = false;

for (const file of filesToCheck) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'inherit' });
  } catch (error) {
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log('✅ Syntax check passed for all JavaScript files.');
