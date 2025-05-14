#!/usr/bin/env node

// AWS Profile Authentication Script
// Provides intelligent authentication for AWS profiles
// Supports: SSO, MFA, and direct authentication with 1Password integration

const { spawnSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// Function to execute 1Password CLI commands
function exec1PasswordCommand(args, options = {}) {
  const result = spawnSync('op', args, {
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

// Function to get MFA token from 1Password
async function getMfaTokenFrom1Password(profileName) {
  try {
    console.log(`🔍 Searching for MFA token in 1Password for profile: ${profileName}`);
    
    // First, try to find an account name based on the profile name
    let searchTerm = profileName;
    
    // If it's a long-term profile, remove the -long-term suffix
    if (searchTerm.endsWith('-long-term')) {
      searchTerm = searchTerm.replace('-long-term', '');
    }
    
    console.log(`🔍 Using search term: ${searchTerm}`)
    
    // Search for AWS items in 1Password that match the profile name
    const searchResult = exec1PasswordCommand(['item', 'list', '--format', 'json']);
    
    if (!searchResult.success) {
      console.log('⚠️  Failed to search 1Password for AWS credentials');
      return null;
    }
    
    let items = [];
    try {
      items = JSON.parse(searchResult.stdout);
    } catch (e) {
      console.log('⚠️  Failed to parse 1Password search results');
      return null;
    }
    
    // Filter items that might match our AWS profile
    const awsItems = items.filter(item => {
      const lowerTitle = item.title.toLowerCase();
      const lowerSearchTerm = searchTerm.toLowerCase();
      return (
        (lowerTitle.includes('aws') || lowerTitle.includes('amazon')) && 
        (lowerTitle.includes(lowerSearchTerm) || lowerSearchTerm.includes(lowerTitle.replace(/aws|amazon|-/gi, '').trim()))
      );
    });
    
    console.log(`🔍 Found ${awsItems.length} potential matching items in 1Password`);
    if (awsItems.length > 0) {
      awsItems.forEach(item => console.log(`   - ${item.title} (${item.id})`));
    }
    
    if (awsItems.length === 0) {
      console.log(`⚠️  No matching AWS items found in 1Password for profile: ${profileName}`);
      return null;
    }
    
    // If multiple matches found, prompt the user to select one
    let item;
    if (awsItems.length > 1) {
      console.log('⚠️  Multiple 1Password entries found. Please select which to use:');
      for (let i = 0; i < awsItems.length; i++) {
        console.log(`   ${i+1}. ${awsItems[i].title} (${awsItems[i].id})`);
      }
      
      // Create a temporary readline interface for this prompt
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      try {
        const selection = await new Promise(resolve => {
          tempRl.question('Enter number of entry to use: ', answer => {
            tempRl.close();
            resolve(answer);
          });
        });
        
        const index = parseInt(selection) - 1;
        if (isNaN(index) || index < 0 || index >= awsItems.length) {
          console.log('⚠️  Invalid selection, falling back to manual MFA entry');
          return null;
        }
        
        item = awsItems[index];
        console.log(`🔐 Using selected item: ${item.title}`);
      } catch (error) {
        console.log(`⚠️  Error selecting 1Password entry: ${error.message}`);
        return null;
      }
    } else {
      // Use the only matching item
      item = awsItems[0];
    }
    
    // Get the item details to find the TOTP field
    console.log(`🔍 Getting details for 1Password item: ${item.title} (${item.id})`);
    const itemDetail = exec1PasswordCommand(['item', 'get', item.id, '--format', 'json']);
    
    if (!itemDetail.success) {
      console.log('⚠️  Failed to get item details from 1Password');
      return null;
    }
    
    const itemData = JSON.parse(itemDetail.stdout);
    
    // Debug field types
    console.log(`🔍 Found the following field types:`);
    if (itemData.fields) {
      const fieldTypes = itemData.fields.map(f => f.type).filter((v, i, a) => a.indexOf(v) === i);
      console.log(`   - Fields: ${fieldTypes.join(', ')}`);
    }
    if (itemData.sections) {
      console.log(`   - Has ${itemData.sections.length} sections`);
    }
    
    // Find the TOTP field - in different versions of 1Password, the TOTP field might have different properties
    let totpField = null;
    
    // First check standard OTP type
    totpField = itemData.fields.find(field => field.type === 'OTP');
    
    // If not found, look for field with TOTP property
    if (!totpField) {
      totpField = itemData.fields.find(field => field.totp);
    }
    
    // If not found, look for sections that might contain OTP fields
    if (!totpField && itemData.sections) {
      for (const section of itemData.sections) {
        if (section.fields) {
          const sectionTotpField = section.fields.find(field => field.type === 'OTP' || field.totp);
          if (sectionTotpField) {
            totpField = sectionTotpField;
            break;
          }
        }
      }
    }
    
    if (!totpField) {
      console.log(`⚠️  No TOTP field found in 1Password for item: ${item.title}`);
      return null;
    }
    
    // Extract the TOTP value - it could be in different properties depending on 1Password version
    const totpValue = totpField.totp || totpField.value?.totp || totpField.value;
    
    if (!totpValue) {
      console.log(`⚠️  Could not extract TOTP value from 1Password for item: ${item.title}`);
      return null;
    }
    
    // Return the current TOTP value
    console.log(`🔐 Retrieved MFA token from 1Password for item: ${item.title}`);
    return totpValue;
  } catch (error) {
    console.log(`⚠️  Error getting MFA token from 1Password: ${error.message}`);
    return null;
  }
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
        console.log(`🔍 MFA serial being used: ${mfaSerial}`);
        
        // Check if the long-term profile has a region configured, which is required for MFA
        let regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', longTermProfile]);
        let region = regionResult.success ? regionResult.stdout : '';
        
        if (!region) {
          // Try to get region from standard profile
          regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
          region = regionResult.success ? regionResult.stdout : '';
          
          if (region) {
            console.log(`🔍 No region found in long-term profile, using region from standard profile: ${region}`);
            // Ensure long-term profile has the region set
            execAwsCommand(['configure', 'set', 'region', region, '--profile', longTermProfile]);
          } else {
            console.log(`⚠️ No region configured for profile: ${longTermProfile} (required for MFA)`);
            console.log(`🔍 Setting default region to us-east-1`);
            // Set a default region as fallback
            execAwsCommand(['configure', 'set', 'region', 'us-east-1', '--profile', longTermProfile]);
            region = 'us-east-1';
          }
        } else {
          console.log(`🔍 Using region from long-term profile: ${region}`);
        }
        
        // Try to get MFA token from 1Password first
        const onePasswordToken = await getMfaTokenFrom1Password(longTermProfile);
        
        // Process for getting and validating the token
        const processToken = async (tokenCode) => {
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
              
              // Mark profile as using 1Password
              if (onePasswordToken) {
                execAwsCommand(['configure', 'set', 'aws_1password_mfa', 'true', '--profile', profile]);
              }
              
              // Verify the credentials work
              const verifyResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
              
              if (verifyResult.success) {
                console.log(`✅ Successfully authenticated with MFA for profile: ${profile}`);
                // Display identity info
                execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
                return true;
              } else {
                console.log("⚠️  MFA authentication failed: Credentials validation error");
                return false;
              }
            } catch (error) {
              console.log(`⚠️  MFA authentication failed: ${error.message}`);
              return false;
            }
          } else {
            console.log("⚠️  MFA authentication failed: Invalid token or connection error");
            return false;
          }
        };
        
        // If we got a token from 1Password, use it
        if (onePasswordToken) {
          const success = await processToken(onePasswordToken);
          if (success) {
            rl.close();
            process.exit(0);
          }
          // If 1Password token failed, fall back to manual entry
          console.log("⚠️  1Password MFA token failed, falling back to manual entry");
        }
        
        // Prompt for MFA token if 1Password integration failed or is not available
        await new Promise((resolve) => {
          rl.question('Enter MFA token: ', async (tokenCode) => {
            const success = await processToken(tokenCode);
            if (success) {
              rl.close();
              process.exit(0);
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