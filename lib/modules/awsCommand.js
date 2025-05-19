// AWS Command Execution Module
// Provides functions for executing AWS CLI commands

const { spawnSync } = require('child_process');

// Function to execute AWS CLI commands
function execAwsCommand(args, options = {}) {
  const result = spawnSync('aws', args, {
    stdio: options.stdio || 'pipe',
    encoding: 'utf8',
    env: { ...process.env },
    ...options
  });
  
  return {
    stdout: result.stdout ? result.stdout.trim() : '',
    stderr: result.stderr ? result.stderr.trim() : '',
    status: result.status,
    success: result.status === 0
  };
}

module.exports = {
  execAwsCommand
};