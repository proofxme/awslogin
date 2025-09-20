'use strict';

const BaseWizard = require('./base-wizard');
const SetupWizard = require('./setup-wizard');
const ManageWizard = require('./manage-wizard');
const AuthWizard = require('./auth-wizard');
const { getProfiles } = require('../services/profile-service');

/**
 * Main interactive wizard - entry point when no arguments provided
 */
class MainWizard extends BaseWizard {
  async run() {
    this.clear();
    this.showBanner('🔐 AWS Login Interactive Wizard', 'Simplifying AWS authentication');

    // Check if any profiles exist
    const profiles = await getProfiles();
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
      case 'setup':
        return this.runSetupWizard();
      case 'manage':
        return this.runManageWizard();
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
        title: '🔐 Authenticate to AWS',
        value: 'authenticate',
        description: 'Login to an existing AWS profile'
      },
      {
        title: '⚙️  Setup new profile',
        value: 'setup',
        description: 'Configure a new AWS profile'
      },
      {
        title: '📋 Manage profiles',
        value: 'manage',
        description: 'Edit, delete, or view existing profiles'
      },
      {
        title: '❓ Interactive help',
        value: 'help',
        description: 'Learn how to use AWS Login'
      },
      {
        title: '🚪 Exit',
        value: 'exit',
        description: 'Exit the wizard'
      }
    ];

    return this.select('What would you like to do?', choices);
  }

  async runAuthWizard() {
    const authWizard = new AuthWizard();
    return authWizard.run();
  }

  async runSetupWizard() {
    const setupWizard = new SetupWizard();
    return setupWizard.run();
  }

  async runManageWizard() {
    const manageWizard = new ManageWizard();
    return manageWizard.run();
  }

  async showInteractiveHelp() {
    this.clear();
    this.showBanner('❓ Interactive Help');

    const topic = await this.select('What do you need help with?', [
      {
        title: '🏢 AWS SSO / Identity Center',
        value: 'sso',
        description: 'Learn about SSO authentication'
      },
      {
        title: '📱 Multi-Factor Authentication (MFA)',
        value: 'mfa',
        description: 'Understanding MFA setup and usage'
      },
      {
        title: '🔑 AWS Credentials',
        value: 'credentials',
        description: 'How AWS credentials work'
      },
      {
        title: '👥 Sub-profiles',
        value: 'subprofiles',
        description: 'Using sub-profiles for multiple accounts'
      },
      {
        title: '🔐 1Password Integration',
        value: '1password',
        description: 'Setting up 1Password for MFA'
      },
      {
        title: '🔙 Back to main menu',
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
      'sso': `
AWS SSO / Identity Center Authentication
========================================

AWS SSO (now called IAM Identity Center) provides centralized access to multiple
AWS accounts through a single sign-on portal.

Key Benefits:
• Single login for multiple AWS accounts
• No long-term credentials stored locally
• Automatic credential rotation
• Role-based access control

Setup Requirements:
1. Your organization's SSO start URL (e.g., https://company.awsapps.com/start)
2. The AWS region where SSO is configured
3. The role name you want to assume (e.g., AdministratorAccess)

The wizard will guide you through setting this up automatically!
`,
      'mfa': `
Multi-Factor Authentication (MFA)
==================================

MFA adds an extra layer of security by requiring a second form of authentication
beyond your password.

How it works:
1. You have long-term AWS credentials (access key and secret key)
2. An MFA device is configured (virtual or hardware)
3. When authenticating, you provide a 6-digit token from your MFA device
4. AWS issues temporary session credentials

Supported MFA Methods:
• Virtual MFA apps (Google Authenticator, Authy, etc.)
• Hardware MFA devices
• 1Password integration (automatic token retrieval)

The setup wizard will help you configure MFA step by step.
`,
      'credentials': `
AWS Credentials Overview
========================

AWS uses several types of credentials:

1. Long-term Credentials:
   • AWS Access Key ID and Secret Access Key
   • Never expire (must be rotated manually)
   • Should be protected and rarely used directly

2. Temporary Session Credentials:
   • Include a session token
   • Expire after a set duration (1-12 hours typically)
   • More secure for daily use

3. SSO Credentials:
   • Automatically managed by AWS SSO
   • Refreshed as needed
   • No manual rotation required

Best Practices:
• Use temporary credentials whenever possible
• Enable MFA for sensitive operations
• Rotate long-term credentials regularly
• Never commit credentials to version control
`,
      'subprofiles': `
Sub-profiles for Multiple Accounts
===================================

Sub-profiles allow you to access multiple AWS accounts without repeated logins.

How they work:
1. You authenticate to a main profile (e.g., 'company')
2. AWS Login creates sub-profiles for each account (e.g., 'company-dev', 'company-prod')
3. Sub-profiles reuse the main profile's SSO session
4. Switch between accounts instantly without re-authenticating

Benefits:
• Single sign-on to multiple accounts
• Automatic session sharing
• Clear naming convention
• Easy account switching

Example:
  Main profile: 'company'
  Sub-profiles: 'company-dev', 'company-staging', 'company-prod'

Use 'awslogin company --select' to choose an account interactively.
`,
      '1password': `
1Password Integration
=====================

AWS Login can automatically retrieve MFA tokens from 1Password.

Setup Steps:
1. Install 1Password CLI ('op' command)
2. Sign in to 1Password CLI
3. Store your AWS MFA secret in 1Password
4. Run 'awslogin <profile> --configure' to link them

Benefits:
• No manual token entry
• Secure storage of MFA secrets
• Seamless authentication flow
• Works with multiple profiles

Requirements:
• 1Password subscription
• 1Password CLI installed
• MFA secret stored as TOTP in 1Password

The configuration wizard will detect 1Password and help you set this up.
`
    };

    console.log(helpContent[topic] || 'Help topic not found.');
    await this.confirm('Press Enter to continue...');
  }
}

module.exports = MainWizard;