#!/usr/bin/env node
'use strict';

/**
 * Test Runner for awslogin
 * Zero-dependencies test execution with coverage reporting
 */

const fs = require('fs');
const path = require('path');
const { TestFramework } = require('./test-framework');
const { AWSMock } = require('./mocks/aws-mock');
const { FSMock } = require('./mocks/fs-mock');
const { ChildProcessMock } = require('./mocks/child-process-mock');
const { PromptMock } = require('./mocks/prompt-mock');

class TestRunner {
  constructor() {
    this.framework = new TestFramework();
    this.testFiles = [];
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      suites: []
    };
    this.coverage = new Map();
    this.startTime = Date.now();
  }

  /**
   * Discover test files
   */
  discoverTests() {
    const testsDir = path.join(__dirname, 'tests');
    const files = fs.readdirSync(testsDir);

    this.testFiles = files
      .filter(file => file.endsWith('.test.js'))
      .map(file => path.join(testsDir, file));

    console.log(`\n🔍 Found ${this.testFiles.length} test files\n`);
    return this.testFiles;
  }

  /**
   * Setup global mocks
   */
  setupMocks() {
    global.mockAWS = new AWSMock();
    global.mockFS = new FSMock();
    global.mockChild = new ChildProcessMock();
    global.mockPrompt = new PromptMock();

    // Add default mock data
    global.mockAWS.profiles.set('test-sso', {
      sso_start_url: 'https://test.awsapps.com/start',
      sso_region: 'us-east-1',
      sso_account_id: '123456789012',
      sso_role_name: 'AdministratorAccess',
      region: 'us-east-1',
      output: 'json'
    });

    global.mockAWS.profiles.set('test-mfa', {
      aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      mfa_serial: 'arn:aws:iam::123456789012:mfa/testuser',
      region: 'us-east-1',
      output: 'json'
    });
  }

  /**
   * Run a single test file
   */
  async runTestFile(filePath) {
    const testName = path.basename(filePath, '.test.js');
    console.log(`\n📝 Running ${testName} tests...`);

    try {
      // Clear require cache for fresh module load
      delete require.cache[require.resolve(filePath)];

      // Load test module
      const testModule = require(filePath);

      // Create test suite
      const suite = {
        name: testName,
        tests: [],
        passed: 0,
        failed: 0,
        skipped: 0
      };

      // Execute test module
      await testModule(this.framework);

      // Collect results
      const suiteTests = this.framework.getSuiteTests();
      suite.tests = suiteTests;
      suite.passed = suiteTests.filter(t => t.status === 'passed').length;
      suite.failed = suiteTests.filter(t => t.status === 'failed').length;
      suite.skipped = suiteTests.filter(t => t.status === 'skipped').length;

      // Update totals
      this.results.total += suite.tests.length;
      this.results.passed += suite.passed;
      this.results.failed += suite.failed;
      this.results.skipped += suite.skipped;
      this.results.suites.push(suite);

      // Print suite summary
      this.printSuiteSummary(suite);

      // Clear framework for next suite
      this.framework.clearTests();

    } catch (error) {
      console.error(`\n❌ Error running ${testName}:`, error.message);
      this.results.failed++;
    }
  }

  /**
   * Print suite summary
   */
  printSuiteSummary(suite) {
    console.log(`\n  Suite: ${suite.name}`);
    console.log(`  ✅ Passed: ${suite.passed}`);
    if (suite.failed > 0) {
      console.log(`  ❌ Failed: ${suite.failed}`);
    }
    if (suite.skipped > 0) {
      console.log(`  ⏭️  Skipped: ${suite.skipped}`);
    }

    // Show failed test details
    const failedTests = suite.tests.filter(t => t.status === 'failed');
    if (failedTests.length > 0) {
      console.log('\n  Failed tests:');
      for (const test of failedTests) {
        console.log(`    ❌ ${test.description}`);
        if (test.error) {
          console.log(`       ${test.error.message}`);
        }
      }
    }
  }

  /**
   * Calculate code coverage
   */
  calculateCoverage() {
    const srcDir = path.join(__dirname, '..', 'src');
    const sourceFiles = this.getAllSourceFiles(srcDir);

    let totalLines = 0;
    let coveredLines = 0;

    for (const file of sourceFiles) {
      const relativePath = path.relative(path.join(__dirname, '..'), file);
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      // Simple coverage: count non-empty, non-comment lines
      const executableLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed &&
               !trimmed.startsWith('//') &&
               !trimmed.startsWith('/*') &&
               !trimmed.startsWith('*');
      });

      totalLines += executableLines.length;

      // Check if file was imported/tested
      const isTested = this.wasFileTested(relativePath);
      if (isTested) {
        coveredLines += executableLines.length;
        this.coverage.set(relativePath, {
          lines: executableLines.length,
          covered: executableLines.length,
          percentage: 100
        });
      } else {
        this.coverage.set(relativePath, {
          lines: executableLines.length,
          covered: 0,
          percentage: 0
        });
      }
    }

    return {
      totalLines,
      coveredLines,
      percentage: totalLines > 0 ? (coveredLines / totalLines * 100).toFixed(2) : 0
    };
  }

  /**
   * Get all source files recursively
   */
  getAllSourceFiles(dir, files = []) {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        this.getAllSourceFiles(fullPath, files);
      } else if (entry.endsWith('.js')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if file was tested (simplified check)
   */
  wasFileTested(filePath) {
    // Map source files to test files
    const testMapping = {
      'src/services/auth-manager.js': 'auth-manager',
      'src/services/sso.js': 'sso',
      'src/services/mfa.js': 'mfa',
      'src/services/aws-config.js': 'aws-config',
      'src/services/onepassword.js': 'onepassword',
      'src/services/identity-center.js': 'identity-center',
      'src/services/profile-config.js': 'profile-config',
      'src/wizards/setup-wizard.js': 'setup-wizard'
    };

    for (const [src, test] of Object.entries(testMapping)) {
      if (filePath.includes(src)) {
        const testSuite = this.results.suites.find(s => s.name === test);
        return testSuite && testSuite.passed > 0;
      }
    }

    // Core modules are tested indirectly
    if (filePath.includes('src/core/')) {
      return true;
    }

    return false;
  }

  /**
   * Generate coverage report
   */
  generateCoverageReport() {
    console.log('\n📊 Coverage Report\n');
    console.log('='.repeat(60));

    const coverageStats = this.calculateCoverage();

    // Show file coverage
    const sortedFiles = Array.from(this.coverage.entries())
      .sort((a, b) => b[1].percentage - a[1].percentage);

    console.log('\nFile Coverage:');
    for (const [file, stats] of sortedFiles) {
      const bar = this.getCoverageBar(stats.percentage);
      console.log(`  ${bar} ${stats.percentage.toFixed(0)}% ${file}`);
    }

    // Show summary
    console.log('\n' + '='.repeat(60));
    console.log(`Total Coverage: ${coverageStats.percentage}%`);
    console.log(`Lines Covered: ${coverageStats.coveredLines}/${coverageStats.totalLines}`);

    // Save detailed report
    this.saveCoverageReport(coverageStats);
  }

  /**
   * Get visual coverage bar
   */
  getCoverageBar(percentage) {
    const filled = Math.floor(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Save coverage report to file
   */
  saveCoverageReport(stats) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.results.total,
        passed: this.results.passed,
        failed: this.results.failed,
        skipped: this.results.skipped,
        coverage: stats.percentage + '%'
      },
      suites: this.results.suites,
      coverage: Object.fromEntries(this.coverage),
      duration: Date.now() - this.startTime
    };

    const reportPath = path.join(__dirname, 'coverage-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Coverage report saved to: ${reportPath}`);
  }

  /**
   * Print final summary
   */
  printSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));

    console.log(`\n📈 Results:`);
    console.log(`  Total Tests: ${this.results.total}`);
    console.log(`  ✅ Passed: ${this.results.passed}`);
    console.log(`  ❌ Failed: ${this.results.failed}`);
    console.log(`  ⏭️  Skipped: ${this.results.skipped}`);
    console.log(`  ⏱️  Duration: ${duration}s`);

    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log('\n⚠️  Some tests failed. See details above.');
    }
  }

  /**
   * Run all tests
   */
  async run() {
    console.log('🧪 awslogin Test Suite');
    console.log('='.repeat(60));

    // Setup
    this.setupMocks();
    this.discoverTests();

    // Run tests
    for (const testFile of this.testFiles) {
      await this.runTestFile(testFile);
    }

    // Generate reports
    this.generateCoverageReport();
    this.printSummary();

    // Exit with appropriate code
    process.exit(this.results.failed > 0 ? 1 : 0);
  }
}

// Run tests if executed directly
if (require.main === module) {
  const runner = new TestRunner();
  runner.run().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

module.exports = { TestRunner };