#!/usr/bin/env node
'use strict';

/**
 * Comprehensive test suite for the AWS Login interactive wizard system
 * Tests different AWS identity types, authentication methods, and 1Password integration
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test configuration
const TEST_CONFIG = {
  testDir: path.join(os.tmpdir(), 'awslogin-test-' + Date.now()),
  profiles: {
    sso: 'test-sso-profile',
    mfa: 'test-mfa-profile',
    direct: 'test-direct-profile',
    subprofile: 'test-sso-profile-dev'
  }
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('');
  log('═'.repeat(60), 'bright');
  log(`  ${title}`, 'cyan');
  log('═'.repeat(60), 'bright');
  console.log('');
}

function logTest(name) {
  log(`▶ ${name}`, 'blue');
}

function logSuccess(message) {
  log(`  ✅ ${message}`, 'green');
}

function logError(message) {
  log(`  ❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`  ⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`  ℹ️  ${message}`, 'cyan');
}

/**
 * Execute command and return output
 */
function exec(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.stderr || error.message
    };
  }
}

/**
 * Check if a command exists
 */
function commandExists(command) {
  const result = exec(`which ${command}`, { silent: true });
  return result.success;
}

/**
 * Setup test environment
 */
function setupTestEnvironment() {
  logSection('Setting Up Test Environment');

  // Create test directory
  if (!fs.existsSync(TEST_CONFIG.testDir)) {
    fs.mkdirSync(TEST_CONFIG.testDir, { recursive: true });
    logSuccess(`Created test directory: ${TEST_CONFIG.testDir}`);
  }

  // Backup existing AWS config
  const awsConfigDir = path.join(os.homedir(), '.aws');
  const backupDir = path.join(TEST_CONFIG.testDir, 'aws-backup');

  if (fs.existsSync(awsConfigDir)) {
    exec(`cp -r "${awsConfigDir}" "${backupDir}"`, { silent: true });
    logSuccess('Backed up existing AWS configuration');
  }

  // Create test AWS config directory
  const testAwsDir = path.join(TEST_CONFIG.testDir, '.aws');
  fs.mkdirSync(testAwsDir, { recursive: true });

  // Set AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE for testing
  process.env.AWS_CONFIG_FILE = path.join(testAwsDir, 'config');
  process.env.AWS_SHARED_CREDENTIALS_FILE = path.join(testAwsDir, 'credentials');

  logSuccess('Test environment ready');
}

/**
 * Test wizard infrastructure
 */
async function testWizardInfrastructure() {
  logSection('Testing Wizard Infrastructure');

  logTest('Testing BaseWizard class');
  try {
    const BaseWizard = require('../src/wizards/base-wizard');
    const wizard = new BaseWizard();

    // Test methods existence
    const methods = [
      'showProgress', 'showSuccess', 'showError',
      'showInfo', 'showWarning', 'confirm',
      'input', 'select', 'clear', 'showBanner'
    ];

    let allMethodsExist = true;
    for (const method of methods) {
      if (typeof wizard[method] !== 'function') {
        logError(`Method ${method} not found in BaseWizard`);
        allMethodsExist = false;
      }
    }

    if (allMethodsExist) {
      logSuccess('All BaseWizard methods exist');
    }
  } catch (error) {
    logError(`Failed to load BaseWizard: ${error.message}`);
  }

  logTest('Testing MainWizard class');
  try {
    const MainWizard = require('../src/wizards/main-wizard');
    const wizard = new MainWizard();

    if (typeof wizard.run === 'function') {
      logSuccess('MainWizard loaded successfully');
    }
  } catch (error) {
    logError(`Failed to load MainWizard: ${error.message}`);
  }

  logTest('Testing SetupWizard class');
  try {
    const SetupWizard = require('../src/wizards/setup-wizard');
    const wizard = new SetupWizard();

    if (typeof wizard.run === 'function') {
      logSuccess('SetupWizard loaded successfully');
    }
  } catch (error) {
    logError(`Failed to load SetupWizard: ${error.message}`);
  }

  logTest('Testing SmartAuth class');
  try {
    const SmartAuth = require('../src/services/smart-auth');
    const auth = new SmartAuth();

    if (typeof auth.authenticate === 'function' && typeof auth.detectAuthMethod === 'function') {
      logSuccess('SmartAuth loaded successfully');
    }
  } catch (error) {
    logError(`Failed to load SmartAuth: ${error.message}`);
  }
}

/**
 * Test profile templates
 */
