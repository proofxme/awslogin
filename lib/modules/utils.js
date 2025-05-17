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

module.exports = {
  commandExists,
  checkCredentialsExpired,
  isSessionValid,
  promptForRoleArn
};