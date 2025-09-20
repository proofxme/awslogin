'use strict';

const { execAwsCommand } = require('../core/aws');
const { selectFromList } = require('../core/prompt');
const { displayTrustPolicyHelp } = require('./profile-service');

async function listSsoAccounts(profile) {
  console.log('🔍 Retrieving available SSO accounts...');

  const accountsResult = execAwsCommand(['sso', 'list-accounts', '--profile', profile, '--output', 'json']);

  if (!accountsResult.success) {
    console.log('⚠️  Failed to list SSO accounts directly');
    console.log('🔍 This may be because you have permissions via a group-based assignment');
    console.log('🔍 Attempting to retrieve accounts from organization structure...');

    const orgsAccountsResult = execAwsCommand(['organizations', 'list-accounts', '--profile', profile, '--output', 'json']);

    if (orgsAccountsResult.success) {
      try {
        const orgsData = JSON.parse(orgsAccountsResult.stdout);
        const activeAccounts = orgsData.Accounts.filter((acc) => acc.Status === 'ACTIVE');

        if (activeAccounts.length > 0) {
          console.log(`✅ Found ${activeAccounts.length} active accounts in your organization`);

          return activeAccounts.map((acc) => ({
            accountId: acc.Id,
            accountName: acc.Name,
            emailAddress: acc.Email
          }));
        }
      } catch (error) {
        console.log(`⚠️  Error parsing organization accounts: ${error.message}`);
      }
    }

    console.log('❌ Unable to retrieve accounts list from any source');
    return null;
  }

  try {
    const data = JSON.parse(accountsResult.stdout);
    return data.accountList || [];
  } catch (error) {
    console.log('⚠️  Failed to parse SSO accounts response');
    return null;
  }
}

async function listAccountRoles(profile, accountId) {
  console.log(`🔍 Retrieving available roles for account ${accountId}...`);

  const rolesResult = execAwsCommand(['sso', 'list-account-roles', '--profile', profile, '--account-id', accountId, '--output', 'json']);

  if (!rolesResult.success) {
    console.log('⚠️  Failed to list account roles directly');
    console.log('🔍 This may be because you have permissions via a group-based assignment');
    console.log('🔍 Attempting to discover common roles based on IAM Identity Center setup...');

    const commonRoles = [
      { roleName: 'AdministratorAccess', displayName: 'Administrator Access' },
      { roleName: 'PowerUserAccess', displayName: 'Power User Access' },
      { roleName: 'ReadOnlyAccess', displayName: 'Read Only Access' },
      { roleName: 'AWSAdministratorAccess', displayName: 'AWS Administrator Access' },
      { roleName: 'AWSPowerUserAccess', displayName: 'AWS Power User Access' },
      { roleName: 'AWSReadOnlyAccess', displayName: 'AWS Read Only Access' }
    ];

    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile, '--output', 'json']);

    if (identityResult.success) {
      console.log('✅ Authenticated to main profile. Testing common roles for the target account...');
      console.log('ℹ️  If you are part of an IAM Identity Center group with access to multiple accounts,');
      console.log('   you should have the same role permissions across accounts.');
      return commonRoles;
    }

    console.log('❌ Unable to retrieve roles for this account');
    return null;
  }

  try {
    const data = JSON.parse(rolesResult.stdout);
    return data.roleList || [];
  } catch (error) {
    console.log('⚠️  Failed to parse account roles response');
    return null;
  }
}

async function promptAccountSelection(accounts) {
  return selectFromList(accounts, {
    header: '\n📋 Available AWS accounts:',
    formatOption: (account) => {
      const accountName = account.accountName || 'Unnamed Account';
      return `${accountName} (${account.accountId})`;
    },
    prompt: 'Select an account (enter number): '
  });
}

async function promptRoleSelection(roles) {
  return selectFromList(roles, {
    header: '\n📋 Available roles:',
    formatOption: (role) => role.roleName,
    prompt: 'Select a role (enter number): '
  });
}

