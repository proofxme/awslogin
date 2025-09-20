'use strict';

/**
 * Simple test framework with mocking capabilities
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class TestFramework {
  constructor() {
    this.tests = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
    this.mocks = new Map();
    this.coverage = new Map();
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  async describe(description, callback) {
    console.log(`\n📦 ${description}`);
    await callback();
    await this.runTests();
  }

  beforeEach(callback) {
    this.beforeEachHooks.push(callback);
  }

  afterEach(callback) {
    this.afterEachHooks.push(callback);
  }

  it(description, callback) {
    this.tests.push({
      description,
      callback,
      passed: false,
      failed: false,
      error: null
    });
  }

  mock(modulePath, mockImplementation) {
    this.mocks.set(modulePath, mockImplementation);
  }

  clearMocks() {
    this.mocks.clear();
  }

  async runTests() {
    for (const test of this.tests) {
      try {
        // Run beforeEach hooks
        for (const hook of this.beforeEachHooks) {
          await hook();
        }

        // Run test
        await test.callback();

        console.log(`  ✅ ${test.description}`);
        this.results.passed++;
        test.passed = true;

        // Run afterEach hooks
        for (const hook of this.afterEachHooks) {
          await hook();
        }
      } catch (error) {
        console.log(`  ❌ ${test.description}`);
        console.log(`     ${error.message}`);
        this.results.failed++;
        test.failed = true;
        test.error = error;
        this.results.errors.push({
          test: test.description,
          error: error.message
        });
      }
    }
  }

  expect(actual) {
    return {
      toBe(expected) {
        if (actual !== expected) {
          throw new Error(`Expected ${expected}, but got ${actual}`);
        }
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
        }
      },
      toContain(expected) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected "${actual}" to contain "${expected}"`);
        }
      },
      toThrow(expectedError) {
        try {
          if (typeof actual === 'function') {
            actual();
          }
          throw new Error(`Expected function to throw ${expectedError || 'an error'}`);
        } catch (error) {
          if (expectedError && !error.message.includes(expectedError)) {
            throw new Error(`Expected error containing "${expectedError}", but got "${error.message}"`);
          }
        }
      },
      toBeTruthy() {
        if (!actual) {
          throw new Error(`Expected ${actual} to be truthy`);
        }
      },
      toBeFalsy() {
        if (actual) {
          throw new Error(`Expected ${actual} to be falsy`);
        }
      },
      toHaveBeenCalled() {
        if (!actual._called) {
          throw new Error(`Expected function to have been called`);
        }
      },
      toHaveBeenCalledWith(...args) {
        if (!actual._calls || !actual._calls.some(call =>
          JSON.stringify(call) === JSON.stringify(args)
        )) {
          throw new Error(`Expected function to have been called with ${JSON.stringify(args)}`);
        }
      }
    };
  }

  fn(implementation) {
    const mockFn = (...args) => {
      mockFn._called = true;
      mockFn._calls = mockFn._calls || [];
      mockFn._calls.push(args);
      if (implementation) {
        return implementation(...args);
      }
    };
    mockFn._called = false;
    mockFn._calls = [];
    return mockFn;
  }

  generateCoverageReport() {
    const totalLines = this.coverage.size;
    const coveredLines = Array.from(this.coverage.values()).filter(v => v).length;
    const percentage = totalLines > 0 ? (coveredLines / totalLines * 100).toFixed(2) : 0;

    return {
      total: totalLines,
      covered: coveredLines,
      percentage: `${percentage}%`
    };
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('Test Summary:');
    console.log(`  ✅ Passed: ${this.results.passed}`);
    console.log(`  ❌ Failed: ${this.results.failed}`);
    console.log(`  ⏭️  Skipped: ${this.results.skipped}`);

    if (this.results.errors.length > 0) {
      console.log('\nFailed Tests:');
      this.results.errors.forEach(err => {
        console.log(`  - ${err.test}: ${err.error}`);
      });
    }

    const coverage = this.generateCoverageReport();
    console.log('\nCode Coverage:');
    console.log(`  Lines: ${coverage.covered}/${coverage.total} (${coverage.percentage})`);
    console.log('='.repeat(50));

    return this.results.failed === 0;
  }

  // Additional methods for test runner compatibility
  getSuiteTests() {
    return this.tests.map(test => ({
      description: test.description,
      status: test.passed ? 'passed' : (test.failed ? 'failed' : 'pending'),
      error: test.error
    }));
  }

  clearTests() {
    this.tests = [];
    this.suites = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }
}

module.exports = { TestFramework };