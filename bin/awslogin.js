#!/usr/bin/env node

// AWS Profile Authentication Script
// Provides intelligent authentication for AWS profiles
// Supports: SSO, MFA, and direct authentication

const { spawnSync } = require('child_process');
const readline = require('readline');

// Create readline interface for MFA input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to execute AWS CLI commands
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

// Main function
async function main() {
  // Check for profile argument
  const profile = process.argv[2];
  
  if (!profile) {
    console.log("ℹ️  Usage: awslogin <profile_name>");
    console.log("Example: awslogin metalab");
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
    console.log(`🔐 Authenticating with AWS SSO for profile: ${profile}`);
    
    // For browser-based SSO with sso_session
    if (ssoSession) {
      console.log(`🌐 Using browser-based SSO authentication with session: ${ssoSession}`);
    }
    
    const ssoLoginResult = execAwsCommand(['sso', 'login', '--profile', profile], { stdio: 'inherit' });
    
    if (ssoLoginResult.success) {
      const validateResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
      
      if (validateResult.success) {
        console.log(`✅ Successfully authenticated with AWS SSO for profile: ${profile}`);
        // Display identity info
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        process.exit(0);
      } else {
        console.log("⚠️  Authentication succeeded but credentials validation failed");
        process.exit(1);
      }
    } else {
      console.log(`❌ Failed to authenticate with AWS SSO for profile: ${profile}`);
      process.exit(1);
    }
  } else {
    // Try direct authentication first
    console.log(`🔑 Attempting direct authentication for profile: ${profile}`);
    const directAuthResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
    
    if (directAuthResult.success) {
      // Check for token expiration by examining the expiration timestamp for session-based credentials
      const credsExpireResult = execAwsCommand([
        'configure', 'get', 'aws_session_expiration', '--profile', profile
      ]);
      
      // If we have an expiration time, check if it's still valid
      let tokenExpired = false;
      if (credsExpireResult.success && credsExpireResult.stdout) {
        const expirationTime = new Date(credsExpireResult.stdout);
        const currentTime = new Date();
        // Check if tokens are expired (or will expire in less than 15 minutes)
        tokenExpired = expirationTime <= new Date(currentTime.getTime() + 15 * 60 * 1000);
        
        if (tokenExpired) {
          console.log(`⚠️ Credentials for profile ${profile} have expired or will expire soon. Refreshing...`);
        } else {
          console.log(`✅ Successfully authenticated using profile: ${profile} (valid until ${expirationTime.toLocaleString()})`);
          // Display identity info
          execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
          process.exit(0);
        }
      } else {
        // No expiration time found but authentication succeeded, probably using long-term credentials
        console.log(`✅ Successfully authenticated using profile: ${profile}`);
        // Display identity info
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        process.exit(0);
      }
      
      // If tokens are expired, continue with re-authentication process
      if (!tokenExpired) {
        process.exit(0);
      }
    }
    
    // If direct authentication failed, check for long-term profile
    const longTermProfile = `${profile}-long-term`;
    
    if (allProfiles.includes(longTermProfile)) {
      // Check for MFA serial
      let mfaSerialResult = execAwsCommand(['configure', 'get', 'aws_mfa_device', '--profile', longTermProfile]);
      let mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
      
      if (!mfaSerial) {
        mfaSerialResult = execAwsCommand(['configure', 'get', 'mfa_serial', '--profile', longTermProfile]);
        mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
      }
      
      if (mfaSerial) {
        console.log(`🔐 Attempting MFA authentication for profile: ${profile}`);
        
        // Prompt for MFA token
        await new Promise((resolve) => {
          rl.question('Enter MFA token: ', async (tokenCode) => {
            // Get temporary credentials using the long-term profile
            const sessionTokenResult = execAwsCommand([
              'sts', 'get-session-token',
              '--profile', longTermProfile,
              '--serial-number', mfaSerial,
              '--token-code', tokenCode,
              '--duration-seconds', '28800',
              '--output', 'json'
            ]);
            
            if (sessionTokenResult.success) {
              try {
                const credsJson = JSON.parse(sessionTokenResult.stdout);
                
                // Extract credentials from JSON response
                const accessKey = credsJson.Credentials.AccessKeyId;
                const secretKey = credsJson.Credentials.SecretAccessKey;
                const sessionToken = credsJson.Credentials.SessionToken;
                const expiration = credsJson.Credentials.Expiration; // ISO format timestamp
                
                // Store temporary credentials in the profile
                execAwsCommand(['configure', 'set', 'aws_access_key_id', accessKey, '--profile', profile]);
                execAwsCommand(['configure', 'set', 'aws_secret_access_key', secretKey, '--profile', profile]);
                execAwsCommand(['configure', 'set', 'aws_session_token', sessionToken, '--profile', profile]);
                execAwsCommand(['configure', 'set', 'aws_session_expiration', expiration, '--profile', profile]);
                
                // Verify the credentials work
                const verifyResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
                
                if (verifyResult.success) {
                  console.log(`✅ Successfully authenticated with MFA for profile: ${profile}`);
                  // Display identity info
                  execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
                  rl.close();
                  process.exit(0);
                } else {
                  console.log("⚠️  MFA authentication failed: Credentials validation error");
                }
              } catch (error) {
                console.log(`⚠️  MFA authentication failed: ${error.message}`);
              }
            } else {
              console.log("⚠️  MFA authentication failed: Invalid token or connection error");
            }
            
            resolve();
          });
        });
      } else {
        console.log("⚠️  Long-term profile exists but no MFA device configured");
      }
    } else {
      console.log("❌ Direct authentication failed and no long-term profile found");
    }
    
    console.log(`❌ Failed to authenticate using profile: ${profile}`);
    rl.close();
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(`❌ Unexpected error: ${error.message}`);
  rl.close();
  process.exit(1);
});