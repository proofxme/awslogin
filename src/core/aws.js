'use strict';

const { spawnSync } = require('child_process');

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

function commandExists(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0;
}

module.exports = {
  execAwsCommand,
  commandExists
};
