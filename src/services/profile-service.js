'use strict';

const { execAwsCommand } = require('../core/aws');
const { askText } = require('../core/prompt');
const {
  getProfileValue,
  setProfileValue,
  clearProfileKeys,
  unsetProfileKey
} = require('./aws-config');

async function promptForRoleArn(profile) {
  let suggestion = '';
  let defaultRoleArn = '';
  let accountId = null;

  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
  if (identityResult.success) {
    try {
      const identity = JSON.parse(identityResult.stdout);
      accountId = identity.Account;
      if (accountId) {
        defaultRoleArn = `arn:aws:iam::${accountId}:role/YourRoleName`;
        suggestion = ` (example: ${defaultRoleArn})`;
      }
    } catch (error) {
      // Ignore parse problems and continue gathering hints.
    }
  }

  if (!accountId) {
    const sourceProfile = getProfileValue(profile, 'source_profile');
    if (sourceProfile) {
      const sourceIdentityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', sourceProfile]);
      if (sourceIdentityResult.success) {
        try {
          const identity = JSON.parse(sourceIdentityResult.stdout);
          accountId = identity.Account;
          if (accountId) {
            defaultRoleArn = `arn:aws:iam::${accountId}:role/YourRoleName`;
            suggestion = ` (example: ${defaultRoleArn})`;
          }
        } catch (error) {
          // Ignore parse problems.
        }
      }
    }
  }

  if (!accountId) {
    const longTermProfile = `${profile}-long-term`;
    const longTermIdentityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', longTermProfile]);

    if (longTermIdentityResult.success) {
      try {
        const identity = JSON.parse(longTermIdentityResult.stdout);
        accountId = identity.Account;
        if (accountId) {
          defaultRoleArn = `arn:aws:iam::${accountId}:role/YourRoleName`;
          suggestion = ` (example: ${defaultRoleArn})`;
        }
      } catch (error) {
        // Ignore parse problems.
      }
    }
  }

  const answer = await askText(`Enter role ARN to assume${suggestion}`, {
    defaultValue: defaultRoleArn || undefined
  });

  let finalRoleArn = answer || defaultRoleArn || null;

  if (finalRoleArn && !finalRoleArn.startsWith('arn:aws:') && accountId) {
    finalRoleArn = `arn:aws:iam::${accountId}:role/${finalRoleArn}`;
  }

  if (finalRoleArn) {
    console.log(`🔄 Setting role_arn for profile ${profile} to ${finalRoleArn}`);
    setProfileValue(profile, 'role_arn', finalRoleArn);
    return finalRoleArn;
  }

  console.log('⚠️  No role ARN provided, continuing without setting role_arn');
  return null;
}

async function getSourceIdentityArn(profile) {
  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile, '--output', 'json']);
  if (identityResult.success) {
    try {
      const identity = JSON.parse(identityResult.stdout);
      return identity.Arn;
    } catch (error) {
      console.log(`⚠️ Failed to parse identity: ${error.message}`);
      return null;
    }
  }
  return null;
}

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
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          AWS: sourceArn
        },
        Action: 'sts:AssumeRole',
        Condition: {}
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

async function cleanupAwsProfile(profile) {
  console.log(`🧹 Cleaning up credentials for profile: ${profile}`);

  const parentProfile = getProfileValue(profile, 'parent_profile');
  const isSubProfile = Boolean(parentProfile);

  const credentialKeys = [
    'aws_access_key_id',
    'aws_secret_access_key',
    'aws_session_token',
    'aws_session_expiration'
  ];

  let cleanupSuccess = clearProfileKeys(profile, credentialKeys);
  if (!cleanupSuccess) {
    console.log(`⚠️ Failed to remove one or more credential keys from profile ${profile}`);
  }

  if (isSubProfile) {
    cleanupSuccess = clearProfileKeys(profile, ['parent_profile', 'account_id', 'role_name', 'account_name']) && cleanupSuccess;
  }

  const ssoSession = getProfileValue(profile, 'sso_session');
  const ssoStartUrl = getProfileValue(profile, 'sso_start_url');

  if (ssoSession || ssoStartUrl) {
    console.log('ℹ️ This profile uses SSO. Browser or device SSO cache tokens are not removed by this operation.');
  }

  if (!cleanupSuccess) {
    console.log(`⚠️ Completed cleanup for profile ${profile} with warnings.`);
    return false;
  }

  console.log(`✅ Completed cleanup for profile: ${profile}`);
  return true;
}

module.exports = {
  promptForRoleArn,
  displayTrustPolicyHelp,
  getSourceIdentityArn,
  cleanupAwsProfile
};
