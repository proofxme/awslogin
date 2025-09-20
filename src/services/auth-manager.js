'use strict';

const { execAwsCommand } = require('../core/aws');
const { checkCredentialsExpired, isSessionValid } = require('../core/session');
const { askYesNo, askNonEmpty } = require('../core/prompt');
const { slugify } = require('../core/formatters');
const {
  getProfileValue,
  setProfileValue,
  setProfileValues,
  setTemporaryCredentials,
  getRegion,
  setRegion
} = require('./aws-config');
const { listSsoAccounts, listAccountRoles, promptAccountSelection, promptRoleSelection, getSsoRoleCredentials } = require('./sso');
const { promptForMfaDevice } = require('./mfa');
const { getMfaTokenFrom1Password } = require('./onepassword');

async function handleSsoAuth(profile, selectAccount, allProfiles, forceChange = false) {
  if (selectAccount && !forceChange) {
    const matchingSubProfiles = allProfiles.filter(
      (candidate) => getProfileValue(candidate, 'parent_profile') === profile
    );

    if (matchingSubProfiles.length > 0) {
      console.log(`🔍 Found existing sub-profiles for ${profile}:`);
      matchingSubProfiles.forEach((subProfile, index) => {
        const accountId = getProfileValue(subProfile, 'account_id') || 'Unknown';
        const roleName = getProfileValue(subProfile, 'role_name') || 'Unknown';

        console.log(`   ${index + 1}. ${subProfile} - Account: ${accountId}, Role: ${roleName}`);
      });

      if (forceChange) {
        console.log('\n🔄 Forcing account selection as requested with --change flag');
      } else {
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
          execAwsCommand(['sts', 'get-caller-identity', '--profile', validProfile], { stdio: 'inherit' });
          return validProfile;
        }

        console.log('\n⚠️  All existing sub-profiles have expired credentials. Refreshing from parent SSO session...');
      }
    }
  }

  const sessionValid = isSessionValid(profile);
  let ssoLoginResult = { success: sessionValid };

  if (!sessionValid) {
    console.log(`🔐 Authenticating with AWS SSO for profile: ${profile}`);

    const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
    const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';

    if (ssoSession) {
      console.log(`🌐 Using browser-based SSO authentication with session: ${ssoSession}`);
    }

    ssoLoginResult = execAwsCommand(['sso', 'login', '--profile', profile], { stdio: 'inherit' });
  } else {
    console.log(`✅ SSO session for profile ${profile} is already valid`);
  }

  if (!ssoLoginResult.success) {
    console.log(`❌ Failed to authenticate with AWS SSO for profile: ${profile}`);
    return null;
  }

  if (selectAccount || forceChange) {
    const configuredAccountId = getProfileValue(profile, 'sso_account_id');
    const configuredRoleName = getProfileValue(profile, 'sso_role_name');

    let selectedAccount;
    let selectedRole;

    if (configuredAccountId && configuredRoleName && !forceChange) {
      console.log(`\n🔍 Profile ${profile} is configured with a specific account ID and role`);
      console.log(`   Account ID: ${configuredAccountId}`);
      console.log(`   Role Name: ${configuredRoleName}`);

      const proceedWithConfigured = await askYesNo('Do you want to proceed with the configured account and role?', { defaultYes: true });

      if (proceedWithConfigured) {
        selectedAccount = { accountId: configuredAccountId, accountName: 'Configured Account' };
        selectedRole = { roleName: configuredRoleName };
        console.log(`\n✅ Using configured account: ${configuredAccountId}`);
        console.log(`✅ Using configured role: ${configuredRoleName}`);
      } else {
        console.log('\n🔍 Retrieving available accounts for selection...');
        const accounts = await listSsoAccounts(profile);

        if (!accounts || accounts.length === 0) {
          console.log('⚠️  No accounts available for selection');
          console.log('\n🔄 Falling back to configured account and role');
          selectedAccount = { accountId: configuredAccountId, accountName: 'Configured Account' };
          selectedRole = { roleName: configuredRoleName };
        } else {
          selectedAccount = await promptAccountSelection(accounts);
          console.log(`\n✅ Selected account: ${selectedAccount.accountName} (${selectedAccount.accountId})`);

          const roles = await listAccountRoles(profile, selectedAccount.accountId);

          if (!roles || roles.length === 0) {
            console.log('⚠️  No roles available for the selected account');
            return null;
          }

          selectedRole = await promptRoleSelection(roles);
          console.log(`✅ Selected role: ${selectedRole.roleName}`);
        }
      }
    } else {
      const accounts = await listSsoAccounts(profile);

      if (!accounts || accounts.length === 0) {
        console.log('⚠️  No accounts available for selection');
        return null;
      }

      selectedAccount = await promptAccountSelection(accounts);
      console.log(`\n✅ Selected account: ${selectedAccount.accountName} (${selectedAccount.accountId})`);

      const roles = await listAccountRoles(profile, selectedAccount.accountId);

      if (!roles || roles.length === 0) {
        console.log('⚠️  No roles available for the selected account');
        return null;
      }

      selectedRole = await promptRoleSelection(roles);
      console.log(`✅ Selected role: ${selectedRole.roleName}`);
    }

    const roleCredentials = await getSsoRoleCredentials(profile, selectedAccount.accountId, selectedRole.roleName);

    if (!roleCredentials) {
      console.log('⚠️  Failed to get credentials for the selected role');
      return null;
    }

    const accountSlug = slugify(selectedAccount.accountName || selectedAccount.accountId, { fallback: selectedAccount.accountId });
    const subProfileName = `${profile}-${accountSlug}`;

    console.log(`\n🔄 Creating sub-profile: ${subProfileName}`);

    setTemporaryCredentials(subProfileName, roleCredentials);

    const baseRegion = getRegion(profile);
    if (baseRegion) {
      setRegion(subProfileName, baseRegion);
    }

    setProfileValues(subProfileName, [
      { key: 'parent_profile', value: profile },
      { key: 'account_id', value: selectedAccount.accountId },
      { key: 'account_name', value: selectedAccount.accountName },
      { key: 'role_name', value: selectedRole.roleName }
    ]);

    console.log(`✅ Successfully created sub-profile: ${subProfileName}`);
    console.log(`\n💡 You can now use the sub-profile with: aws --profile ${subProfileName} <command>`);

    execAwsCommand(['sts', 'get-caller-identity', '--profile', subProfileName], { stdio: 'inherit' });
    return subProfileName;
  }

  const validateResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);

  if (validateResult.success) {
    console.log(`✅ Successfully authenticated with AWS SSO for profile: ${profile}`);
    execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
    return profile;
  }

  console.log('⚠️  Authentication succeeded but credentials validation failed');
  return null;
}

