'use strict';

const { runAwsLogin } = require('..');

async function run(argv = process.argv.slice(2)) {
  try {
    const result = await runAwsLogin(argv);
    const exitCode = result && typeof result.exitCode === 'number'
      ? result.exitCode
      : result && result.success
        ? 0
        : 1;
    process.exit(exitCode);
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

module.exports = {
  run
};
