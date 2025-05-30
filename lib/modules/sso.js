// SSO Module
// Handles AWS Single Sign-On operations

const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');
const { displayTrustPolicyHelp } = require('./utils');

// Function to list available accounts for SSO profiles
async function listSsoAccounts(profile) {
  console.log('🔍 Retrieving available SSO accounts...');
  
  const accountsResult = execAwsCommand(['sso', 'list-accounts', '--profile', profile, '--output', 'json']);
  
  if (!accountsResult.success) {
    console.log('⚠️  Failed to list SSO accounts directly');
    console.log('🔍 This may be because you have permissions via a group-based assignment');
    console.log('🔍 Attempting to retrieve accounts from organization structure...');
    
    // Try to get accounts from the organization structure
    const orgsAccountsResult = execAwsCommand(['organizations', 'list-accounts', '--profile', profile, '--output', 'json']);
    
    if (orgsAccountsResult.success) {
      try {
        const orgsData = JSON.parse(orgsAccountsResult.stdout);
        const activeAccounts = orgsData.Accounts.filter(acc => acc.Status === 'ACTIVE');
        
        if (activeAccounts.length > 0) {
          console.log(`✅ Found ${activeAccounts.length} active accounts in your organization`);
          
          // Transform to same format as SSO account list
          return activeAccounts.map(acc => ({
            accountId: acc.Id,
            accountName: acc.Name,
            emailAddress: acc.Email
          }));
        }
      } catch (e) {
        console.log(`⚠️  Error parsing organization accounts: ${e.message}`);
      }
    }
    
    console.log('❌ Unable to retrieve accounts list from any source');
    return null;
  }
  
  try {
    const data = JSON.parse(accountsResult.stdout);
    return data.accountList || [];
  } catch (e) {
    console.log('⚠️  Failed to parse SSO accounts response');
    return null;
  }
}

// Function to list available roles for a specific account
async function listAccountRoles(profile, accountId) {
  console.log(`🔍 Retrieving available roles for account ${accountId}...`);
  
  const rolesResult = execAwsCommand(['sso', 'list-account-roles', '--profile', profile, '--account-id', accountId, '--output', 'json']);
  
  if (!rolesResult.success) {
    console.log('⚠️  Failed to list account roles directly');
    console.log('🔍 This may be because you have permissions via a group-based assignment');
    console.log('🔍 Attempting to discover common roles based on IAM Identity Center setup...');
    
    // Try to check if there's a default configuration with common roles
    // This is useful when permissions are assigned through groups in IAM Identity Center
    const commonRoles = [
      { roleName: 'AdministratorAccess', displayName: 'Administrator Access' },
      { roleName: 'PowerUserAccess', displayName: 'Power User Access' },
      { roleName: 'ReadOnlyAccess', displayName: 'Read Only Access' },
      { roleName: 'AWSAdministratorAccess', displayName: 'AWS Administrator Access' },
      { roleName: 'AWSPowerUserAccess', displayName: 'AWS Power User Access' },
      { roleName: 'AWSReadOnlyAccess', displayName: 'AWS Read Only Access' }
    ];
    
    // Check if we can get a valid identity from the main profile
    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile, '--output', 'json']);
    
    if (identityResult.success) {
      console.log('✅ Authenticated to main profile. Testing common roles for the target account...');
      console.log('ℹ️  If you are part of an IAM Identity Center group with access to multiple accounts,');
      console.log('   you should have the same role permissions across accounts.');
      
      // Return the list of common roles - the actual validation will happen when getting credentials
      return commonRoles;
    }
    
    console.log('❌ Unable to retrieve roles for this account');
    return null;
  }
  
  try {
    const data = JSON.parse(rolesResult.stdout);
    return data.roleList || [];
  } catch (e) {
    console.log('⚠️  Failed to parse account roles response');
    return null;
  }
}

// Function to prompt user for account selection
async function promptAccountSelection(accounts) {
  console.log('\n📋 Available AWS accounts:');
  
  accounts.forEach((account, index) => {
    const accountName = account.accountName || 'Unnamed Account';
    console.log(`   ${index + 1}. ${accountName} (${account.accountId})`);
  });
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    const askForSelection = () => {
      rl.question('\nSelect an account (enter number): ', (selection) => {
        const index = parseInt(selection) - 1;
        
        if (!isNaN(index) && index >= 0 && index < accounts.length) {
          rl.close();
          resolve(accounts[index]);
        } else {
          console.log('⚠️  Invalid selection, please try again');
          askForSelection();
        }
      });
    };
    
    askForSelection();
  });
}

// Function to prompt user for role selection
async function promptRoleSelection(roles) {
  console.log('\n📋 Available roles:');
  
  roles.forEach((role, index) => {
    console.log(`   ${index + 1}. ${role.roleName}`);
  });
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    const askForSelection = () => {
      rl.question('\nSelect a role (enter number): ', (selection) => {
        const index = parseInt(selection) - 1;
        
        if (!isNaN(index) && index >= 0 && index < roles.length) {
          rl.close();
          resolve(roles[index]);
        } else {
          console.log('⚠️  Invalid selection, please try again');
          askForSelection();
        }
      });
    };
    
    askForSelection();
  });
}