async function handleMfaAuth(profile, longTermProfile, providedToken) {
  let mfaSerialResult = execAwsCommand(['configure', 'get', 'aws_mfa_device', '--profile', longTermProfile]);
  let mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';

  if (!mfaSerial) {
    mfaSerialResult = execAwsCommand(['configure', 'get', 'mfa_serial', '--profile', longTermProfile]);
    mfaSerial = mfaSerialResult.success ? mfaSerialResult.stdout : '';
  }

  if (!mfaSerial) {
    console.log(`⚠️ No MFA device configured for profile ${longTermProfile}`);
    mfaSerial = await promptForMfaDevice(longTermProfile);
  }

  if (!mfaSerial) {
    return null;
  }

  console.log(`🔐 Attempting MFA authentication for profile: ${profile}`);
  console.log(`🔍 MFA serial being used: ${mfaSerial}`);

  let region = getRegion(longTermProfile);

  if (!region) {
    const fallbackRegion = getRegion(profile);
    if (fallbackRegion) {
      console.log(`🔍 No region found in long-term profile, using region from standard profile: ${fallbackRegion}`);
      setRegion(longTermProfile, fallbackRegion);
      region = fallbackRegion;
    } else {
      console.log(`⚠️ No region configured for profile: ${longTermProfile} (required for MFA)`);
      console.log('🔍 Setting default region to us-east-1');
      setRegion(longTermProfile, 'us-east-1');
      region = 'us-east-1';
    }
  } else {
    console.log(`🔍 Using region from long-term profile: ${region}`);
  }

  let token = providedToken;
  if (token) {
    console.log('🔍 Using MFA token provided via command line');
  } else {
    token = await getMfaTokenFrom1Password(longTermProfile);
  }

  const assumeRoleResult = execAwsCommand(['configure', 'get', 'assume_role', '--profile', longTermProfile]);
  const assumeRole = assumeRoleResult.success ? assumeRoleResult.stdout : '';

  const processToken = async (tokenCode) => {
    let credsJson;

    if (assumeRole) {
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
        console.log('⚠️  Failed to assume role with MFA');
        if (assumeRoleTokenResult.stderr) {
          console.log(`🔍 AWS error: ${assumeRoleTokenResult.stderr}`);
        }
        return false;
      }

      credsJson = JSON.parse(assumeRoleTokenResult.stdout);
    } else {
      const sessionTokenResult = execAwsCommand([
        'sts', 'get-session-token',
        '--profile', longTermProfile,
        '--serial-number', mfaSerial,
        '--token-code', tokenCode,
        '--duration-seconds', '28800',
        '--output', 'json'
      ]);

      if (!sessionTokenResult.success) {
        console.log('⚠️  MFA authentication failed: Invalid token or connection error');
        if (sessionTokenResult.stderr) {
          console.log(`🔍 AWS error: ${sessionTokenResult.stderr}`);
        }
        return false;
      }

      credsJson = JSON.parse(sessionTokenResult.stdout);
    }

    try {
      const accessKey = credsJson.Credentials.AccessKeyId;
      const secretKey = credsJson.Credentials.SecretAccessKey;
      const sessionToken = credsJson.Credentials.SessionToken;
      const expiration = credsJson.Credentials.Expiration;

      setTemporaryCredentials(profile, {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        sessionToken,
        expiration
      });

      if (tokenCode === token) {
        setProfileValue(profile, 'aws_1password_mfa', 'true');
      }

      const verifyResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);

      if (verifyResult.success) {
        console.log(`✅ Successfully authenticated with MFA for profile: ${profile}`);
        execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
        return true;
      }

      console.log('⚠️  MFA authentication failed: Credentials validation error');
      console.log(`🔍 DEBUG: Verification error: ${verifyResult.stderr}`);
      return false;
    } catch (error) {
      console.log(`⚠️  MFA authentication failed: ${error.message}`);
      return false;
    }
  };

  if (token) {
    const success = await processToken(token);
    if (success) {
      return profile;
    }
    console.log('⚠️  1Password MFA token failed, falling back to manual entry');
  }

  const manualToken = await askNonEmpty('Enter MFA token');
  const success = await processToken(manualToken);
  return success ? profile : null;
}

module.exports = {
  handleSsoAuth,
  handleMfaAuth
};
