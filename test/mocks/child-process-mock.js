'use strict';

/**
 * Child Process Mock for testing
 */

class ChildProcessMock {
  constructor() {
    this.commands = new Map();
    this.reset();
  }

  reset() {
    this.commands.clear();

    // Add default command responses
    this.commands.set('op --version', { stdout: '2.32.0', stderr: '', code: 0 });
    this.commands.set('op whoami', { stdout: 'test@example.com', stderr: '', code: 0 });
    this.commands.set('op item list --categories TOTP --format json', {
      stdout: JSON.stringify([
        {
          id: 'test-item-id',
          title: 'AWS test-mfa',
          category: 'LOGIN'
        }
      ]),
      stderr: '',
      code: 0
    });
    this.commands.set('op item get "AWS test-mfa" --otp', {
      stdout: '123456',
      stderr: '',
      code: 0
    });
  }

  execSync(command, options = {}) {
    // Check if command matches any registered pattern
    for (const [pattern, response] of this.commands) {
      if (command.includes(pattern) || command === pattern) {
        if (response.code !== 0) {
          const error = new Error(response.stderr);
          error.code = response.code;
          error.stdout = response.stdout;
          error.stderr = response.stderr;
          throw error;
        }
        return response.stdout;
      }
    }

    // Handle AWS CLI commands
    if (command.startsWith('aws ')) {
      const awsMock = require('./aws-mock');
      const args = command.substring(4).split(' ');
      const result = awsMock.executeCommand(args);

      if (!result.success) {
        const error = new Error(result.stderr);
        error.code = result.code;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        throw error;
      }

      return result.stdout;
    }

    // Default error for unknown commands
    const error = new Error(`Command not found: ${command}`);
    error.code = 127;
    throw error;
  }

  exec(command, options, callback) {
    try {
      const stdout = this.execSync(command, options);
      if (callback) {
        callback(null, stdout, '');
      }
    } catch (error) {
      if (callback) {
        callback(error, error.stdout || '', error.stderr || '');
      }
    }
  }

  spawn(command, args, options) {
    // Mock spawn for streaming commands
    const events = new Map();
    const mockProcess = {
      stdout: {
        on: (event, handler) => {
          if (event === 'data') {
            // Simulate data chunks
            setTimeout(() => handler('Mock output data\n'), 10);
          }
        }
      },
      stderr: {
        on: (event, handler) => {
          // No stderr in success case
        }
      },
      on: (event, handler) => {
        events.set(event, handler);
        if (event === 'close') {
          // Simulate process completion
          setTimeout(() => handler(0), 20);
        }
      },
      kill: () => {
        // Simulate process termination
      }
    };
    return mockProcess;
  }

  // Add command response
  addCommand(pattern, response) {
    this.commands.set(pattern, response);
  }
}

module.exports = { ChildProcessMock };

