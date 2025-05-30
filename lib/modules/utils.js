// Utilities Module
// General utility functions for AWS Profile Auth CLI

const { spawnSync } = require('child_process');
const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');

// Function to check if a command exists
function commandExists(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  return result.status === 0;
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
      // Calculate remaining time
      const remainingTimeMs = expirationTime - currentTime;
      const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
      const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));
      const remainingSeconds = Math.floor((remainingTimeMs % (1000 * 60)) / 1000);
      
      // Format the time remaining
      let timeRemaining = '';
      if (remainingHours > 0) {
        timeRemaining = `${remainingHours}h ${remainingMinutes}m`;
      } else if (remainingMinutes > 0) {
        timeRemaining = `${remainingMinutes}m ${remainingSeconds}s`;
      } else {
        timeRemaining = `${remainingSeconds}s`;
      }
      
      console.log(`✅ Successfully authenticated using profile: ${profile} (expires in ${timeRemaining} at ${expirationTime.toLocaleString()})`);
      return false;
    }
  }
  
  // No expiration time found, assume credentials are valid
  return false;
}

// Function to validate AWS session with a quick API call
function isSessionValid(profile) {
  console.log(`🔍 Validating session for profile: ${profile}`);
  
  // Check if this is an SSO profile
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  
  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';
  
  if (ssoSession || ssoStartUrl) {
    // This is an SSO profile, check the SSO token expiration
    const ssoTokenExpirationCheck = checkSsoTokenExpiration(profile, ssoSession);
    if (!ssoTokenExpirationCheck) {
      console.log('⚠️ SSO token has expired or is not found');
      return false;
    }
  }
  
  // Try a lightweight S3 API call to verify the session is valid
  // Using 'head-bucket' on the 'aws-cli' bucket which is public and always exists
  const result = execAwsCommand(['s3api', 'head-bucket', '--bucket', 'aws-cli', '--profile', profile]);
  
  // Alternative: try get-caller-identity if S3 check fails
  if (!result.success) {
    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
    return identityResult.success;
  }
  
  return result.success;
}

// Function to check SSO token expiration
function checkSsoTokenExpiration(profile, ssoSession) {
  // Direct command to check if the SSO token is still valid
  console.log('🔍 Checking SSO token expiration...');
  
  try {
    // First determine the cache location for SSO tokens
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const awsDir = `${homeDir}/.aws`;
    
    // If ssoSession is provided, the cache will be in sso/cache
    // Otherwise, it will be in the older SSO token cache location
    const ssoDir = ssoSession ? `${awsDir}/sso/cache` : `${awsDir}/.sso/cache`;
    
    // Check if directory exists
    const checkDirResult = spawnSync('test', ['-d', ssoDir], { stdio: 'pipe' });
    if (checkDirResult.status !== 0) {
      console.log(`⚠️ SSO cache directory not found: ${ssoDir}`);
      return false;
    }
    
    // List the token files
    const listFilesResult = spawnSync('ls', ['-1', ssoDir], { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    if (listFilesResult.status !== 0 || !listFilesResult.stdout) {
      console.log('⚠️ No SSO token cache files found');
      return false;
    }
    
    // Look for the most recent JSON file
    const files = listFilesResult.stdout.split('\n').filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
      console.log('⚠️ No SSO token JSON files found in cache');
      return false;
    }
    
    // Check each file for valid token
    let validToken = false;
    for (const file of files) {
      const tokenPath = `${ssoDir}/${file}`;
      const readResult = spawnSync('cat', [tokenPath], { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      if (readResult.status === 0 && readResult.stdout) {
        try {
          const tokenData = JSON.parse(readResult.stdout);
          
          // Check for an expiration field
          if (tokenData.expiresAt) {
            const expirationTime = new Date(tokenData.expiresAt);
            const currentTime = new Date();
            
            if (expirationTime > currentTime) {
              console.log(`✅ Found valid SSO token (expires at ${expirationTime.toLocaleString()})`);
              
              // Calculate remaining time
              const remainingTimeMs = expirationTime - currentTime;
              const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
              const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));
              
              if (remainingHours > 0) {
                console.log(`ℹ️  SSO token valid for ${remainingHours}h ${remainingMinutes}m`);
              } else {
                console.log(`ℹ️  SSO token valid for ${remainingMinutes}m`);
              }
              
              validToken = true;
              break;
            } else {
              console.log(`⚠️ SSO token expired at ${expirationTime.toLocaleString()}`);
            }
          }
        } catch (e) {
          // Invalid JSON, continue to next file
        }
      }
    }
    
    return validToken;
  } catch (error) {
    console.log(`⚠️ Error checking SSO token: ${error.message}`);
    return false;
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
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
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
      rl.close();
    });
  });
}

