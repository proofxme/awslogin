// SSO Module
// Handles AWS Single Sign-On operations

const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');

// Function to list available accounts for SSO profiles
async function listSsoAccounts(profile) {
  console.log('🔍 Retrieving available SSO accounts...');
  
  const accountsResult = execAwsCommand(['sso', 'list-accounts', '--profile', profile, '--output', 'json']);
  
  if (!accountsResult.success) {
    console.log('⚠️  Failed to list SSO accounts');
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
    console.log('⚠️  Failed to list account roles');
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
  
  const credentialsResult = execAwsCommand([
    'sso', 'get-role-credentials',
    '--profile', profile,
    '--account-id', accountId,
    '--role-name', roleName,
    '--output', 'json'
  ]);
  
  if (!credentialsResult.success) {
    console.log('⚠️  Failed to get role credentials');
    return null;
  }
  
  try {
    const data = JSON.parse(credentialsResult.stdout);
    return data.roleCredentials;
  } catch (e) {
    console.log('⚠️  Failed to parse role credentials response');
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