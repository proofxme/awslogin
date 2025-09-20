'use strict';

/**
 * AWS Login - Interactive CLI for AWS Authentication
 *
 * Modern, wizard-driven approach to AWS profile management
 */

// Wizard imports
const MainWizard = require('./wizards/main-wizard');
const SetupWizard = require('./wizards/setup-wizard');
const ManageWizard = require('./wizards/manage-wizard');
const AuthWizard = require('./wizards/auth-wizard');
const SmartAuth = require('./services/smart-auth');
const { displayHelp } = require('./help');

/**
 * Main entry point for AWS Login
 * @param {Array} argv - Command line arguments
 */
async function runAwsLogin(argv = []) {
  const args = argv.length ? argv : process.argv.slice(2);

  // No arguments - launch interactive wizard
  if (args.length === 0) {
    const wizard = new MainWizard();
    return wizard.run();
  }

  const command = args[0].toLowerCase();
  const options = args.slice(1);

  // Handle commands
  switch (command) {
    // Setup commands
    case 'setup':
    case 'configure':
    case 'config': {
      const wizard = new SetupWizard();
      return wizard.run();
    }

    // Management commands
    case 'manage':
    case 'list':
    case 'profiles': {
      const wizard = new ManageWizard();
      return wizard.run();
    }

    // Authentication commands
    case 'auth':
    case 'authenticate':
    case 'login': {
      const wizard = new AuthWizard();
      return wizard.run();
    }

    // Help
    case 'help':
    case '--help':
    case '-h':
    case '?': {
      displayHelp();
      return { success: true, exitCode: 0 };
    }

    // Version
    case 'version':
    case '--version':
    case '-v': {
      const pkg = require('../package.json');
      console.log(`awslogin v${pkg.version}`);
      return { success: true, exitCode: 0 };
    }

    // If not a command, assume it's a profile name
    default: {
      // Quick authentication with profile name
      const profileName = command;
      const smartAuth = new SmartAuth();

      // Check for simple flags
      const selectAccount = options.includes('--select') || options.includes('-s');
      const force = options.includes('--force') || options.includes('-f');

      return smartAuth.authenticate(profileName, {
        select: selectAccount,
        force: force
      });
    }
  }
}

module.exports = {
  runAwsLogin
};