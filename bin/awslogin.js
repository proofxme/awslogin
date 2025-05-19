#!/usr/bin/env node

// AWS Profile Authentication Script
// Provides intelligent authentication for AWS profiles
// Supports: SSO, MFA, and direct authentication with 1Password integration

const { execAwsCommand } = require('../lib/modules/awsCommand');
const { checkCredentialsExpired, isSessionValid } = require('../lib/modules/utils');
const { handleSsoAuth, handleMfaAuth } = require('../lib/modules/authManager');

// Main function
async function main() {
  // Process command line arguments
  const args = process.argv.slice(2);
  const profile = args[0];
  
  // Parse optional flags
  let mfaToken = null;
  let selectAccount = false;
  for (let i = 1; i < args.length; i++) {
    if ((args[i] === '--token' || args[i] === '--mfa-token') && args[i + 1]) {
      mfaToken = args[i + 1];
      i++; // Skip the token value in next iteration
    } else if (args[i] === '--select') {
      selectAccount = true;
    }
  }
  
  if (!profile) {
    console.log("ℹ️  Usage: awslogin <profile_name> [--token <mfa_token>] [--select]");
    console.log("Example: awslogin metalab");
    console.log("         awslogin metalab --token 123456");
    console.log("         awslogin dcycle --select");
    process.exit(1);
  }
  
  // Store profiles list first to avoid broken pipe
  const allProfilesResult = execAwsCommand(['configure', 'list-profiles']);
  if (!allProfilesResult.success) {
    console.log("❌ Failed to list AWS profiles");
    process.exit(1);
  }
  
  const allProfiles = allProfilesResult.stdout.split('\n');
  
  // Check if profile exists
  if (!allProfiles.includes(profile)) {
    console.log(`❌ Profile ${profile} not found`);
    process.exit(1);
  }
  
  
  // Check if it's an SSO profile (either direct sso_start_url or sso_session)
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';
  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  
  if (ssoStartUrl || ssoSession) {
    // Check if the current session is still valid before attempting to reauthenticate
    if (isSessionValid(profile)) {
      console.log(`✅ Session for profile ${profile} is still valid`);
      // Display identity info
      execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
      process.exit(0);
    } else {
      const result = await handleSsoAuth(profile, selectAccount, allProfiles);
      process.exit(result ? 0 : 1);
    }
  } else {
    // Try direct authentication first
    console.log(`🔑 Attempting direct authentication for profile: ${profile}`);
    
    // Check if the session is still valid
    if (isSessionValid(profile)) {
      // Check for token expiration
      if (!checkCredentialsExpired(profile)) {
        // Display identity info
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        process.exit(0);
      }
      // If expired, continue with re-authentication
    }
    
    // If direct authentication failed or credentials expired, check for long-term profile
    const longTermProfile = `${profile}-long-term`;
    
    if (allProfiles.includes(longTermProfile)) {
      const result = await handleMfaAuth(profile, longTermProfile, mfaToken);
      if (result) {
        process.exit(0);
      }
    } else {
      console.log("❌ Direct authentication failed and no long-term profile found");
    }
    
    console.log(`❌ Failed to authenticate using profile: ${profile}`);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(`❌ Unexpected error: ${error.message}`);
  process.exit(1);
});