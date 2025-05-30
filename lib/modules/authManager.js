// Authentication Manager Module
// Manages different authentication strategies for AWS profiles

const { execAwsCommand } = require('./awsCommand');
const { checkCredentialsExpired } = require('./utils');
const { 
  listSsoAccounts, 
  listAccountRoles, 
  promptAccountSelection, 
  promptRoleSelection, 
  getSsoRoleCredentials 
} = require('./sso');
const { promptForMfaDevice } = require('./mfa');
const { getMfaTokenFrom1Password } = require('./onePassword');
const readline = require('readline');
async function promptYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

// Function to handle SSO authentication
async function handleSsoAuth(profile, selectAccount, allProfiles, forceChange = false) {
  // If using --select, check if we already have a valid sub-profile with credentials
  if (selectAccount && !forceChange) {
    // Look for existing sub-profiles that match this parent profile
    const matchingSubProfiles = allProfiles.filter(p => {
      const parentProfileResult = execAwsCommand(['configure', 'get', 'parent_profile', '--profile', p]);
      return parentProfileResult.success && parentProfileResult.stdout === profile;
    });
    
    if (matchingSubProfiles.length > 0) {
      console.log(`🔍 Found existing sub-profiles for ${profile}:`);
      matchingSubProfiles.forEach((subProfile, index) => {
        const accountIdResult = execAwsCommand(['configure', 'get', 'account_id', '--profile', subProfile]);
        const roleNameResult = execAwsCommand(['configure', 'get', 'role_name', '--profile', subProfile]);
        const accountId = accountIdResult.success ? accountIdResult.stdout : 'Unknown';
        const roleName = roleNameResult.success ? roleNameResult.stdout : 'Unknown';
        
        console.log(`   ${index + 1}. ${subProfile} - Account: ${accountId}, Role: ${roleName}`);
      });
      
      // If we're doing a forced change, we'll always prompt for account selection
      if (forceChange) {
        console.log('\n🔄 Forcing account selection as requested with --change flag');
      } else {
        // Check if any of these profiles have valid credentials
        let validProfile = null;
        for (const subProfile of matchingSubProfiles) {
          if (!checkCredentialsExpired(subProfile)) {
            validProfile = subProfile;
            break;
          }
        }
        
        if (validProfile) {
          console.log(`\n✅ Found valid credentials in sub-profile: ${validProfile}`);
          console.log(`💡 Using existing credentials (use awslogin ${profile} --change to select a different account)\n`);
          
          // Display identity info for the valid sub-profile
          execAwsCommand(['sts', 'get-caller-identity', '--profile', validProfile], { stdio: 'inherit' });
          return validProfile;
        } else {
          console.log(`\n⚠️  All existing sub-profiles have expired credentials. Refreshing from parent SSO session...`);
        }
      }
    }
  }
  
  // Check if SSO session is already valid before attempting login
  const { isSessionValid } = require('./utils');
  const sessionValid = isSessionValid(profile);
  
  let ssoLoginResult = { success: sessionValid };
  
  if (!sessionValid) {
    console.log(`🔐 Authenticating with AWS SSO for profile: ${profile}`);
    
    // Check for browser-based SSO with sso_session
    const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
    const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
    
    if (ssoSession) {
      console.log(`🌐 Using browser-based SSO authentication with session: ${ssoSession}`);
    }
    
    ssoLoginResult = execAwsCommand(['sso', 'login', '--profile', profile], { stdio: 'inherit' });
  } else {
    console.log(`✅ SSO session for profile ${profile} is already valid`);
  }
  
  if (ssoLoginResult.success) {
    // If --select or --change flag is provided, proceed with account selection
    if (selectAccount || forceChange) {
      // Check if the profile already has fixed account_id and role_name
      const configuredAccountIdResult = execAwsCommand(['configure', 'get', 'sso_account_id', '--profile', profile]);
      const configuredRoleNameResult = execAwsCommand(['configure', 'get', 'sso_role_name', '--profile', profile]);
      
      const configuredAccountId = configuredAccountIdResult.success ? configuredAccountIdResult.stdout : null;
      const configuredRoleName = configuredRoleNameResult.success ? configuredRoleNameResult.stdout : null;
      
      let selectedAccount, selectedRole;
      
      // If the profile is already configured with a specific account and role
      if (configuredAccountId && configuredRoleName && !forceChange) {
        console.log(`\n🔍 Profile ${profile} is configured with a specific account ID and role`);
        console.log(`   Account ID: ${configuredAccountId}`);
        console.log(`   Role Name: ${configuredRoleName}`);
        
        const proceedWithConfigured = await promptYesNo(`Do you want to proceed with the configured account and role? (y/n)`);
        
        if (proceedWithConfigured) {
          selectedAccount = { accountId: configuredAccountId, accountName: 'Configured Account' };
          selectedRole = { roleName: configuredRoleName };
          console.log(`\n✅ Using configured account: ${configuredAccountId}`);
          console.log(`✅ Using configured role: ${configuredRoleName}`);
        } else {
          console.log(`\n🔍 Retrieving available accounts for selection...`);
          const accounts = await listSsoAccounts(profile);
          
          if (!accounts || accounts.length === 0) {
            console.log("⚠️  No accounts available for selection");
            // Fallback to configured account and role
            console.log(`\n🔄 Falling back to configured account and role`);
            selectedAccount = { accountId: configuredAccountId, accountName: 'Configured Account' };
            selectedRole = { roleName: configuredRoleName };
          } else {
            // Prompt for account selection
            selectedAccount = await promptAccountSelection(accounts);
            console.log(`\n✅ Selected account: ${selectedAccount.accountName} (${selectedAccount.accountId})`);
            
            // Get roles for the selected account
            const roles = await listAccountRoles(profile, selectedAccount.accountId);
            
            if (!roles || roles.length === 0) {
              console.log("⚠️  No roles available for the selected account");
              return null;
            }
            
            // Prompt for role selection
            selectedRole = await promptRoleSelection(roles);
            console.log(`✅ Selected role: ${selectedRole.roleName}`);
          }
        }
      } else {
        // Original flow for profiles without fixed account_id and role_name
        const accounts = await listSsoAccounts(profile);
        
        if (!accounts || accounts.length === 0) {
          console.log("⚠️  No accounts available for selection");
          return null;
        }
        
        // Prompt for account selection
        selectedAccount = await promptAccountSelection(accounts);
        console.log(`\n✅ Selected account: ${selectedAccount.accountName} (${selectedAccount.accountId})`);
        
        // Get roles for the selected account
        const roles = await listAccountRoles(profile, selectedAccount.accountId);
        
        if (!roles || roles.length === 0) {
          console.log("⚠️  No roles available for the selected account");
          return null;
        }
        
        // Prompt for role selection
        selectedRole = await promptRoleSelection(roles);
        console.log(`✅ Selected role: ${selectedRole.roleName}`);
      }
      
      // Get credentials for the selected role
      const roleCredentials = await getSsoRoleCredentials(profile, selectedAccount.accountId, selectedRole.roleName);
      
      if (!roleCredentials) {
        console.log("⚠️  Failed to get credentials for the selected role");
        return null;
      }
      
      // Create a sub-profile name with the format [profile main_profile-account_name]
      const accountNameSlug = selectedAccount.accountName.toLowerCase().replace(/\s+/g, '-');
      const subProfileName = `${profile}-${accountNameSlug}`;
      
      console.log(`\n🔄 Creating sub-profile: ${subProfileName}`);
      
      // Store the credentials in the sub-profile
      execAwsCommand(['configure', 'set', 'aws_access_key_id', roleCredentials.accessKeyId, '--profile', subProfileName]);
      execAwsCommand(['configure', 'set', 'aws_secret_access_key', roleCredentials.secretAccessKey, '--profile', subProfileName]);
      execAwsCommand(['configure', 'set', 'aws_session_token', roleCredentials.sessionToken, '--profile', subProfileName]);
      
      // Store the expiration time
      const expirationTime = new Date(roleCredentials.expiration);
      execAwsCommand(['configure', 'set', 'aws_session_expiration', expirationTime.toISOString(), '--profile', subProfileName]);
      
      // Copy region from parent profile if available
      const regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
      if (regionResult.success) {
        execAwsCommand(['configure', 'set', 'region', regionResult.stdout, '--profile', subProfileName]);
      }
      
      // Store metadata about the selection
      execAwsCommand(['configure', 'set', 'parent_profile', profile, '--profile', subProfileName]);
      execAwsCommand(['configure', 'set', 'account_id', selectedAccount.accountId, '--profile', subProfileName]);
      execAwsCommand(['configure', 'set', 'role_name', selectedRole.roleName, '--profile', subProfileName]);
      
      console.log(`✅ Successfully created sub-profile: ${subProfileName}`);
      console.log(`\n💡 You can now use the sub-profile with: aws --profile ${subProfileName} <command>`);
      
      // Display identity info for the sub-profile
      execAwsCommand(['sts', 'get-caller-identity', '--profile', subProfileName], { stdio: 'inherit' });
      return subProfileName;
    } else {
      const validateResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
      
      if (validateResult.success) {
        console.log(`✅ Successfully authenticated with AWS SSO for profile: ${profile}`);
        // Display identity info
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        return profile;
      } else {
        console.log("⚠️  Authentication succeeded but credentials validation failed");
        return null;
      }
    }
  } else {
    console.log(`❌ Failed to authenticate with AWS SSO for profile: ${profile}`);
    return null;
  }
}

