#!/usr/bin/env node
'use strict';

const TestFramework = require('./test-framework');
const test = new TestFramework();

// Mock modules
const mockAWS = require('./mocks/aws-mock');
const mockFS = require('./mocks/fs-mock');
const mockChild = require('./mocks/child-process-mock');
const mockPrompt = require('./mocks/prompt-mock');

// Test imports
const authManagerTests = require('./tests/auth-manager.test');
const ssoTests = require('./tests/sso.test');
const mfaTests = require('./tests/mfa.test');
const awsConfigTests = require('./tests/aws-config.test');
const setupWizardTests = require('./tests/setup-wizard.test');
const performanceTests = require('./tests/performance.test');
const onePasswordTests = require('./tests/onepassword.test');
const identityCenterTests = require('./tests/identity-center.test');
const profileConfigTests = require('./tests/profile-config.test');

async function runAllTests() {
  console.log('🧪 AWS Login Test Suite v3.0.4');
  console.log('================================\n');

  // Setup global mocks
  global.mockAWS = mockAWS;
  global.mockFS = mockFS;
  global.mockChild = mockChild;
  global.mockPrompt = mockPrompt;

  // Run test suites
  await authManagerTests(test);
  await ssoTests(test);
  await mfaTests(test);
  await awsConfigTests(test);
  await setupWizardTests(test);
  await performanceTests(test);
  await onePasswordTests(test);
  await identityCenterTests(test);
  await profileConfigTests(test);

  // Print results
  const success = test.printSummary();
  process.exit(success ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});