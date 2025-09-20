'use strict';

const { execAwsCommand } = require('../core/aws');
const { askQuestion } = require('../core/prompt');

async function promptForMfaDevice(profile) {
  let defaultMfaArn = '';
  let suggestion = '';

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
    } catch (error) {
      // Ignore parsing errors.
    }
  } else {
    const roleArnResult = execAwsCommand(['configure', 'get', 'role_arn', '--profile', profile]);
    if (roleArnResult.success) {
      const accountId = extractAccountIdFromArn(roleArnResult.stdout);
      if (accountId) {
        suggestion = ` [Example: arn:aws:iam::${accountId}:mfa/YOUR_USERNAME]`;
      }
    }
  }

  const answer = await askQuestion(`Enter MFA device ARN${suggestion}: `);
  const finalMfaDevice = answer || (defaultMfaArn ? defaultMfaArn : null);

  if (finalMfaDevice) {
    console.log(`🔄 Setting aws_mfa_device for profile ${profile} to ${finalMfaDevice}`);
    execAwsCommand(['configure', 'set', 'aws_mfa_device', finalMfaDevice, '--profile', profile]);
    return finalMfaDevice;
  }

  console.log('⚠️  No MFA device provided, continuing without setting aws_mfa_device');
  return null;
}

function extractAccountIdFromArn(arn) {
  if (!arn) return null;
  const match = arn.match(/arn:aws:iam::(\d+):/);
  return match ? match[1] : null;
}

function extractUsername(identityArn) {
  if (!identityArn) return null;

  let match = identityArn.match(/assumed-role\/[^/]+\/([^/]+)$/);
  if (match) return match[1];

  match = identityArn.match(/user\/([^/]+)$/);
  if (match) return match[1];

  return null;
}

module.exports = {
  promptForMfaDevice,
  extractAccountIdFromArn,
  extractUsername
};
