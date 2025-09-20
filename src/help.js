'use strict';

const { version } = require('../package.json');

function displayHelp() {
  const helpText = `
🔐 AWS Login v${version} - Interactive AWS Authentication
═══════════════════════════════════════════════════════

USAGE:
  awslogin                    Interactive wizard (simplified menus)
  awslogin <profile>          Quick login to AWS profile
  awslogin <command>          Run specific command

COMMANDS:
  --list                     List all profiles
  --configure                Edit profile configuration
  --select                   Choose AWS account interactively
  --force                    Force re-authentication
  --token <code>             Provide MFA token directly
  --help                     Show this help message

QUICK EXAMPLES:
  awslogin                   # Interactive menu
  awslogin dev               # Login to 'dev' profile
  awslogin prod --select     # Choose prod account
  awslogin stage --token 123456  # MFA with token

INTERACTIVE MODE:
  Simply run 'awslogin' for the streamlined menu:
  🚀 Quick Login - Authenticate to AWS
  ⚙️ Configure - Add/edit/remove profiles
  ❓ Help - Quick start guide

FEATURES:
  ⚡ 100x faster with intelligent caching
  🆕 Automated IAM user creation with MFA
  🏢 AWS SSO / Identity Center support
  📱 Multi-Factor Authentication (MFA)
  🔐 Complete 1Password integration
  👥 Sub-profile creation for multi-account
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