// Function to handle MFA authentication
async function handleMfaAuth(profile, longTermProfile, mfaToken) {
  // Check for MFA serial
  let mfaSerialResult = execAwsCommand(['configure', 'get', 'aws_mfa_device', '--profile', longTermProfile]);
  let mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
  
  if (!mfaSerial) {
    mfaSerialResult = execAwsCommand(['configure', 'get', 'mfa_serial', '--profile', longTermProfile]);
    mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
  }
  
  // If MFA serial not found, prompt user to input it
  if (!mfaSerial) {
    console.log(`⚠️ No MFA device configured for profile ${longTermProfile}`);
    mfaSerial = await promptForMfaDevice(longTermProfile);
  }
  
  if (!mfaSerial) {
    return null;
  }
  
  console.log(`🔐 Attempting MFA authentication for profile: ${profile}`);
  console.log(`🔍 MFA serial being used: ${mfaSerial}`);
  
  // Check if the long-term profile has a region configured, which is required for MFA
  let regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', longTermProfile]);
  let region = regionResult.success ? regionResult.stdout : '';
  
  if (!region) {
    // Try to get region from standard profile
    regionResult = execAwsCommand(['configure', 'get', 'region', '--profile', profile]);
    region = regionResult.success ? regionResult.stdout : '';
    
    if (region) {
      console.log(`🔍 No region found in long-term profile, using region from standard profile: ${region}`);
      // Ensure long-term profile has the region set
      execAwsCommand(['configure', 'set', 'region', region, '--profile', longTermProfile]);
    } else {
      console.log(`⚠️ No region configured for profile: ${longTermProfile} (required for MFA)`);
      console.log(`🔍 Setting default region to us-east-1`);
      // Set a default region as fallback
      execAwsCommand(['configure', 'set', 'region', 'us-east-1', '--profile', longTermProfile]);
      region = 'us-east-1';
    }
  } else {
    console.log(`🔍 Using region from long-term profile: ${region}`);
  }
  
  // Check if MFA token was provided as command-line argument
  let onePasswordToken = null;
  if (mfaToken) {
    console.log(`🔍 Using MFA token provided via command line`);
    onePasswordToken = mfaToken;
  } else {
    // Try to get MFA token from 1Password first
    onePasswordToken = await getMfaTokenFrom1Password(longTermProfile);
  }
  
  // Check if the long-term profile has an assume_role configured
  const assumeRoleResult = execAwsCommand(['configure', 'get', 'assume_role', '--profile', longTermProfile]);
  const assumeRole = assumeRoleResult.success ? assumeRoleResult.stdout : '';
  
  // Process for getting and validating the token
  const processToken = async (tokenCode) => {
    let credsJson;
    
    if (assumeRole) {
      // If we have a role to assume, use sts assume-role with MFA
      const sessionName = `awslogin-${Date.now()}`;
      const assumeRoleTokenResult = execAwsCommand([
        'sts', 'assume-role',
        '--profile', longTermProfile,
        '--role-arn', assumeRole,
        '--role-session-name', sessionName,
        '--serial-number', mfaSerial,
        '--token-code', tokenCode,
        '--duration-seconds', '28800',
        '--output', 'json'
      ]);
      
      if (!assumeRoleTokenResult.success) {
        console.log("⚠️  Failed to assume role with MFA");
        if (assumeRoleTokenResult.stderr) {
          console.log(`🔍 AWS error: ${assumeRoleTokenResult.stderr}`);
        }
        return false;
      }
      
      credsJson = JSON.parse(assumeRoleTokenResult.stdout);
    } else {
      // No role to assume, just get session token with MFA
      const sessionTokenResult = execAwsCommand([
        'sts', 'get-session-token',
        '--profile', longTermProfile,
        '--serial-number', mfaSerial,
        '--token-code', tokenCode,
        '--duration-seconds', '28800',
        '--output', 'json'
      ]);
      
      if (!sessionTokenResult.success) {
        console.log("⚠️  MFA authentication failed: Invalid token or connection error");
        if (sessionTokenResult.stderr) {
          console.log(`🔍 AWS error: ${sessionTokenResult.stderr}`);
        }
        return false;
      }
      
      credsJson = JSON.parse(sessionTokenResult.stdout);
    }
    
    try {
      // Extract credentials from JSON response
      const accessKey = credsJson.Credentials.AccessKeyId;
      const secretKey = credsJson.Credentials.SecretAccessKey;
      const sessionToken = credsJson.Credentials.SessionToken;
      const expiration = credsJson.Credentials.Expiration; // ISO format timestamp
      
      // Store credentials in the main profile
      execAwsCommand(['configure', 'set', 'aws_access_key_id', accessKey, '--profile', profile]);
      execAwsCommand(['configure', 'set', 'aws_secret_access_key', secretKey, '--profile', profile]);
      execAwsCommand(['configure', 'set', 'aws_session_token', sessionToken, '--profile', profile]);
      execAwsCommand(['configure', 'set', 'aws_session_expiration', expiration, '--profile', profile]);
      
      // Mark profile as using 1Password
      if (onePasswordToken) {
        execAwsCommand(['configure', 'set', 'aws_1password_mfa', 'true', '--profile', profile]);
      }
      
      // Verify the credentials work
      const verifyResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
      
      if (verifyResult.success) {
        console.log(`✅ Successfully authenticated with MFA for profile: ${profile}`);
        // Display identity info
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        return true;
      } else {
        console.log("⚠️  MFA authentication failed: Credentials validation error");
        console.log(`🔍 DEBUG: Verification error: ${verifyResult.stderr}`);
        return false;
      }
    } catch (error) {
      console.log(`⚠️  MFA authentication failed: ${error.message}`);
      return false;
    }
  };
  
  // If we got a token from 1Password, use it
  if (onePasswordToken) {
    const success = await processToken(onePasswordToken);
    if (success) {
      return profile;
    }
    // If 1Password token failed, fall back to manual entry
    console.log("⚠️  1Password MFA token failed, falling back to manual entry");
  }
  
  // Prompt for MFA token if 1Password integration failed or is not available
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Enter MFA token: ', async (tokenCode) => {
      const success = await processToken(tokenCode);
      rl.close();
      resolve(success ? profile : null);
    });
  });
}

module.exports = {
  handleSsoAuth,
  handleMfaAuth,
  promptYesNo
};