// Function to get the source identity ARN for trust policy configuration
async function getSourceIdentityArn(profile) {
  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile, '--output', 'json']);
  
  if (identityResult.success) {
    try {
      const identity = JSON.parse(identityResult.stdout);
      return identity.Arn;
    } catch (e) {
      console.log(`⚠️ Failed to parse identity: ${e.message}`);
      return null;
    }
  }
  return null;
}

// Function to help users with cross-account trust policies
async function displayTrustPolicyHelp(profile, targetAccountId, targetRoleName) {
  console.log('\n📝 Trust Policy Helper for Cross-Account Access');
  
  const sourceArn = await getSourceIdentityArn(profile);
  if (!sourceArn) {
    console.log('⚠️ Could not retrieve source identity ARN. Please authenticate first.');
    return;
  }
  
  console.log(`\n✅ Your current identity: ${sourceArn}`);
  console.log(`✅ Target role: arn:aws:iam::${targetAccountId}:role/${targetRoleName}`);
  
  console.log('\n🔑 To enable cross-account access, update the trust policy of the target role:');
  
  const trustPolicy = {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": sourceArn
        },
        "Action": "sts:AssumeRole",
        "Condition": {}
      }
    ]
  };
  
  console.log('\n```json');
  console.log(JSON.stringify(trustPolicy, null, 2));
  console.log('```');
  
  console.log('\n💡 You can update the trust policy using AWS CLI:');
  console.log(`aws iam update-assume-role-policy --role-name ${targetRoleName} --policy-document '${JSON.stringify(trustPolicy)}'`);
  
  console.log('\n⚠️ Note: You must have permissions to edit role trust policies in the target account.');
}

// Function to cleanup AWS profile credentials
async function cleanupAwsProfile(profile) {
  console.log(`🧹 Cleaning up credentials for profile: ${profile}`);
  
  // Get all the AWS configuration keys for the profile
  const configKeysResult = execAwsCommand(['configure', 'list', '--profile', profile]);
  
  if (!configKeysResult.success) {
    console.log(`❌ Failed to retrieve configuration for profile: ${profile}`);
    return false;
  }
  
  // Check if this is a sub-profile (created via --select)
  const parentProfileResult = execAwsCommand(['configure', 'get', 'parent_profile', '--profile', profile]);
  const isSubProfile = parentProfileResult.success && parentProfileResult.stdout;
  
  // Credentials to clear
  const credentialsToRemove = [
    'aws_access_key_id',
    'aws_secret_access_key',
    'aws_session_token',
    'aws_session_expiration'
  ];
  
  // If it's a sub-profile, remove additional metadata
  if (isSubProfile) {
    credentialsToRemove.push('parent_profile', 'account_id', 'role_name');
  }
  
  // Clear each credential key
  console.log('🔑 Removing temporary credentials...');
  let allSuccess = true;
  
  for (const key of credentialsToRemove) {
    // Check if the key exists before attempting to unset it
    const checkResult = execAwsCommand(['configure', 'get', key, '--profile', profile]);
    
    if (checkResult.success) {
      const unsetResult = execAwsCommand(['configure', 'unset', key, '--profile', profile]);
      
      if (!unsetResult.success) {
        console.log(`⚠️ Failed to remove ${key} from profile ${profile}`);
        allSuccess = false;
      }
    }
  }
  
  // Clear SSO cache if the profile uses SSO
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  
  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';
  
  if (ssoSession || ssoStartUrl) {
    // Clear SSO cache is more complex and would require deleting specific cache files
    console.log('ℹ️ This profile uses SSO. SSO session tokens in browser cache are not affected.');
  }
  
  if (allSuccess) {
    console.log(`✅ Successfully cleaned up credentials for profile: ${profile}`);
    return true;
  } else {
    console.log(`⚠️ Some cleanup operations failed for profile: ${profile}`);
    return false;
  }
}

module.exports = {
  commandExists,
  checkCredentialsExpired,
  isSessionValid,
  promptForRoleArn,
  displayTrustPolicyHelp,
  getSourceIdentityArn,
  cleanupAwsProfile
};