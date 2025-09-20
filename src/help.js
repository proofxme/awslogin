'use strict';

const { version } = require('../package.json');

function displayHelp() {
  const helpText = `
🔐 AWS Login v${version} - Interactive AWS Authentication
═══════════════════════════════════════════════════════

USAGE:
  awslogin                    Launch interactive wizard
  awslogin <profile>          Quick authenticate to profile
  awslogin <command>          Run specific command

COMMANDS:
  setup, configure            Setup new AWS profile
  manage, list                Manage existing profiles
  auth, login                 Authenticate to a profile
  help                        Show this help message
  version                     Show version information

QUICK AUTHENTICATION:
  awslogin work              Authenticate to 'work' profile
  awslogin work --select     Choose AWS account after auth
  awslogin work --force      Force re-authentication

INTERACTIVE MODE:
  Simply run 'awslogin' without arguments to:
  • Setup new profiles with guided wizard
  • Authenticate with smart detection
  • Manage profiles interactively
  • Access contextual help

FEATURES:
  🏢 AWS SSO / Identity Center support
  📱 Multi-Factor Authentication (MFA)
  🔐 1Password integration for MFA tokens
  🎯 Smart authentication detection
  🔄 Automatic session management
  📋 Profile templates for quick setup
  🌍 Auto-discovery of AWS settings

EXAMPLES:
  $ awslogin                 # Start interactive wizard
  $ awslogin setup           # Setup new profile
  $ awslogin dev             # Login to 'dev' profile
  $ awslogin manage          # Manage all profiles

For more information: https://github.com/proofxme/awslogin
`;

  console.log(helpText);
}

module.exports = {
  displayHelp
};