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

// Function to check if a command exists
function commandExists(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0;
}

// Function to get MFA token from 1Password
async function getMfaTokenFrom1Password(profileName) {
  try {
    // Check if 1Password CLI is installed
    if (!commandExists('op')) {
      console.log('⚠️  1Password CLI not found, falling back to manual MFA entry');
      return null;
    }

    // Strip the -long-term suffix if present for consistent 1Password searching
    const baseProfileName = profileName.endsWith('-long-term') 
      ? profileName.replace('-long-term', '') 
      : profileName;
    
    console.log(`🔍 Searching for MFA token in 1Password for profile: ${baseProfileName}`);
    
    // First, check if we have a saved item ID for this profile
    // Use the base profile name for consistent storage/retrieval
    const savedItemIdResult = execAwsCommand(['configure', 'get', 'aws_1password_item_id', '--profile', baseProfileName]);
    const savedItemId = savedItemIdResult.success ? savedItemIdResult.stdout : '';
    
    let item = null;
    
    // If we have a saved item ID, try to use it directly
    if (savedItemId) {
      console.log(`🔍 Found saved 1Password item ID: ${savedItemId}`);
      
      // Get item info to verify it still exists
      const itemInfoResult = exec1PasswordCommand(['item', 'get', savedItemId, '--format', 'json']);
      
      if (itemInfoResult.success) {
        try {
          item = JSON.parse(itemInfoResult.stdout);
          console.log(`🔐 Using previously selected item: ${item.title}`);
        } catch (e) {
          console.log(`⚠️  Failed to parse saved 1Password item: ${e.message}`);
          item = null;
        }
      } else {
        console.log(`⚠️  Saved 1Password item no longer exists, will search for alternatives`);
      }
    }
    
    // If we don't have a saved item or it's no longer valid, search for items
    if (!item) {
      // Try to find an account name based on the profile name
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
          // Use a do-while loop to repeatedly prompt until a valid selection is made
          let validSelection = false;
          let index = -1;
          
          while (!validSelection) {
            const selection = await new Promise(resolve => {
              tempRl.question('Enter number of entry to use: ', answer => {
                resolve(answer);
              });
            });
            
            index = parseInt(selection) - 1;
            
            if (!isNaN(index) && index >= 0 && index < awsItems.length) {
              validSelection = true;
              tempRl.close();
            } else {
              console.log('⚠️  Invalid selection, please enter a number between 1 and ' + awsItems.length);
              
              // If the RL was closed unexpectedly (e.g. by terminal closing or Ctrl+C)
              if (tempRl.closed) {
                throw new Error('Selection process was interrupted');
              }
            }
          }
          
          item = awsItems[index];
          console.log(`🔐 Using selected item: ${item.title}`);
          
          // Store the selected 1Password item ID in the AWS config
          console.log(`🔄 Storing selected 1Password item in AWS config for future use`);
          execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
        } catch (error) {
          console.log(`⚠️  Error selecting 1Password entry: ${error.message}`);
          console.log('⚠️  Please try again with a valid selection');
          tempRl.close(); // Ensure the readline interface is closed
          return null;
        }
      } else {
        // Use the only matching item
        item = awsItems[0];
        
        // Store the selected 1Password item ID in the AWS config
        console.log(`🔄 Storing selected 1Password item in AWS config for future use`);
        execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
      }
    }
    // Get the item details to find the TOTP field if we haven't already
    let itemData = item;
    
    // If the item was loaded in a simplified format, we need to get full details
    if (!item.fields) {
      console.log(`🔍 Getting details for 1Password item: ${item.title} (${item.id})`);
      const itemDetail = exec1PasswordCommand(['item', 'get', item.id, '--format', 'json']);
      
      if (!itemDetail.success) {
        console.log('⚠️  Failed to get item details from 1Password');
        return null;
      }
      
      try {
        itemData = JSON.parse(itemDetail.stdout);
      } catch (e) {
        console.log(`⚠️  Failed to parse 1Password item details: ${e.message}`);
        return null;
      }
    }
    
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
    if (itemData.fields) {
      totpField = itemData.fields.find(field => field.type === 'OTP');
      
      // If not found, look for field with TOTP property
      if (!totpField) {
        totpField = itemData.fields.find(field => field.totp);
      }
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
      console.log(`⚠️  No TOTP field found in 1Password for item: ${itemData.title}`);
      console.log(`🔧 Try: op item get "${itemData.title}" --otp`);
      return null;
    }
    
    // Now get the actual OTP code using 1Password CLI
    console.log(`🔐 Getting current OTP from 1Password for item: ${itemData.title}`);
    const otpResult = exec1PasswordCommand(['item', 'get', item.id, '--otp']);
    
    if (!otpResult.success) {
      console.log(`⚠️  Failed to get OTP from 1Password for item: ${itemData.title}`);
      console.log(`⚠️  Error: ${otpResult.stderr}`);
      return null;
    }
    
    // Return the current OTP value
    const token = otpResult.stdout.trim();
    console.log(`🔐 Retrieved MFA token from 1Password for item: ${itemData.title}`);
    console.log(`🔍 DEBUG: Token length: ${token.length}, Token: ${token.substring(0, 3)}...`);
    return token;
  } catch (error) {
    console.log(`⚠️  Error getting MFA token from 1Password: ${error.message}`);
    return null;
  }
}

