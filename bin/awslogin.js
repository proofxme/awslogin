#!/usr/bin/env node

// AWS Profile Authentication Script
// Provides intelligent authentication for AWS profiles
// Supports: SSO, MFA, and direct authentication with 1Password integration

const { execAwsCommand } = require('../lib/modules/awsCommand');
const { checkCredentialsExpired, isSessionValid, cleanupAwsProfile } = require('../lib/modules/utils');
const { handleSsoAuth, handleMfaAuth, promptYesNo } = require('../lib/modules/authManager');
const { setupIdentityCenter } = require('../lib/modules/identityCenter');
const { configureProfile, configureAllOrgProfiles } = require('../lib/modules/profileConfig');
const { displayHelp } = require('../lib/modules/help');

// Main function
async function main() {
  // Process command line arguments
  const args = process.argv.slice(2);
  const profile = args[0];
  
  // Parse optional flags
  let mfaToken = null;
  let selectAccount = false;
  let configureIdentityCenter = false;
  let showHelp = false;
  let cleanProfile = false;
  let configureProfileFlag = false;
  let changeAccount = false;
  
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--token' || args[i] === '--mfa-token') && args[i + 1]) {
      mfaToken = args[i + 1];
      i++; // Skip the token value in next iteration
    } else if (args[i] === '--select') {
      selectAccount = true;
    } else if (args[i] === '--setup-iam-identity-center') {
      configureIdentityCenter = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      showHelp = true;
    } else if (args[i] === '--clean') {
      cleanProfile = true;
    } else if (args[i] === '--configure') {
      configureProfileFlag = true;
    } else if (args[i] === '--change') {
      changeAccount = true;
    }
  }
  
  // Display help if --help flag is provided or if no profile is specified
  if (showHelp || !profile) {
    displayHelp();
    process.exit(showHelp ? 0 : 1);
  }
  
  // If --setup-iam-identity-center is specified, run the setup helper
  if (configureIdentityCenter) {
    const setupResult = await setupIdentityCenter(profile);
    process.exit(setupResult ? 0 : 1);
  }
  
  // If --clean is specified, clean up the profile credentials
  if (cleanProfile) {
    console.log(`⚠️  About to clean up credentials for profile: ${profile}`);
    console.log('💡 This will remove temporary credentials and session tokens.');
    
    const confirmCleanup = await promptYesNo('Are you sure you want to continue? (y/n)');
    
    if (confirmCleanup) {
      const cleanupResult = await cleanupAwsProfile(profile);
      process.exit(cleanupResult ? 0 : 1);
    } else {
      console.log('🛑 Cleanup cancelled');
      process.exit(0);
    }
  }
  
  // If --configure is specified, run the profile configuration wizard
  if (configureProfileFlag) {
    // Check if there's an additional flag for organization-wide configuration
    const shouldConfigureAllOrg = args.includes('--all-org') || args.includes('--org-accounts');

    if (shouldConfigureAllOrg) {
      console.log(`🏢 Configuring profiles for all AWS organization accounts using base profile: ${profile}`);
      const configResult = await configureAllOrgProfiles(profile);
      process.exit(configResult ? 0 : 1);
    } else {
      // Regular single profile configuration
      const configResult = await configureProfile(profile);
      process.exit(configResult ? 0 : 1);
    }
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
  
  // Check if this is a sub-profile by looking for parent_profile
  const parentProfileResult = execAwsCommand(['configure', 'get', 'parent_profile', '--profile', profile]);
  const parentProfile = parentProfileResult.success ? parentProfileResult.stdout : '';
  
  if (parentProfile) {
    console.log(`🔍 Detected sub-profile. Parent profile: ${parentProfile}`);
    
    // Check if the parent profile has a valid SSO session
    if (isSessionValid(parentProfile)) {
      console.log(`✅ Parent profile ${parentProfile} has valid SSO session`);
      
      // Check if the sub-profile credentials are still valid
      if (!checkCredentialsExpired(profile)) {
        console.log(`✅ Sub-profile ${profile} credentials are still valid`);
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        process.exit(0);
      }
      
      // Sub-profile credentials expired, need to refresh using parent SSO session
      console.log(`🔄 Refreshing sub-profile credentials using parent SSO session`);
      
      // Get the account_id and role_name from the sub-profile
      const accountIdResult = execAwsCommand(['configure', 'get', 'account_id', '--profile', profile]);
      const roleNameResult = execAwsCommand(['configure', 'get', 'role_name', '--profile', profile]);
      
      const accountId = accountIdResult.success ? accountIdResult.stdout : '';
      const roleName = roleNameResult.success ? roleNameResult.stdout : '';
      
      if (accountId && roleName) {
        // Use the parent profile's SSO session to get new credentials
        const { getSsoRoleCredentials } = require('../lib/modules/sso');
        
        console.log(`🔄 Getting credentials for account ${accountId} with role ${roleName}`);
        const roleCredentials = await getSsoRoleCredentials(parentProfile, accountId, roleName);
        
        if (roleCredentials) {
          // Update the sub-profile with new credentials
          execAwsCommand(['configure', 'set', 'aws_access_key_id', roleCredentials.accessKeyId, '--profile', profile]);
          execAwsCommand(['configure', 'set', 'aws_secret_access_key', roleCredentials.secretAccessKey, '--profile', profile]);
          execAwsCommand(['configure', 'set', 'aws_session_token', roleCredentials.sessionToken, '--profile', profile]);
          
          // Store the expiration time
          const expirationTime = new Date(roleCredentials.expiration);
          execAwsCommand(['configure', 'set', 'aws_session_expiration', expirationTime.toISOString(), '--profile', profile]);
          
          console.log(`✅ Successfully refreshed credentials for sub-profile: ${profile}`);
          execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
          process.exit(0);
        } else {
          console.log(`❌ Failed to refresh credentials for sub-profile: ${profile}`);
          console.log(`💡 This may happen if the SSO session needs re-authentication`);
          console.log(`💡 Try running: awslogin ${parentProfile}`);
          process.exit(1);
        }
      } else {
        console.log(`❌ Sub-profile ${profile} is missing account_id or role_name metadata`);
        console.log(`💡 Try running: awslogin ${parentProfile} --select`);
        process.exit(1);
      }
    } else {
      console.log(`⚠️ Parent profile ${parentProfile} SSO session is invalid`);
      console.log(`💡 Please authenticate the parent profile first: awslogin ${parentProfile}`);
      process.exit(1);
    }
  }
  
  // Check if it's an SSO profile (either direct sso_start_url or sso_session)
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';
  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  
  if (ssoStartUrl || ssoSession) {
    // Add --force flag to force re-authentication even if session is valid
    const forceReAuth = args.includes('--force');
    
    // If --change flag is used, we need to handle account selection differently
    if (changeAccount) {
      console.log(`🔄 Changing account for profile: ${profile}`);
      
      // First validate that we have a valid SSO session
      if (!isSessionValid(profile)) {
        console.log('⚠️ No valid SSO session found. Authenticating first...');
        await handleSsoAuth(profile, false, allProfiles);
      }
      
      // Now force account selection regardless of existing sub-profiles
      const result = await handleSsoAuth(profile, true, allProfiles, true);
      process.exit(result ? 0 : 1);
    }
    // Check if the current session is still valid before attempting to reauthenticate
    else if (!forceReAuth && isSessionValid(profile)) {
      console.log(`✅ Session for profile ${profile} is still valid`);
      // Display identity info
      execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
      process.exit(0);
    } else {
      // If session is not valid or --force is used, re-authenticate
      if (forceReAuth) {
        console.log('🔄 Forcing re-authentication as requested');
      }
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