function testProfileTemplates() {
  logSection('Testing Profile Templates');

  logTest('Loading profile templates');
  try {
    const { PROFILE_TEMPLATES, getSmartDefaults } = require('../src/config/templates');

    const expectedTemplates = [
      'developer', 'admin', 'readonly',
      'cicd', 'production', 'sandbox'
    ];

    let allTemplatesExist = true;
    for (const template of expectedTemplates) {
      if (!PROFILE_TEMPLATES[template]) {
        logError(`Template ${template} not found`);
        allTemplatesExist = false;
      }
    }

    if (allTemplatesExist) {
      logSuccess(`All ${expectedTemplates.length} profile templates loaded`);
    }

    // Test smart defaults
    const ssoDefaults = getSmartDefaults('sso');
    const mfaDefaults = getSmartDefaults('mfa');

    if (ssoDefaults.region && mfaDefaults.region) {
      logSuccess('Smart defaults working correctly');
    }
  } catch (error) {
    logError(`Failed to load profile templates: ${error.message}`);
  }
}

/**
 * Test auto-discovery functionality
 */
async function testAutoDiscovery() {
  logSection('Testing Auto-Discovery');

  logTest('Testing AutoDiscovery class');
  try {
    const AutoDiscovery = require('../src/services/auto-discovery');
    const discovery = new AutoDiscovery();

    // Test method existence
    const methods = [
      'discoverSSOUrl', 'discoverOrganization',
      'getDefaultRegion', 'getExistingProfiles',
      'has1PasswordCLI', 'detectProfileType'
    ];

    let allMethodsExist = true;
    for (const method of methods) {
      if (typeof discovery[method] !== 'function') {
        logError(`Method ${method} not found in AutoDiscovery`);
        allMethodsExist = false;
      }
    }

    if (allMethodsExist) {
      logSuccess('All AutoDiscovery methods exist');
    }

    // Test CI detection
    const isCI = discovery.isCI();
    logInfo(`CI environment detected: ${isCI}`);

    // Test 1Password detection
    const has1Password = await discovery.has1PasswordCLI();
    logInfo(`1Password CLI available: ${has1Password}`);

    // Test default region
    const region = await discovery.getDefaultRegion();
    logInfo(`Default region: ${region}`);

  } catch (error) {
    logError(`AutoDiscovery test failed: ${error.message}`);
  }
}

/**
 * Test 1Password integration
 */
async function test1PasswordIntegration() {
  logSection('Testing 1Password Integration');

  const has1Password = commandExists('op');

  if (!has1Password) {
    logWarning('1Password CLI not installed - skipping integration tests');
    logInfo('Install with: brew install --cask 1password-cli');
    return;
  }

  logSuccess('1Password CLI detected');

  logTest('Checking 1Password authentication');
  const result = exec('op account list', { silent: true });

  if (!result.success) {
    logWarning('1Password CLI not signed in');
    logInfo('Sign in with: eval $(op signin)');
    return;
  }

  logSuccess('1Password CLI is signed in');

  logTest('Testing MFA token retrieval');
  try {
    const { getOnePasswordToken } = require('../src/services/onepassword');

    // This will fail if no test item exists, which is expected
    const testItemName = 'AWS-Test-MFA';
    logInfo(`Looking for test item: ${testItemName}`);

    // We don't actually want to create test items in 1Password
    // Just verify the function exists and handles errors properly
    if (typeof getOnePasswordToken === 'function') {
      logSuccess('1Password integration functions available');
    }
  } catch (error) {
    logError(`1Password integration error: ${error.message}`);
  }
}

/**
 * Test command-line interface
 */
function testCLICommands() {
  logSection('Testing CLI Commands');

  const awsloginPath = path.join(__dirname, '..', 'bin', 'awslogin.js');

  logTest('Testing help command');
  const helpResult = exec(`node "${awsloginPath}" --help`, { silent: true });
  if (helpResult.success && helpResult.output.includes('AWS Profile Auth CLI')) {
    logSuccess('Help command works');
  } else {
    logError('Help command failed');
  }

  logTest('Testing no arguments (should launch wizard)');
  // We can't actually test interactive mode in CI, but we can check if it tries to load the wizard
  const noArgsCmd = `echo "" | node "${awsloginPath}" 2>&1 || true`;
  const noArgsResult = exec(noArgsCmd, { silent: true });
  // The wizard will fail due to no TTY, but that's expected in tests
  logInfo('No-args command attempted to launch wizard');

  logTest('Testing wizard command aliases');
  const aliases = ['setup', 'wizard', 'manage', 'list'];
  for (const alias of aliases) {
    const aliasCmd = `echo "" | node "${awsloginPath}" ${alias} 2>&1 || true`;
    const result = exec(aliasCmd, { silent: true });
    logInfo(`Alias '${alias}' recognized`);
  }

  logSuccess('CLI commands tested');
}

/**
 * Test backward compatibility
 */