// Function to prompt user for role name and save to config
async function promptForRoleArn(profile) {
  // Try to get account ID to suggest a default role ARN
  let suggestion = '';
  let defaultRoleArn = '';
  let accountId = null;
  
  // First try to get identity from the profile
  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
  
  if (identityResult.success) {
    try {
      const identity = JSON.parse(identityResult.stdout);
      accountId = identity.Account;
      
      if (accountId) {
        suggestion = ` [Example: arn:aws:iam::${accountId}:role/YourRoleName]`;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }
  
  // If we couldn't get the account ID from identity, try the source profile
  if (!accountId) {
    // Check if there's a source profile
    const sourceProfileResult = execAwsCommand(['configure', 'get', 'source_profile', '--profile', profile]);
    const sourceProfile = sourceProfileResult.success ? sourceProfileResult.stdout : '';
    
    if (sourceProfile) {
      // Try to get identity from source profile
      const sourceIdentityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', sourceProfile]);
      
      if (sourceIdentityResult.success) {
        try {
          const identity = JSON.parse(sourceIdentityResult.stdout);
          accountId = identity.Account;
          
          if (accountId) {
            suggestion = ` [Example: arn:aws:iam::${accountId}:role/YourRoleName]`;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }
  
  // If still no suggestion, try the long-term profile variant
  if (!accountId) {
    const longTermProfile = `${profile}-long-term`;
    const longTermIdentityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', longTermProfile]);
    
    if (longTermIdentityResult.success) {
      try {
        const identity = JSON.parse(longTermIdentityResult.stdout);
        accountId = identity.Account;
        
        if (accountId) {
          suggestion = ` [Example: arn:aws:iam::${accountId}:role/YourRoleName]`;
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  }
  
  return new Promise((resolve) => {
    rl.question(`Enter role ARN to assume${suggestion}: `, (roleInput) => {
      let finalRoleArn = roleInput || (defaultRoleArn ? defaultRoleArn : null);
      
      if (finalRoleArn) {
        // Check if the input is just a role name without the full ARN format
        if (!finalRoleArn.startsWith('arn:aws:') && accountId) {
          // Convert role name to ARN format
          finalRoleArn = `arn:aws:iam::${accountId}:role/${finalRoleArn}`;
        }
        
        console.log(`🔄 Setting role_arn for profile ${profile} to ${finalRoleArn}`);
        execAwsCommand(['configure', 'set', 'role_arn', finalRoleArn, '--profile', profile]);
        resolve(finalRoleArn);
      } else {
        console.log('⚠️  No role ARN provided, continuing without setting role_arn');
        resolve(null);
      }
    });
  });
}

// Helper function to extract account ID from ARN
function extractAccountIdFromArn(arn) {
  if (!arn) return null;
  const match = arn.match(/arn:aws:iam::(\d+):/);
  return match ? match[1] : null;
}

// Helper function to extract username from caller identity or ARN
function extractUsername(identityArn) {
  if (!identityArn) return null;
  
  // Extract username from assumed role ARN: arn:aws:sts::123456789012:assumed-role/RoleName/username
  let match = identityArn.match(/assumed-role\/[^/]+\/([^/]+)$/);
  if (match) return match[1];
  
  // Extract username from user ARN: arn:aws:iam::123456789012:user/username
  match = identityArn.match(/user\/([^/]+)$/);
  if (match) return match[1];
  
  return null;
}

// Function to prompt user for MFA device and save to config
async function promptForMfaDevice(profile) {
  // Try to get account ID and username to suggest a default MFA ARN
  let defaultMfaArn = '';
  let suggestion = '';
  
  // Check if we can get an identity from the profile or a parent profile
  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
  
  if (identityResult.success) {
    try {
      const identity = JSON.parse(identityResult.stdout);
      const accountId = identity.Account;
      const username = extractUsername(identity.Arn);
      
      if (accountId && username) {
        defaultMfaArn = `arn:aws:iam::${accountId}:mfa/${username}`;
        suggestion = ` [${defaultMfaArn}]`;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  } else {
    // If direct identity check fails, try to extract account ID from a role ARN
    const roleArnResult = execAwsCommand(['configure', 'get', 'role_arn', '--profile', profile]);
    if (roleArnResult.success) {
      const accountId = extractAccountIdFromArn(roleArnResult.stdout);
      if (accountId) {
        suggestion = ` [Example: arn:aws:iam::${accountId}:mfa/YOUR_USERNAME]`;
      }
    }
  }
  
  return new Promise((resolve) => {
    rl.question(`Enter MFA device ARN${suggestion}: `, (mfaDevice) => {
      // If user just hits enter and we have a default suggestion, use that
      const finalMfaDevice = mfaDevice || (defaultMfaArn ? defaultMfaArn : null);
      
      if (finalMfaDevice) {
        console.log(`🔄 Setting aws_mfa_device for profile ${profile} to ${finalMfaDevice}`);
        execAwsCommand(['configure', 'set', 'aws_mfa_device', finalMfaDevice, '--profile', profile]);
        resolve(finalMfaDevice);
      } else {
        console.log('⚠️  No MFA device provided, continuing without setting aws_mfa_device');
        resolve(null);
      }
    });
  });
}

// Function to check if credentials are expired or will expire soon
function checkCredentialsExpired(profile) {
  const credsExpireResult = execAwsCommand(['configure', 'get', 'aws_session_expiration', '--profile', profile]);
  
  if (credsExpireResult.success && credsExpireResult.stdout) {
    const expirationTime = new Date(credsExpireResult.stdout);
    const currentTime = new Date();
    // Check if tokens are expired (or will expire in less than 15 minutes)
    const bufferTime = new Date(currentTime.getTime() + 15 * 60 * 1000);
    
    if (expirationTime <= bufferTime) {
      console.log(`⚠️ Credentials for profile ${profile} have expired or will expire soon. Refreshing...`);
      return true;
    } else {
      console.log(`✅ Successfully authenticated using profile: ${profile} (valid until ${expirationTime.toLocaleString()})`);
      return false;
    }
  }
  
  // No expiration time found, assume credentials are valid
  return false;
}

// Main function
async function main() {
  // Process command line arguments
  const args = process.argv.slice(2);
  const profile = args[0];
  
  // Parse optional flags
  let mfaToken = null;
  for (let i = 1; i < args.length; i++) {
    if ((args[i] === '--token' || args[i] === '--mfa-token') && args[i + 1]) {
      mfaToken = args[i + 1];
      i++; // Skip the token value in next iteration
    }
  }
  
  if (!profile) {
    console.log("ℹ️  Usage: awslogin <profile_name> [--token <mfa_token>]");
    console.log("Example: awslogin metalab");
    console.log("         awslogin metalab --token 123456");
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
      // Check for MFA serial
      let mfaSerialResult = execAwsCommand(['configure', 'get', 'aws_mfa_device', '--profile', longTermProfile]);
      let mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
      
      if (!mfaSerial) {
        mfaSerialResult = execAwsCommand(['configure', 'get', 'mfa_serial', '--profile', longTermProfile]);
        mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
      }
      
      // If MFA serial not found, prompt user to input it
      if (!mfaSerial) {
        console.log(`⚠️ No MFA device configured for profile ${longTermProfile}`);
        mfaSerial = await promptForMfaDevice(longTermProfile);
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
        
        // Check if MFA token was provided as command-line argument
        let onePasswordToken = null;
        if (mfaToken) {
          console.log(`🔍 Using MFA token provided via command line`);
          onePasswordToken = mfaToken;
        } else {
          // Try to get MFA token from 1Password first
          onePasswordToken = await getMfaTokenFrom1Password(longTermProfile);
        }
        
        // Check if the long-term profile has an assume_role configured
        const assumeRoleResult = execAwsCommand(['configure', 'get', 'assume_role', '--profile', longTermProfile]);
        const assumeRole = assumeRoleResult.success ? assumeRoleResult.stdout : '';
        
        // Process for getting and validating the token
        const processToken = async (tokenCode) => {
          let credsJson;
          
          if (assumeRole) {
            // If we have a role to assume, use sts assume-role with MFA
            const sessionName = `awslogin-${Date.now()}`;
            const assumeRoleTokenResult = execAwsCommand([
              'sts', 'assume-role',
              '--profile', longTermProfile,
              '--role-arn', assumeRole,
              '--role-session-name', sessionName,
              '--serial-number', mfaSerial,
              '--token-code', tokenCode,
              '--duration-seconds', '28800',
              '--output', 'json'
            ]);
            
            if (!assumeRoleTokenResult.success) {
              console.log("⚠️  Failed to assume role with MFA");
              if (assumeRoleTokenResult.stderr) {
                console.log(`🔍 AWS error: ${assumeRoleTokenResult.stderr}`);
              }
              return false;
            }
            
            credsJson = JSON.parse(assumeRoleTokenResult.stdout);
          } else {
            // No role to assume, just get session token with MFA
            const sessionTokenResult = execAwsCommand([
              'sts', 'get-session-token',
              '--profile', longTermProfile,
              '--serial-number', mfaSerial,
              '--token-code', tokenCode,
              '--duration-seconds', '28800',
              '--output', 'json'
            ]);
            
            if (!sessionTokenResult.success) {
              console.log("⚠️  MFA authentication failed: Invalid token or connection error");
              if (sessionTokenResult.stderr) {
                console.log(`🔍 AWS error: ${sessionTokenResult.stderr}`);
              }
              return false;
            }
            
            credsJson = JSON.parse(sessionTokenResult.stdout);
          }
          
          try {
            // Extract credentials from JSON response
            const accessKey = credsJson.Credentials.AccessKeyId;
            const secretKey = credsJson.Credentials.SecretAccessKey;
            const sessionToken = credsJson.Credentials.SessionToken;
            const expiration = credsJson.Credentials.Expiration; // ISO format timestamp
            
            // Store credentials in the main profile
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
                console.log(`🔍 DEBUG: Verification error: ${verifyResult.stderr}`);
                return false;
              }
            } catch (error) {
              console.log(`⚠️  MFA authentication failed: ${error.message}`);
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