// MFA Module
// Handles Multi-Factor Authentication operations

const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');

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
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
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
      rl.close();
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

module.exports = {
  promptForMfaDevice,
  extractAccountIdFromArn,
  extractUsername
};