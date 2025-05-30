// Profile Configuration Module
// Allows users to configure AWS profiles with enhanced options

const readline = require('readline');
const { execAwsCommand } = require('./awsCommand');
const { commandExists } = require('./utils');
const { exec1PasswordCommand } = require('./onePassword');
const { promptForMfaDevice } = require('./mfa');
const { listSsoAccounts, listAccountRoles } = require('./sso');

// Function to create a readline interface for prompts
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Function to prompt for yes/no questions
async function promptYesNo(question, defaultYes = true) {
  const rl = createReadlineInterface();
  const defaultText = defaultYes ? 'Y/n' : 'y/N';
  
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultText}]: `, (answer) => {
      rl.close();
      if (answer === '') {
        return resolve(defaultYes);
      }
      return resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

// Function to prompt for a selection from a list
async function promptSelection(options, message) {
  const rl = createReadlineInterface();
  
  console.log(message);
  options.forEach((option, index) => {
    console.log(`   ${index + 1}. ${option.name}`);
  });
  
  return new Promise((resolve) => {
    const askForSelection = () => {
      rl.question('\nEnter your choice (number): ', (selection) => {
        const index = parseInt(selection) - 1;
        
        if (!isNaN(index) && index >= 0 && index < options.length) {
          rl.close();
          resolve(options[index]);
        } else {
          console.log('⚠️  Invalid selection, please try again');
          askForSelection();
        }
      });
    };
    
    askForSelection();
  });
}

// Function to check for 1Password availability
async function check1PasswordAvailability() {
  if (!commandExists('op')) {
    console.log('⚠️  1Password CLI is not installed.');
    console.log('ℹ️  To enable 1Password integration, install the 1Password CLI:');
    console.log('   https://1password.com/downloads/command-line/');
    return false;
  }
  
  // Check if 1Password CLI is authenticated
  const versionResult = exec1PasswordCommand(['--version']);
  if (!versionResult.success) {
    console.log('⚠️  1Password CLI is installed but not working properly.');
    console.log(`   Error: ${versionResult.stderr || 'Unknown error'}`);
    return false;
  }
  
  // Check if we can list items (confirms authentication)
  const listResult = exec1PasswordCommand(['vault', 'list']);
  if (!listResult.success) {
    console.log('⚠️  1Password CLI is installed but not authenticated.');
    console.log('ℹ️  Please run `op signin` to authenticate with 1Password.');
    return false;
  }
  
  console.log('✅ 1Password CLI is installed and authenticated.');
  return true;
}

// Function to configure 1Password integration for a profile
async function configure1PasswordIntegration(profile) {
  console.log('\n🔐 Configuring 1Password Integration');
  console.log('=====================================');
  
  const has1Password = await check1PasswordAvailability();
  
  if (!has1Password) {
    const installMessage = 'Would you like to enable 1Password integration anyway? (You will need to install it later)';
    const enableAnyway = await promptYesNo(installMessage, false);
    
    if (!enableAnyway) {
      console.log('ℹ️  Skipping 1Password integration setup.');
      // Remove any existing 1Password settings for this profile
      execAwsCommand(['configure', 'unset', 'aws_1password_mfa', '--profile', profile]);
      return false;
    }
  }
  
  // Enable 1Password MFA integration
  console.log('\nℹ️  1Password can automatically supply MFA tokens for AWS authentication.');
  const enableMfa = await promptYesNo('Enable 1Password MFA integration?', true);
  
  if (enableMfa) {
    execAwsCommand(['configure', 'set', 'aws_1password_mfa', 'true', '--profile', profile]);
    console.log('✅ 1Password MFA integration enabled for this profile.');
    
    // If 1Password CLI is available, let's try to search for matching items
    if (has1Password) {
      const baseProfile = profile.endsWith('-long-term') 
        ? profile.replace('-long-term', '') 
        : profile;
        
      console.log(`\n🔍 Looking for AWS entries in 1Password matching "${baseProfile}"...`);
      
      // Search for items in 1Password
      const searchResult = exec1PasswordCommand(['item', 'list', '--format', 'json']);
      
      if (searchResult.success) {
        try {
          const items = JSON.parse(searchResult.stdout);
          
          // Filter for AWS-related items that might match our profile
          const awsItems = items.filter(item => {
            const lowerTitle = item.title.toLowerCase();
            const lowerSearchTerm = baseProfile.toLowerCase();
            return (
              (lowerTitle.includes('aws') || lowerTitle.includes('amazon')) && 
              (lowerTitle.includes(lowerSearchTerm) || lowerSearchTerm.includes(lowerTitle.replace(/aws|amazon|-/gi, '').trim()))
            );
          });
          
          if (awsItems.length > 0) {
            console.log(`\n🔍 Found ${awsItems.length} potential matching items in 1Password:`);
            const itemOptions = awsItems.map(item => ({
              name: `${item.title} (${item.id})`,
              id: item.id,
              title: item.title
            }));
            
            // Add an option for manual entry
            itemOptions.push({
              name: "I'll select an item manually during authentication",
              id: null,
              title: null
            });
            
            const selectedOption = await promptSelection(
              itemOptions, 
              '\nWhich 1Password item would you like to use for MFA tokens?'
            );
            
            if (selectedOption.id) {
              console.log(`✅ Setting default 1Password item to: ${selectedOption.title}`);
              execAwsCommand(['configure', 'set', 'aws_1password_item_id', selectedOption.id, '--profile', baseProfile]);
            } else {
              console.log('ℹ️  No default 1Password item set. You will select one during authentication.');
            }
          } else {
            console.log('⚠️  No matching AWS items found in 1Password.');
            console.log('ℹ️  You will need to select an item manually during authentication.');
          }
        } catch (e) {
          console.log('⚠️  Error parsing 1Password search results:', e.message);
        }
      } else {
        console.log('⚠️  Could not search 1Password for AWS items.');
      }
    }
  } else {
    // Remove 1Password settings if disabled
    execAwsCommand(['configure', 'unset', 'aws_1password_mfa', '--profile', profile]);
    execAwsCommand(['configure', 'unset', 'aws_1password_item_id', '--profile', profile]);
    console.log('ℹ️  1Password MFA integration disabled for this profile.');
  }
  
  return enableMfa;
}

// Function to configure MFA settings for a profile
async function configureMfaSettings(profile) {
  console.log('\n🔐 Configuring MFA Settings');
  console.log('=========================');
  
  // Check if this is a long-term profile or has a matching long-term profile
  const isLongTermProfile = profile.endsWith('-long-term');
  const longTermProfile = isLongTermProfile ? profile : `${profile}-long-term`;
  const standardProfile = isLongTermProfile ? profile.replace('-long-term', '') : profile;
  
  // Check if long-term profile exists
  const allProfilesResult = execAwsCommand(['configure', 'list-profiles']);
  const allProfiles = allProfilesResult.success ? allProfilesResult.stdout.split('\n') : [];
  const longTermExists = allProfiles.includes(longTermProfile);
  
  if (!longTermExists && !isLongTermProfile) {
    console.log(`\nℹ️  For MFA authentication, you need a long-term profile with permanent credentials.`);
    console.log(`   This profile should be named: ${longTermProfile}`);
    
    const createLongTerm = await promptYesNo('Would you like to set up a long-term profile now?', false);
    
    if (createLongTerm) {
      console.log(`\n🔄 Setting up long-term profile: ${longTermProfile}`);
      console.log('ℹ️  You will need your permanent AWS credentials (access key and secret key).');
      
      const rl = createReadlineInterface();
      
      try {
        const accessKey = await new Promise(resolve => {
          rl.question('Enter your AWS Access Key ID: ', answer => resolve(answer.trim()));
        });
        
        const secretKey = await new Promise(resolve => {
          rl.question('Enter your AWS Secret Access Key: ', answer => resolve(answer.trim()));
        });
        
        rl.close();
        
        if (accessKey && secretKey) {
          // Create the long-term profile
          execAwsCommand(['configure', 'set', 'aws_access_key_id', accessKey, '--profile', longTermProfile]);
          execAwsCommand(['configure', 'set', 'aws_secret_access_key', secretKey, '--profile', longTermProfile]);
          
          // Copy over region if it's set in the standard profile
          const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', standardProfile]);
          if (regionResult.success && regionResult.stdout) {
            execAwsCommand(['configure', 'set', 'region', regionResult.stdout, '--profile', longTermProfile]);
          }
          
          console.log(`✅ Created long-term profile: ${longTermProfile}`);
          
          // Prompt for MFA device
          await promptForMfaDevice(longTermProfile);
        } else {
          console.log('⚠️  Access key or secret key not provided. Long-term profile not created.');
        }
      } catch (e) {
        console.log(`⚠️  Error setting up long-term profile: ${e.message}`);
        rl.close();
      }
    } else {
      console.log('ℹ️  Skipping long-term profile setup.');
    }
  } else if (isLongTermProfile) {
    // If this is already a long-term profile, prompt for MFA device
    console.log('ℹ️  This is a long-term profile. Let\'s configure the MFA device for it.');
    await promptForMfaDevice(profile);
  } else {
    // If long-term profile exists, prompt to update MFA device
    console.log(`ℹ️  A long-term profile (${longTermProfile}) already exists for this profile.`);
    const updateMfa = await promptYesNo('Would you like to update the MFA device for it?');
    
    if (updateMfa) {
      await promptForMfaDevice(longTermProfile);
    }
  }
  
  return true;
}

// Function to configure advanced options
async function configureAdvancedOptions(profile) {
  console.log('\n⚙️  Configuring Advanced Options');
  console.log('=============================');
  
  // Configure default region
  const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
  const currentRegion = regionResult.success ? regionResult.stdout : '';
  
  console.log(`\nℹ️  Current default region: ${currentRegion || 'Not set'}`);
  
  const regionOptions = [
    { name: 'us-east-1 (N. Virginia)', value: 'us-east-1' },
    { name: 'us-east-2 (Ohio)', value: 'us-east-2' },
    { name: 'us-west-1 (N. California)', value: 'us-west-1' },
    { name: 'us-west-2 (Oregon)', value: 'us-west-2' },
    { name: 'eu-west-1 (Ireland)', value: 'eu-west-1' },
    { name: 'eu-central-1 (Frankfurt)', value: 'eu-central-1' },
    { name: 'ap-northeast-1 (Tokyo)', value: 'ap-northeast-1' },
    { name: 'ap-southeast-1 (Singapore)', value: 'ap-southeast-1' },
    { name: 'ap-southeast-2 (Sydney)', value: 'ap-southeast-2' },
    { name: 'sa-east-1 (São Paulo)', value: 'sa-east-1' },
    { name: 'Keep current setting', value: currentRegion }
  ];
  
  const changeRegion = await promptYesNo('Would you like to change the default region?', false);
  
  if (changeRegion) {
    const selectedRegion = await promptSelection(
      regionOptions,
      '\nSelect a default region:'
    );
    
    if (selectedRegion.value && selectedRegion.value !== 'Keep current setting') {
      execAwsCommand(['configure', 'set', 'region', selectedRegion.value, '--profile', profile]);
      console.log(`✅ Default region set to: ${selectedRegion.value}`);
    }
  }
  
  // Configure output format
  const outputResult = execAwsCommand(['configure', 'get', 'output', '--profile', profile]);
  const currentOutput = outputResult.success ? outputResult.stdout : '';
  
  console.log(`\nℹ️  Current output format: ${currentOutput || 'Not set'}`);
  
  const outputOptions = [
    { name: 'json - Output in JSON format', value: 'json' },
    { name: 'yaml - Output in YAML format', value: 'yaml' },
    { name: 'text - Output in plain text format', value: 'text' },
    { name: 'table - Output in a tabular format', value: 'table' },
    { name: 'Keep current setting', value: currentOutput }
  ];
  
  const changeOutput = await promptYesNo('Would you like to change the output format?', false);
  
  if (changeOutput) {
    const selectedOutput = await promptSelection(
      outputOptions,
      '\nSelect an output format:'
    );
    
    if (selectedOutput.value && selectedOutput.value !== 'Keep current setting') {
      execAwsCommand(['configure', 'set', 'output', selectedOutput.value, '--profile', profile]);
      console.log(`✅ Output format set to: ${selectedOutput.value}`);
    }
  }
  
  return true;
}

// Main function to configure an AWS profile
async function configureProfile(profile) {
  console.log('\n🔧 AWS Profile Configuration Wizard');
  console.log('=================================');
  console.log(`\nConfiguring profile: ${profile}`);
  
  // Check if the profile exists
  const allProfilesResult = execAwsCommand(['configure', 'list-profiles']);
  
  if (!allProfilesResult.success) {
    console.log('❌ Failed to list AWS profiles');
    return false;
  }
  
  const allProfiles = allProfilesResult.stdout.split('\n');
  
  if (!allProfiles.includes(profile)) {
    console.log(`❌ Profile ${profile} not found`);
    const createNew = await promptYesNo(`Would you like to create the profile ${profile}?`);
    
    if (!createNew) {
      return false;
    }
    
    console.log(`\n🔄 Creating new profile: ${profile}`);
  } else {
    console.log('✅ Profile exists in AWS configuration');
  }
  
  // Determine profile type
  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);
  
  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';
  
  let profileType = 'unknown';
  
  if (ssoSession || ssoStartUrl) {
    profileType = 'sso';
    console.log('ℹ️  Profile type: SSO (Single Sign-On)');
  } else if (profile.endsWith('-long-term')) {
    profileType = 'long-term';
    console.log('ℹ️  Profile type: Long-term (with permanent credentials)');
  } else {
    // Check if there's a matching long-term profile
    const longTermProfile = `${profile}-long-term`;
    if (allProfiles.includes(longTermProfile)) {
      profileType = 'mfa';
      console.log('ℹ️  Profile type: MFA (with matching long-term profile)');
    } else {
      profileType = 'direct';
      console.log('ℹ️  Profile type: Direct (with permanent credentials)');
    }
  }
  
  // Configuration menu
  const configOptions = [
    { name: '1Password Integration', handler: configure1PasswordIntegration },
    { name: 'MFA Settings', handler: configureMfaSettings },
    { name: 'Advanced Options (Region, Output Format)', handler: configureAdvancedOptions },
    { name: 'Exit Configuration', handler: null }
  ];
  
  let continuing = true;
  while (continuing) {
    const selectedOption = await promptSelection(
      configOptions,
      '\nWhat would you like to configure?'
    );
    
    if (selectedOption.handler) {
      await selectedOption.handler(profile);
    } else {
      continuing = false;
    }
  }
  
  console.log('\n✅ Profile configuration complete!');
  console.log(`You can now use the profile with: awslogin ${profile}`);
  
  return true;
}

// Function to configure profiles for all AWS organization accounts
async function configureAllOrgProfiles(profile) {
  console.log('\n🏢 AWS Organization Profiles Configuration');
  console.log('======================================');
  console.log(`\nConfiguring profiles for all accounts using base profile: ${profile}`);
  
  // Check if the profile exists
  const allProfilesResult = execAwsCommand(['configure', 'list-profiles']);
  
  if (!allProfilesResult.success) {
    console.log('❌ Failed to list AWS profiles');
    return false;
  }
  
  const allProfiles = allProfilesResult.stdout.split('\n');
  
  if (!allProfiles.includes(profile)) {
    console.log(`❌ Profile ${profile} not found`);
    return false;
  }
  
  // First authenticate with the base profile
  console.log(`\n🔑 Logging in to base profile: ${profile}`);
  const ssoLoginResult = execAwsCommand(['sso', 'login', '--profile', profile], { stdio: 'inherit' });
  
  if (!ssoLoginResult.success) {
    console.log('❌ Failed to authenticate with base profile');
    return false;
  }
  
  // Get list of AWS accounts
  console.log('\n🔍 Retrieving all AWS accounts in the organization...');
  const accounts = await listSsoAccounts(profile);
  
  if (!accounts || accounts.length === 0) {
    console.log('❌ No AWS accounts found or unable to list accounts');
    return false;
  }
  
  console.log(`✅ Found ${accounts.length} accounts in the organization`);
  
  // Create profiles for each account
  let createdProfiles = 0;
  
  for (const account of accounts) {
    const accountName = account.accountName;
    const accountId = account.accountId;
    
    console.log(`\n📝 Processing account: ${accountName} (${accountId})`);
    
    // Get available roles for this account
    const roles = await listAccountRoles(profile, accountId);
    
    if (!roles || roles.length === 0) {
      console.log(`⚠️  No roles available for account: ${accountName}`);
      continue;
    }
    
    console.log(`✅ Found ${roles.length} roles for account: ${accountName}`);
    
    // For each role, create a profile with the naming convention [profile main_profile-account_name]
    for (const role of roles) {
      const roleName = role.roleName;
      
      // Create a standardized account name slug
      const accountNameSlug = accountName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      
      // Create profile name in the format: [profile main_profile-account_name]
      const profileName = `${profile}-${accountNameSlug}`;
      
      console.log(`\n🔄 Creating profile: ${profileName} for role: ${roleName}`);
      
      // Configure the profile with SSO settings
      execAwsCommand(['configure', 'set', 'sso_session', profile, '--profile', profileName]);
      execAwsCommand(['configure', 'set', 'sso_account_id', accountId, '--profile', profileName]);
      execAwsCommand(['configure', 'set', 'sso_role_name', roleName, '--profile', profileName]);
      
      // Copy region from original profile
      const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
      if (regionResult.success) {
        execAwsCommand(['configure', 'set', 'region', regionResult.stdout, '--profile', profileName]);
      } else {
        // Default to us-east-1 if no region is specified
        execAwsCommand(['configure', 'set', 'region', 'us-east-1', '--profile', profileName]);
      }
      
      // Store metadata about the account and role
      execAwsCommand(['configure', 'set', 'parent_profile', profile, '--profile', profileName]);
      execAwsCommand(['configure', 'set', 'account_id', accountId, '--profile', profileName]);
      execAwsCommand(['configure', 'set', 'account_name', accountName, '--profile', profileName]);
      execAwsCommand(['configure', 'set', 'role_name', roleName, '--profile', profileName]);
      
      console.log(`✅ Successfully created profile: ${profileName}`);
      createdProfiles++;
      
      // Only create one profile per account (for the first role found)
      break;
    }
  }
  
  console.log(`\n🎉 Profile configuration complete!`);
  console.log(`✅ Created ${createdProfiles} profiles for AWS organization accounts`);
  console.log(`\n💡 You can now use the profiles with: aws --profile ${profile}-<account-name> <command>`);
  console.log(`💡 Or authenticate with: awslogin ${profile}-<account-name>`);
  
  return true;
}

module.exports = {
  configureProfile,
  configureAllOrgProfiles,
  check1PasswordAvailability,
  configure1PasswordIntegration,
  configureMfaSettings,
  configureAdvancedOptions
};