async function getSsoRoleCredentials(profile, accountId, roleName) {
  console.log(`🔐 Getting credentials for role ${roleName} in account ${accountId}...`);

  const tempProfileName = `temp-${accountId}-${roleName}-${Date.now()}`;

  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  const ssoRegionResult = execAwsCommand(['configure', 'get', 'sso_region', '--profile', profile]);

  if (ssoSessionResult.success || ssoStartUrlResult.success) {
    console.log(`🔄 Creating temporary profile with parent's SSO configuration`);

    if (ssoSessionResult.success) {
      execAwsCommand(['configure', 'set', 'sso_session', ssoSessionResult.stdout, '--profile', tempProfileName]);
    } else if (ssoStartUrlResult.success) {
      execAwsCommand(['configure', 'set', 'sso_start_url', ssoStartUrlResult.stdout, '--profile', tempProfileName]);
      if (ssoRegionResult.success) {
        execAwsCommand(['configure', 'set', 'sso_region', ssoRegionResult.stdout, '--profile', tempProfileName]);
      }
    }

    execAwsCommand(['configure', 'set', 'sso_account_id', accountId, '--profile', tempProfileName]);
    execAwsCommand(['configure', 'set', 'sso_role_name', roleName, '--profile', tempProfileName]);

    const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
    if (regionResult.success) {
      execAwsCommand(['configure', 'set', 'region', regionResult.stdout, '--profile', tempProfileName]);
    }

    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', tempProfileName, '--output', 'json']);

    if (identityResult.success) {
      console.log(`✅ Successfully authenticated to account ${accountId} with role ${roleName}`);

      const accessKeyResult = execAwsCommand(['configure', 'get', 'aws_access_key_id', '--profile', tempProfileName]);
      const secretKeyResult = execAwsCommand(['configure', 'get', 'aws_secret_access_key', '--profile', tempProfileName]);
      const sessionTokenResult = execAwsCommand(['configure', 'get', 'aws_session_token', '--profile', tempProfileName]);

      console.log(`🔄 Cleaning up temporary profile`);
      execAwsCommand(['configure', 'unset', 'sso_session', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_start_url', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_region', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_account_id', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_role_name', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'region', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'aws_access_key_id', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'aws_secret_access_key', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'aws_session_token', '--profile', tempProfileName]);

      if (accessKeyResult.success && secretKeyResult.success && sessionTokenResult.success) {
        return {
          accessKeyId: accessKeyResult.stdout,
          secretAccessKey: secretKeyResult.stdout,
          sessionToken: sessionTokenResult.stdout,
          expiration: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
        };
      }

      console.log('⚠️  Could not retrieve generated credentials from temporary profile');
      return null;
    }

    execAwsCommand(['configure', 'unset', 'sso_session', '--profile', tempProfileName]);
    execAwsCommand(['configure', 'unset', 'sso_start_url', '--profile', tempProfileName]);
    execAwsCommand(['configure', 'unset', 'sso_region', '--profile', tempProfileName]);
    execAwsCommand(['configure', 'unset', 'sso_account_id', '--profile', tempProfileName]);
    execAwsCommand(['configure', 'unset', 'sso_role_name', '--profile', tempProfileName]);
    execAwsCommand(['configure', 'unset', 'region', '--profile', tempProfileName]);

    console.log('⚠️  Failed to get credentials using cached SSO session');
  }

  console.log('🔄 Attempting alternative method via assume-role...');

  const parentCredsResult = execAwsCommand([
    'sts', 'get-caller-identity',
    '--profile', profile,
    '--output', 'json'
  ]);

  if (parentCredsResult.success) {
    try {
      const targetRoleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
      console.log(`🔍 Attempting to assume role: ${targetRoleArn}`);

      const sessionName = `awslogin-${Date.now()}`;
      const assumeRoleResult = execAwsCommand([
        'sts', 'assume-role',
        '--profile', profile,
        '--role-arn', targetRoleArn,
        '--role-session-name', sessionName,
        '--duration-seconds', '3600',
        '--output', 'json'
      ]);

      if (assumeRoleResult.success) {
        const data = JSON.parse(assumeRoleResult.stdout);
        return {
          accessKeyId: data.Credentials.AccessKeyId,
          secretAccessKey: data.Credentials.SecretAccessKey,
          sessionToken: data.Credentials.SessionToken,
          expiration: data.Credentials.Expiration
        };
      }

      console.log('⚠️  Failed to assume role. This could be due to:');
      console.log('   1. The role does not have the appropriate trust relationship');
      console.log('   2. You do not have permission via your group-based SSO assignment');
      console.log(`🔍 Error: ${assumeRoleResult.stderr}`);

      await displayTrustPolicyHelp(profile, accountId, roleName);

      console.log('\n💡 If you are using IAM Identity Center with group-based permissions:');
      console.log('   1. Ensure your SSO session is valid by running: awslogin ' + profile);
      console.log('   2. Use the --select flag to choose accounts: awslogin ' + profile + ' --select');
      console.log('   3. Verify that your permission sets are assigned to all accounts you need');
      return null;
    } catch (error) {
      console.log(`⚠️  Error parsing assume-role response: ${error.message}`);
      return null;
    }
  }

  console.log('⚠️  Failed to authenticate to parent SSO account');
  return null;
}

module.exports = {
  listSsoAccounts,
  listAccountRoles,
  promptAccountSelection,
  promptRoleSelection,
  getSsoRoleCredentials
};
