// IAM Identity Center Module
// Provides functions to help set up and configure AWS IAM Identity Center (SSO)

const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');
const { promptYesNo } = require('./authManager');
const { getSourceIdentityArn } = require('./utils');

// Function to set up IAM Identity Center cross-account access
async function setupIdentityCenter(profile) {
  console.log('\n🛠️  AWS IAM Identity Center Setup Helper');
  console.log('===========================================');
  
  // Check if we can authenticate with the profile
  console.log('\n🔍 Checking authentication for profile:', profile);
  const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile, '--output', 'json']);
  
  if (!identityResult.success) {
    console.log('❌ Failed to authenticate with profile. Please run awslogin first.');
    return false;
  }
  
  try {
    const identity = JSON.parse(identityResult.stdout);
    console.log(`✅ Successfully authenticated as: ${identity.Arn}`);
    
    // Check if this profile uses SSO
    const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
    const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
    
    const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : null;
    const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : null;
    
    if (!ssoSession && !ssoStartUrl) {
      console.log('❌ This profile does not appear to be an SSO profile.');
      console.log('   This setup is intended for AWS IAM Identity Center (SSO) users.');
      return false;
    }
    
    // Get AWS Organizations information
    console.log('\n🔍 Checking for AWS Organizations access...');
    const orgsResult = execAwsCommand(['organizations', 'list-accounts', '--profile', profile, '--output', 'json']);
    
    if (!orgsResult.success) {
      console.log('❌ Failed to list AWS Organizations accounts. You need Organizations permissions.');
      console.log('   To use this function, you need permission to access AWS Organizations.');
      return false;
    }
    
    // List available accounts
    const orgAccounts = JSON.parse(orgsResult.stdout).Accounts;
    
    console.log(`\n📋 Found ${orgAccounts.length} accounts in your organization:`);
    orgAccounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.Name} (${account.Id}) - ${account.Status}`);
    });
    
    // Show IAM Identity Center guidance
    console.log('\n📝 IAM Identity Center Cross-Account Access Guide');
    console.log('================================================');
    console.log('\n1. Log in to the AWS Management Console using your SSO access');
    console.log('2. Go to the IAM Identity Center service (formerly AWS SSO)');
    console.log('3. Navigate to "AWS accounts" in the left sidebar');
    console.log('4. You should see all your organization accounts listed');
    console.log('5. For each account you want to access:');
    console.log('   a. Select the account');
    console.log('   b. Click "Assign users" or "Assign groups"');
    console.log('   c. Select your user or group');
    console.log('   d. Choose "Next: Permission sets"');
    console.log('   e. Choose an existing permission set (like AdministratorAccess)');
    console.log('      or create a new one with the permissions you need');
    console.log('   f. Complete the assignment wizard');
    console.log('\n6. Once assignments are complete:');
    console.log('   ✅ awslogin with the --select flag will show these accounts');
    console.log('   ✅ You can select any account where you have SSO permission sets assigned');
    console.log('   ✅ No IAM role trust policy modifications needed');
    
    // Check for existing permission sets
    console.log('\n🔍 Checking for existing IAM Identity Center permission sets...');
    
    // We need SSO admin instance
    const ssoAdminInstanceResult = execAwsCommand([
      'sso-admin', 'list-instances',
      '--profile', profile,
      '--output', 'json'
    ]);
    
    if (ssoAdminInstanceResult.success) {
      try {
        const instances = JSON.parse(ssoAdminInstanceResult.stdout).Instances;
        
        if (instances && instances.length > 0) {
          const instanceArn = instances[0].InstanceArn;
          
          // List permission sets
          const permSetsResult = execAwsCommand([
            'sso-admin', 'list-permission-sets',
            '--instance-arn', instanceArn,
            '--profile', profile,
            '--output', 'json'
          ]);
          
          if (permSetsResult.success) {
            const permSets = JSON.parse(permSetsResult.stdout).PermissionSets;
            
            if (permSets && permSets.length > 0) {
              console.log(`\n📋 Found ${permSets.length} permission sets in your IAM Identity Center:`);
              
              for (let i = 0; i < permSets.length; i++) {
                const permSetArn = permSets[i];
                const descResult = execAwsCommand([
                  'sso-admin', 'describe-permission-set',
                  '--instance-arn', instanceArn,
                  '--permission-set-arn', permSetArn,
                  '--profile', profile,
                  '--output', 'json'
                ]);
                
                if (descResult.success) {
                  const permSetDetails = JSON.parse(descResult.stdout).PermissionSet;
                  console.log(`   ${i + 1}. ${permSetDetails.Name} - ${permSetDetails.Description || 'No description'}`);
                }
              }
              
              console.log('\n✅ You can assign these permission sets to yourself for each account');
            } else {
              console.log('⚠️ No permission sets found. You need to create permission sets in IAM Identity Center.');
            }
          }
        }
      } catch (e) {
        console.log('⚠️ Error checking permission sets:', e.message);
      }
    }
    
    console.log('\n💡 To use cross-account access with AWS CLI:');
    console.log('1. Use our AWS Profile Auth CLI tool:');
    console.log('   $ awslogin your-sso-profile --select');
    console.log('2. Select the desired account and permission set when prompted');
    console.log('3. The tool will create temporary credentials and store them in a named profile');
    
    console.log('\n✅ Setup guide complete!');
    return true;
  } catch (e) {
    console.log('❌ Error during IAM Identity Center setup:', e.message);
    return false;
  }
}

module.exports = {
  setupIdentityCenter
};