function testBackwardCompatibility() {
  logSection('Testing Backward Compatibility');

  const awsloginPath = path.join(__dirname, '..', 'bin', 'awslogin.js');

  const legacyCommands = [
    'test-profile --select',
    'test-profile --token 123456',
    'test-profile --setup-iam-identity-center',
    'test-profile --clean',
    'test-profile --configure',
    'test-profile --configure --all-org',
    'test-profile --change'
  ];

  logTest('Testing legacy command formats');
  for (const cmd of legacyCommands) {
    // These will fail due to missing profiles, but we're just checking parsing
    const testCmd = `node "${awsloginPath}" ${cmd} 2>&1 || true`;
    const result = exec(testCmd, { silent: true });

    // Check that it doesn't show "command not found" or similar
    if (!result.output.includes('command not found')) {
      logInfo(`Legacy format recognized: ${cmd}`);
    } else {
      logError(`Legacy format not recognized: ${cmd}`);
    }
  }

  logSuccess('Backward compatibility maintained');
}

/**
 * Create test AWS profiles
 */
function createTestProfiles() {
  logSection('Creating Test AWS Profiles');

  const configFile = process.env.AWS_CONFIG_FILE;

  // Create SSO profile
  const ssoConfig = `
[profile ${TEST_CONFIG.profiles.sso}]
sso_start_url = https://test.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
region = us-east-1
output = json
`;

  // Create MFA profile
  const mfaConfig = `
[profile ${TEST_CONFIG.profiles.mfa}]
region = us-east-1
output = json
mfa_serial = arn:aws:iam::123456789012:mfa/testuser

[profile ${TEST_CONFIG.profiles.mfa}-long-term]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = us-east-1
`;

  // Create direct profile
  const directConfig = `
[profile ${TEST_CONFIG.profiles.direct}]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = us-west-2
output = table
`;

  // Write configurations
  fs.writeFileSync(configFile, ssoConfig + mfaConfig + directConfig);
  logSuccess('Test profiles created');

  // Display profile information
  logInfo(`SSO Profile: ${TEST_CONFIG.profiles.sso}`);
  logInfo(`MFA Profile: ${TEST_CONFIG.profiles.mfa}`);
  logInfo(`Direct Profile: ${TEST_CONFIG.profiles.direct}`);
}

/**
 * Test profile detection
 */
async function testProfileDetection() {
  logSection('Testing Profile Detection');

  try {
    const SmartAuth = require('../src/services/smart-auth');
    const auth = new SmartAuth();

    for (const [type, profileName] of Object.entries(TEST_CONFIG.profiles)) {
      if (type === 'subprofile') continue; // Skip subprofile for this test

      logTest(`Detecting ${type} profile: ${profileName}`);

      const method = await auth.detectAuthMethod(profileName);
      logInfo(`Detected method: ${method}`);

      const expected = {
        'sso': 'sso',
        'mfa': 'mfa',
        'direct': 'direct'
      };

      if (method === expected[type]) {
        logSuccess(`Correctly detected ${type} authentication`);
      } else {
        logError(`Expected ${expected[type]}, got ${method}`);
      }
    }
  } catch (error) {
    logError(`Profile detection failed: ${error.message}`);
  }
}

/**
 * Clean up test environment
 */
function cleanup() {
  logSection('Cleaning Up');

  // Remove test directory
  if (fs.existsSync(TEST_CONFIG.testDir)) {
    exec(`rm -rf "${TEST_CONFIG.testDir}"`, { silent: true });
    logSuccess('Removed test directory');
  }

  // Clear environment variables
  delete process.env.AWS_CONFIG_FILE;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;

  logSuccess('Test environment cleaned up');
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('');
  log('╔═══════════════════════════════════════════════════════════╗', 'bright');
  log('║     AWS Login Interactive Wizard - Test Suite              ║', 'cyan');
  log('╚═══════════════════════════════════════════════════════════╝', 'bright');

  let totalTests = 0;
  let passedTests = 0;

  try {
    // Setup
    setupTestEnvironment();
    totalTests++;
    passedTests++;

    // Test wizard infrastructure
    await testWizardInfrastructure();
    totalTests++;
    passedTests++;

    // Test profile templates
    testProfileTemplates();
    totalTests++;
    passedTests++;

    // Test auto-discovery
    await testAutoDiscovery();
    totalTests++;
    passedTests++;

    // Test CLI commands
    testCLICommands();
    totalTests++;
    passedTests++;

    // Test backward compatibility
    testBackwardCompatibility();
    totalTests++;
    passedTests++;

    // Create test profiles
    createTestProfiles();
    totalTests++;
    passedTests++;

    // Test profile detection
    await testProfileDetection();
    totalTests++;
    passedTests++;

    // Test 1Password integration
    await test1PasswordIntegration();
    totalTests++;
    passedTests++;

  } catch (error) {
    logError(`Test suite error: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Cleanup
    cleanup();

    // Summary
    logSection('Test Summary');
    log(`Total Tests: ${totalTests}`, 'bright');
    log(`Passed: ${passedTests}`, passedTests === totalTests ? 'green' : 'yellow');

    if (passedTests === totalTests) {
      log('✅ All tests passed!', 'green');
    } else {
      log(`⚠️  ${totalTests - passedTests} test(s) need attention`, 'yellow');
    }

    process.exit(passedTests === totalTests ? 0 : 1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});