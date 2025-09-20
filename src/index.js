'use strict';

const { execAwsCommand } = require('./core/aws');
const { checkCredentialsExpired, isSessionValid } = require('./core/session');
const { askYesNo } = require('./core/prompt');
const { handleSsoAuth, handleMfaAuth } = require('./services/auth-manager');
const { getSsoRoleCredentials } = require('./services/sso');
const { setupIdentityCenter } = require('./services/identity-center');
const { configureProfile, configureAllOrgProfiles } = require('./services/profile-config');
const { cleanupAwsProfile } = require('./services/profile-service');
const {
  listProfiles,
  profileExists,
  getProfileValue,
  setTemporaryCredentials
} = require('./services/aws-config');
const { displayHelp } = require('./help');

function parseArgs(argv) {
  let profile = null;
  const flags = {
    selectAccount: false,
    configureIdentityCenter: false,
    showHelp: false,
    cleanProfile: false,
    configureProfile: false,
    configureAllOrg: false,
    changeAccount: false,
    forceReauth: false,
    mfaToken: null,
    unknown: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!profile && !arg.startsWith('-')) {
      profile = arg;
      continue;
    }

    switch (arg) {
      case '--select':
        flags.selectAccount = true;
        break;
      case '--setup-iam-identity-center':
        flags.configureIdentityCenter = true;
        break;
      case '--help':
      case '-h':
        flags.showHelp = true;
        break;
      case '--clean':
        flags.cleanProfile = true;
        break;
      case '--configure':
        flags.configureProfile = true;
        break;
      case '--all-org':
      case '--org-accounts':
        flags.configureAllOrg = true;
        break;
      case '--change':
        flags.changeAccount = true;
        break;
      case '--force':
        flags.forceReauth = true;
        break;
      case '--token':
      case '--mfa-token':
        flags.mfaToken = argv[i + 1] || null;
        i += 1;
        break;
      default:
        if (arg.startsWith('-')) {
          flags.unknown.push(arg);
        }
        break;
    }
  }

  return { profile, flags };
}

async function refreshSubProfileCredentials(profile, parentProfile) {
  console.log(`🔄 Refreshing sub-profile credentials using parent SSO session`);

  const accountId = getProfileValue(profile, 'account_id');
  const roleName = getProfileValue(profile, 'role_name');

  if (!accountId || !roleName) {
    console.log(`❌ Sub-profile ${profile} is missing account_id or role_name metadata`);
    console.log(`💡 Try running: awslogin ${parentProfile} --select`);
    return false;
  }

  const roleCredentials = await getSsoRoleCredentials(parentProfile, accountId, roleName);

  if (!roleCredentials) {
    console.log(`❌ Failed to refresh credentials for sub-profile: ${profile}`);
    console.log('💡 This may happen if the SSO session needs re-authentication');
    console.log(`💡 Try running: awslogin ${parentProfile}`);
    return false;
  }

  setTemporaryCredentials(profile, roleCredentials);

  console.log(`✅ Successfully refreshed credentials for sub-profile: ${profile}`);
  execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
  return true;
}

async function runAwsLogin(argv) {
  const { profile, flags } = parseArgs(argv);

  if (flags.showHelp || !profile) {
    displayHelp();
    return { success: flags.showHelp, exitCode: flags.showHelp ? 0 : 1 };
  }

  if (flags.configureIdentityCenter) {
    const setupResult = await setupIdentityCenter(profile);
    return { success: setupResult, exitCode: setupResult ? 0 : 1 };
  }

  if (flags.cleanProfile) {
    console.log(`⚠️  About to clean up credentials for profile: ${profile}`);
    console.log('💡 This will remove temporary credentials and session tokens.');

    const confirmCleanup = await askYesNo('Are you sure you want to continue?', { defaultYes: false });

    if (!confirmCleanup) {
      console.log('🛑 Cleanup cancelled');
      return { success: true, exitCode: 0 };
    }

    const cleanupResult = await cleanupAwsProfile(profile);
    return { success: cleanupResult, exitCode: cleanupResult ? 0 : 1 };
  }

  if (flags.configureProfile) {
    if (flags.configureAllOrg) {
      console.log(`🏢 Configuring profiles for all AWS organization accounts using base profile: ${profile}`);
      const configResult = await configureAllOrgProfiles(profile);
      return { success: configResult, exitCode: configResult ? 0 : 1 };
    }

    const configResult = await configureProfile(profile);
    return { success: configResult, exitCode: configResult ? 0 : 1 };
  }

  const allProfiles = listProfiles();

  if (!profileExists(profile, allProfiles)) {
    console.log(`❌ Profile ${profile} not found`);
    return { success: false, exitCode: 1 };
  }

  const parentProfile = getProfileValue(profile, 'parent_profile') || '';

  if (parentProfile) {
    console.log(`🔍 Detected sub-profile. Parent profile: ${parentProfile}`);

    if (!isSessionValid(parentProfile)) {
      console.log(`⚠️ Parent profile ${parentProfile} SSO session is invalid`);
      console.log(`💡 Please authenticate the parent profile first: awslogin ${parentProfile}`);
      return { success: false, exitCode: 1 };
    }

    console.log(`✅ Parent profile ${parentProfile} has valid SSO session`);

    if (!checkCredentialsExpired(profile)) {
      console.log(`✅ Sub-profile ${profile} credentials are still valid`);
      execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
      return { success: true, exitCode: 0 };
    }

    const refreshed = await refreshSubProfileCredentials(profile, parentProfile);
    return { success: refreshed, exitCode: refreshed ? 0 : 1 };
  }

  const ssoStartUrl = getProfileValue(profile, 'sso_start_url');
  const ssoSession = getProfileValue(profile, 'sso_session');

  if (ssoStartUrl || ssoSession) {
    if (flags.changeAccount) {
      console.log(`🔄 Changing account for profile: ${profile}`);

      if (!isSessionValid(profile)) {
        console.log('⚠️ No valid SSO session found. Authenticating first...');
        const authResult = await handleSsoAuth(profile, false, allProfiles);
        if (!authResult) {
          return { success: false, exitCode: 1 };
        }
      }

      const result = await handleSsoAuth(profile, true, allProfiles, true);
      return { success: Boolean(result), exitCode: result ? 0 : 1 };
    }

    if (!flags.forceReauth && isSessionValid(profile)) {
      console.log(`✅ Session for profile ${profile} is still valid`);
      execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
      return { success: true, exitCode: 0 };
    }

    if (flags.forceReauth) {
      console.log('🔄 Forcing re-authentication as requested');
    }

    const result = await handleSsoAuth(profile, flags.selectAccount, allProfiles);
    return { success: Boolean(result), exitCode: result ? 0 : 1 };
  }

  console.log(`🔑 Attempting direct authentication for profile: ${profile}`);

  if (isSessionValid(profile) && !checkCredentialsExpired(profile)) {
    execAwsCommand(['sts', 'get-caller-identity', '--profile', profile], { stdio: 'inherit' });
    return { success: true, exitCode: 0 };
  }

  const longTermProfile = `${profile}-long-term`;
  if (allProfiles.includes(longTermProfile)) {
    const result = await handleMfaAuth(profile, longTermProfile, flags.mfaToken);
    return { success: Boolean(result), exitCode: result ? 0 : 1 };
  }

  console.log('❌ Direct authentication failed and no long-term profile found');
  console.log(`❌ Failed to authenticate using profile: ${profile}`);
  return { success: false, exitCode: 1 };
}

module.exports = {
  runAwsLogin
};
