'use strict';

const BaseWizard = require('./base-wizard');
const SetupWizard = require('./setup-wizard');
const ManageWizard = require('./manage-wizard');
const AuthWizard = require('./auth-wizard');
const { listProfiles } = require('../services/aws-config');

/**
 * Main interactive wizard - entry point when no arguments provided
 */
class MainWizard extends BaseWizard {
  async run() {
    this.clear();
    this.showBanner('🔐 AWS Login Interactive Wizard', 'Simplifying AWS authentication');

    // Check if any profiles exist
    const profiles = await listProfiles();
    const hasProfiles = profiles && profiles.length > 0;

    if (!hasProfiles) {
      this.showInfo('No AWS profiles detected. Let\'s set up your first profile!');
      const setupWizard = new SetupWizard();
      return setupWizard.run();
    }

    // Show main menu
    const action = await this.selectMainAction();

    switch (action) {
      case 'authenticate':
        return this.runAuthWizard();
      case 'configure':
        return this.runConfigureMenu();
      case 'help':
        return this.showInteractiveHelp();
      case 'exit':
        this.showInfo('Goodbye! 👋');
        return { success: true };
    }
  }

  async selectMainAction() {
    const choices = [
      {
        title: '🚀 Quick Login',
        value: 'authenticate',
        description: 'Login to AWS with an existing profile'
      },
      {
        title: '⚙️  Configure',
        value: 'configure',
        description: 'Setup or manage AWS profiles'
      },
      {
        title: '❓ Help',
        value: 'help',
        description: 'Get help and documentation'
      },
      {
        title: '🚪 Exit',
        value: 'exit'
      }
    ];

    return this.select('What would you like to do?', choices);
  }

  async runAuthWizard() {
    const authWizard = new AuthWizard();
    return authWizard.run();
  }

  async runConfigureMenu() {
    const action = await this.select('Configuration Options:', [
      {
        title: '➕ Add new profile',
        value: 'add',
        description: 'Setup a new AWS profile (SSO, MFA, or Direct)'
      },
      {
        title: '✏️  Edit profile',
        value: 'edit',
        description: 'Modify an existing profile'
      },
      {
        title: '🗑️  Remove profile',
        value: 'delete',
        description: 'Delete a profile'
      },
      {
        title: '📋 List profiles',
        value: 'list',
        description: 'View all configured profiles'
      },
      {
        title: '🔙 Back',
        value: 'back'
      }
    ]);

    switch (action) {
      case 'add':
        const setupWizard = new SetupWizard();
        return setupWizard.run();
      case 'edit':
      case 'delete':
      case 'list':
        const manageWizard = new ManageWizard();
        return manageWizard.runAction(action);
      case 'back':
        return this.run();
    }
  }

  async showInteractiveHelp() {
    this.clear();
    this.showBanner('❓ Interactive Help');

    const topic = await this.select('Help Topics:', [
      {
        title: '🚀 Quick Start',
        value: 'quickstart',
        description: 'Get started with awslogin'
      },
      {
        title: '🔐 Authentication Types',
        value: 'auth',
        description: 'SSO, MFA, and Direct authentication explained'
      },
      {
        title: '💡 Common Tasks',
        value: 'common',
        description: 'Frequently used commands and workflows'
      },
      {
        title: '🔙 Back',
        value: 'back'
      }
    ]);

    if (topic === 'back') {
      return this.run();
    }

    await this.showHelpTopic(topic);

    const again = await this.confirm('Would you like to see another help topic?');
    if (again) {
      return this.showInteractiveHelp();
    }

    return this.run();
  }

  async showHelpTopic(topic) {
    const helpContent = {
      'quickstart': `
🚀 Quick Start Guide
==================

Getting started with awslogin is easy! Follow these steps:

1. FIRST TIME SETUP
   Run: awslogin
   - The wizard will guide you through creating your first profile
   - Choose your authentication type (SSO, MFA, or Direct)

2. DAILY USE
   Run: awslogin <profile-name>
   - Automatically logs you in to AWS
   - Handles credential refresh seamlessly

3. COMMON COMMANDS
   • awslogin                     - Interactive wizard
   • awslogin <profile>           - Quick login
   • awslogin <profile> --select  - Choose from multiple accounts
   • awslogin --list              - Show all profiles

That's it! You're ready to use awslogin.
`,
      'auth': `
🔐 Authentication Types
======================

awslogin supports three authentication methods:

1. SSO (AWS Identity Center) - RECOMMENDED
   • Single sign-on for multiple AWS accounts
   • No credentials stored locally
   • Automatic token refresh
   • Setup: Requires SSO portal URL and region

2. MFA (Multi-Factor Authentication)
   • Adds security with 6-digit tokens
   • Works with virtual MFA apps
   • Optional 1Password integration
   • Setup: Requires access keys and MFA device

3. Direct Credentials
   • Simple access key authentication
   • Best for programmatic access
   • No session management needed
   • Setup: Requires access key ID and secret

Choose based on your organization's setup and security requirements.
`,
      'common': `
💡 Common Tasks & Tips
=====================

PROFILE MANAGEMENT
• Add profile:     awslogin (then choose Configure)
• List profiles:   awslogin --list
• Edit profile:    awslogin <profile> --configure
• Delete profile:  Use the Configure menu

AUTHENTICATION
• Quick login:     awslogin <profile>
• Force refresh:   awslogin <profile> --force
• With MFA token:  awslogin <profile> --token 123456

MULTIPLE ACCOUNTS
• Select account:  awslogin <profile> --select
• Sub-profiles:    Create once, use parent's SSO session

TROUBLESHOOTING
• Session expired? Just run awslogin <profile> again
• MFA not working? Check your device time sync
• SSO issues? Verify your portal URL is correct

PRO TIPS
• Use tab completion for profile names
• Set AWS_PROFILE environment variable for persistent selection
• Combine with aws CLI: awslogin prod && aws s3 ls
`,
    };

    console.log(helpContent[topic] || 'Help topic not found.');
    await this.confirm('Press Enter to continue...');
  }
}

module.exports = MainWizard;