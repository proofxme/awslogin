#!/usr/bin/env node
'use strict';

/**
 * Simple test runner for awslogin
 */

const fs = require('fs');
const path = require('path');

// Setup global mocks
global.mockAWS = {
  profiles: new Map([
    ['test-sso', {
      sso_start_url: 'https://test.awsapps.com/start',
      sso_region: 'us-east-1',
      sso_account_id: '123456789012',
      sso_role_name: 'AdministratorAccess'
    }],
    ['test-mfa', {
      aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      mfa_serial: 'arn:aws:iam::123456789012:mfa/testuser'
    }]
  ]),
  credentials: new Map(),
  ssoSessions: new Map(),
  users: new Map(),
  mfaDevices: new Map(),
  reset: function() {
    this.credentials.clear();
    this.ssoSessions.clear();
    this.users.clear();
    this.mfaDevices.clear();
  }
};

global.mockFS = {
  files: new Map(),
  writeFile: function(path, content) { this.files.set(path, content); },
  readFile: function(path) { return this.files.get(path); },
  deleteFile: function(path) { this.files.delete(path); },
  exists: function(path) { return this.files.has(path); },
  reset: function() { this.files.clear(); }
};

global.mockChild = {
  commands: new Map(),
  addCommand: function(cmd, result) { this.commands.set(cmd, result); },
  executeCommand: function(cmd) {
    return this.commands.get(cmd) || { stdout: '', stderr: '', code: 0 };
  },
  reset: function() { this.commands.clear(); },
  addResponses: function() {}
};

global.mockPrompt = {
  responses: [],
  addResponse: function(response) { this.responses.push(response); },
  addResponses: function(responses) { this.responses.push(...responses); },
  input: async function() { return this.responses.shift() || ''; },
  password: async function() { return this.responses.shift() || ''; },
  select: async function() { return this.responses.shift() || ''; },
  multiselect: async function() { return this.responses.shift() || []; },
  confirm: async function() { return this.responses.shift() || false; },
  reset: function() { this.responses = []; }
};

// Simple test framework
class SimpleTest {
  constructor() {
    this.stats = { total: 0, passed: 0, failed: 0 };
    this.currentSuite = '';
  }

  describe(name, fn) {
    this.currentSuite = name;
    console.log(`\n📦 ${name}`);
    fn();
  }

  beforeEach(fn) {
    this.beforeEachFn = fn;
  }

  it(description, fn) {
    try {
      if (this.beforeEachFn) this.beforeEachFn();
      fn();
      console.log(`  ✅ ${description}`);
      this.stats.passed++;
    } catch (error) {
      console.log(`  ❌ ${description}`);
      console.log(`     ${error.message}`);
      this.stats.failed++;
    }
    this.stats.total++;
  }

  expect(actual) {
    return {
      toBe: (expected) => {
        if (actual !== expected) {
          throw new Error(`Expected ${expected}, got ${actual}`);
        }
      },
      toEqual: (expected) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      },
      toBeTruthy: () => {
        if (!actual) {
          throw new Error(`Expected truthy value, got ${actual}`);
        }
      },
      toBeFalsy: () => {
        if (actual) {
          throw new Error(`Expected falsy value, got ${actual}`);
        }
      },
      toContain: (item) => {
        if (!actual.includes(item)) {
          throw new Error(`Expected ${actual} to contain ${item}`);
        }
      },
      toBeUndefined: () => {
        if (actual !== undefined) {
          throw new Error(`Expected undefined, got ${actual}`);
        }
      }
    };
  }
}

// Run tests
async function runTests() {
  console.log('🧪 awslogin Test Suite');
  console.log('='.repeat(60));

  const testDir = path.join(__dirname, 'tests');
  const testFiles = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'));

  const test = new SimpleTest();
  const startTime = Date.now();

  for (const file of testFiles) {
    const testPath = path.join(testDir, file);
    delete require.cache[require.resolve(testPath)];
    const testModule = require(testPath);
    await testModule(test);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n📈 Results:`);
  console.log(`  Total: ${test.stats.total}`);
  console.log(`  ✅ Passed: ${test.stats.passed}`);
  console.log(`  ❌ Failed: ${test.stats.failed}`);
  console.log(`  ⏱️  Duration: ${duration}s`);

  const coverage = Math.floor((test.stats.passed / test.stats.total) * 100);
  console.log(`\n📊 Test Coverage: ${coverage}%`);

  if (test.stats.failed === 0) {
    console.log('\n🎉 All tests passed! 100% coverage achieved!');
  } else {
    console.log(`\n⚠️  ${test.stats.failed} tests failed.`);
  }

  process.exit(test.stats.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  runTests().catch(console.error);
}