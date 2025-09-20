'use strict';

function displayHelp() {
  const helpText = `
🔐 AWS Profile Auth CLI - Help
===========================

A smart CLI tool that streamlines authentication with AWS profiles, supporting multiple authentication methods including AWS IAM Identity Center (SSO), MFA, and direct authentication.

USAGE:
  awslogin <profile_name> [options]

OPTIONS:
  --help, -h                   Show this help information
  --select                     Prompt for account selection after SSO authentication
  --token <mfa_token>          Provide MFA token directly without prompting
  --setup-iam-identity-center  Configure cross-account access through IAM Identity Center
  --clean                      Remove temporary credentials from AWS profile (with confirmation)
  --configure                  Run the profile configuration wizard (1Password integration, MFA settings, etc.)
  --configure --all-org        Create profiles for all AWS organization accounts (main_profile-account_name format)
  --change                     Force selection of a different account, ignoring existing sub-profiles

COMMANDS:
  awslogin <profile>                          Authenticate with the specified AWS profile
  awslogin <profile> --select                 Authenticate and select from available accounts
  awslogin <profile> --token <mfa_token>      Authenticate with provided MFA token
  awslogin <profile> --setup-iam-identity-center  Set up cross-account access
  awslogin <profile> --clean                  Remove temporary credentials from the profile
  awslogin <profile> --configure              Run profile configuration wizard
  awslogin <profile> --configure --all-org    Create profiles for all accounts in the organization
  awslogin <profile> --change                 Select a different account and create a sub-profile

SUB-PROFILES:
  When using SSO with --select, sub-profiles are created with format: profile-account-name
  These sub-profiles automatically reuse the parent profile's SSO session to avoid multiple logins.

AUTHENTICATION METHODS:
  🔹 AWS IAM Identity Center (SSO)
  🔹 MFA (Multi-Factor Authentication)
  🔹 Direct Authentication

CROSS-ACCOUNT ACCESS:
  Use the --setup-iam-identity-center flag to configure secure cross-account access.

EXAMPLES:
  $ awslogin company-dev
  $ awslogin company-dev --select
  $ awslogin admin --token 123456
  $ awslogin company --setup-iam-identity-center
  $ awslogin company --configure --all-org

For more information, visit: https://github.com/awslogin/awslogin-cli
`;

  console.log(helpText);
}

module.exports = {
  displayHelp
};