// Function to get role credentials for SSO
async function getSsoRoleCredentials(profile, accountId, roleName) {
  console.log(`🔐 Getting credentials for role ${roleName} in account ${accountId}...`);
  
  // Create a temporary profile that inherits SSO settings from parent
  const tempProfileName = `temp-${accountId}-${roleName}-${Date.now()}`;
  
  // Get SSO configuration from parent profile
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  const ssoRegionResult = execAwsCommand(['configure', 'get', 'sso_region', '--profile', profile]);
  
  if (ssoSessionResult.success || ssoStartUrlResult.success) {
    console.log(`🔄 Creating temporary profile with parent's SSO configuration`);
    
    // Configure the temporary profile with the parent's SSO settings
    if (ssoSessionResult.success) {
      execAwsCommand(['configure', 'set', 'sso_session', ssoSessionResult.stdout, '--profile', tempProfileName]);
    } else if (ssoStartUrlResult.success) {
      execAwsCommand(['configure', 'set', 'sso_start_url', ssoStartUrlResult.stdout, '--profile', tempProfileName]);
      if (ssoRegionResult.success) {
        execAwsCommand(['configure', 'set', 'sso_region', ssoRegionResult.stdout, '--profile', tempProfileName]);
      }
    }
    
    // Set the specific account and role
    execAwsCommand(['configure', 'set', 'sso_account_id', accountId, '--profile', tempProfileName]);
    execAwsCommand(['configure', 'set', 'sso_role_name', roleName, '--profile', tempProfileName]);
    
    // Copy region from parent profile
    const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
    if (regionResult.success) {
      execAwsCommand(['configure', 'set', 'region', regionResult.stdout, '--profile', tempProfileName]);
    }
    
    // Try to get caller identity without doing SSO login - AWS CLI will use cached SSO token
    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', tempProfileName, '--output', 'json']);
    
    if (identityResult.success) {
      console.log(`✅ Successfully authenticated to account ${accountId} with role ${roleName}`);
      
      // Get the credentials that AWS CLI generated
      const accessKeyResult = execAwsCommand(['configure', 'get', 'aws_access_key_id', '--profile', tempProfileName]);
      const secretKeyResult = execAwsCommand(['configure', 'get', 'aws_secret_access_key', '--profile', tempProfileName]);
      const sessionTokenResult = execAwsCommand(['configure', 'get', 'aws_session_token', '--profile', tempProfileName]);
      
      // Clean up the temporary profile
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
          expiration: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() // Assume 8 hours
        };
      } else {
        console.log('⚠️  Could not retrieve generated credentials from temporary profile');
        return null;
      }
    } else {
      // Clean up on failure
      execAwsCommand(['configure', 'unset', 'sso_session', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_start_url', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_region', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_account_id', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'sso_role_name', '--profile', tempProfileName]);
      execAwsCommand(['configure', 'unset', 'region', '--profile', tempProfileName]);
      
      console.log('⚠️  Failed to get credentials using cached SSO session');
    }
  }
  
  // As a last resort, try the assume-role approach
  console.log('🔄 Attempting alternative method via assume-role...');
  
  // Try to first get credentials for the parent account via SSO
  const parentCredsResult = execAwsCommand([
    'sts', 'get-caller-identity',
    '--profile', profile,
    '--output', 'json'
  ]);
  
  if (parentCredsResult.success) {
    try {
      // If we can authenticate to the parent SSO account, try to assume role in the target account
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
        // Convert to the same format as SSO role credentials
        return {
          accessKeyId: data.Credentials.AccessKeyId,
          secretAccessKey: data.Credentials.SecretAccessKey,
          sessionToken: data.Credentials.SessionToken,
          expiration: data.Credentials.Expiration
        };
      } else {
        console.log('⚠️  Failed to assume role. This could be due to:');
        console.log('   1. The role does not have the appropriate trust relationship');
        console.log('   2. You do not have permission via your group-based SSO assignment');
        console.log(`🔍 Error: ${assumeRoleResult.stderr}`);
        
        // Show detailed help for configuring trust policy
        await displayTrustPolicyHelp(profile, accountId, roleName);
        
        console.log('\n💡 If you are using IAM Identity Center with group-based permissions:');
        console.log('   1. Ensure your SSO session is valid by running: awslogin ' + profile);
        console.log('   2. Use the --select flag to choose accounts: awslogin ' + profile + ' --select');
        console.log('   3. Verify that your permission sets are assigned to all accounts you need');
        return null;
      }
    } catch (e) {
      console.log(`⚠️  Error parsing assume-role response: ${e.message}`);
      return null;
    }
  } else {
    console.log('⚠️  Failed to authenticate to parent SSO account');
    return null;
  }
}

module.exports = {
  listSsoAccounts,
  listAccountRoles,
  promptAccountSelection,
  promptRoleSelection,
  getSsoRoleCredentials
};