'use strict';

const { execAwsCommand, commandExists } = require('../core/aws');
const {
  askNonEmpty,
  askYesNo,
  selectFromList
} = require('../core/prompt');
const { slugify } = require('../core/formatters');
const { buildRegionChoices, formatRegion } = require('../constants/regions');
const { buildOutputChoices } = require('../constants/output-formats');
const {
  listProfiles,
  profileExists,
  getProfileValue,
  setProfileValue,
  unsetProfileKey,
  setProfileValues,
  getRegion,
  setRegion
} = require('./aws-config');
const { exec1PasswordCommand } = require('./onepassword');
const { promptForMfaDevice } = require('./mfa');
const { listSsoAccounts, listAccountRoles } = require('./sso');

async function check1PasswordAvailability() {
  if (!commandExists('op')) {
    console.log('⚠️  1Password CLI is not installed.');
    console.log('ℹ️  To enable 1Password integration, install the 1Password CLI:');
    console.log('   https://1password.com/downloads/command-line/');
    return false;
  }

  const versionResult = exec1PasswordCommand(['--version']);
  if (!versionResult.success) {
    console.log('⚠️  1Password CLI is installed but not working properly.');
    console.log(`   Error: ${versionResult.stderr || 'Unknown error'}`);
    return false;
  }

  const listResult = exec1PasswordCommand(['vault', 'list']);
  if (!listResult.success) {
    console.log('⚠️  1Password CLI is installed but not authenticated.');
    console.log('ℹ️  Please run `op signin` to authenticate with 1Password.');
    return false;
  }

  console.log('✅ 1Password CLI is installed and authenticated.');
  return true;
}

async function configure1PasswordIntegration(profile) {
  console.log('\n🔐 Configuring 1Password Integration');
  console.log('=====================================');

  const has1Password = await check1PasswordAvailability();

  if (!has1Password) {
    const enableAnyway = await askYesNo('Would you like to enable 1Password integration anyway?', { defaultYes: false });
    if (!enableAnyway) {
      console.log('ℹ️  Skipping 1Password integration setup.');
      unsetProfileKey(profile, 'aws_1password_mfa');
      return false;
    }
  }

  console.log('\nℹ️  1Password can automatically supply MFA tokens for AWS authentication.');
  const enableMfa = await askYesNo('Enable 1Password MFA integration?');

  if (!enableMfa) {
    unsetProfileKey(profile, 'aws_1password_mfa');
    unsetProfileKey(profile, 'aws_1password_item_id');
    console.log('ℹ️  1Password MFA integration disabled for this profile.');
    return false;
  }

  setProfileValue(profile, 'aws_1password_mfa', 'true');
  console.log('✅ 1Password MFA integration enabled for this profile.');

  if (!has1Password) {
    return true;
  }

  const baseProfile = profile.endsWith('-long-term')
    ? profile.replace('-long-term', '')
    : profile;

  console.log(`\n🔍 Looking for AWS entries in 1Password matching "${baseProfile}"...`);

  const searchResult = exec1PasswordCommand(['item', 'list', '--format', 'json']);
  if (!searchResult.success) {
    console.log('⚠️  Could not search 1Password for AWS items.');
    return true;
  }

  let items = [];
  try {
    items = JSON.parse(searchResult.stdout);
  } catch (error) {
    console.log('⚠️  Error parsing 1Password search results:', error.message);
    return true;
  }

  const awsItems = items.filter((item) => {
    const lowerTitle = item.title.toLowerCase();
    const lowerSearchTerm = baseProfile.toLowerCase();
    const normalized = lowerTitle.replace(/aws|amazon|-/gi, '').trim();
    return (
      (lowerTitle.includes('aws') || lowerTitle.includes('amazon')) &&
      (lowerTitle.includes(lowerSearchTerm) || lowerSearchTerm.includes(normalized))
    );
  });

  if (awsItems.length === 0) {
    console.log('⚠️  No matching AWS items found in 1Password.');
    console.log('ℹ️  You will need to select an item manually during authentication.');
    return true;
  }

  const options = [
    ...awsItems.map((item) => ({
      id: item.id,
      label: `${item.title} (${item.id})`,
      title: item.title
    })),
    {
      id: null,
      label: "I'll select an item manually during authentication",
      title: null
    }
  ];

  const selectedOption = await selectFromList(options, {
    header: '\nWhich 1Password item would you like to use for MFA tokens?',
    formatOption: (option) => option.label,
    valueSelector: (option) => option.id,
    defaultValue: options[0]?.id
  });

  if (selectedOption.id) {
    console.log(`✅ Setting default 1Password item to: ${selectedOption.title}`);
    setProfileValue(baseProfile, 'aws_1password_item_id', selectedOption.id);
  } else {
    console.log('ℹ️  No default 1Password item set. You will select one during authentication.');
    unsetProfileKey(baseProfile, 'aws_1password_item_id');
  }

  return true;
}

async function ensureLongTermProfile(profile, longTermProfile, standardProfile) {
  console.log(`\n🔄 Setting up long-term profile: ${longTermProfile}`);
  console.log('ℹ️  You will need your permanent AWS credentials (access key and secret key).');

  const accessKey = await askNonEmpty('Enter your AWS Access Key ID');
  const secretKey = await askNonEmpty('Enter your AWS Secret Access Key', { maskDefault: true });

  setProfileValues(longTermProfile, [
    { key: 'aws_access_key_id', value: accessKey },
    { key: 'aws_secret_access_key', value: secretKey }
  ]);

  const regionFromStandard = getRegion(standardProfile);
  if (regionFromStandard) {
    setRegion(longTermProfile, regionFromStandard);
  }

  console.log(`✅ Created long-term profile: ${longTermProfile}`);
  await promptForMfaDevice(longTermProfile);
}

async function configureMfaSettings(profile) {
  console.log('\n🔐 Configuring MFA Settings');
  console.log('=========================');

  const isLongTermProfile = profile.endsWith('-long-term');
  const longTermProfile = isLongTermProfile ? profile : `${profile}-long-term`;
  const standardProfile = isLongTermProfile ? profile.replace('-long-term', '') : profile;

  const profiles = listProfiles();
  const longTermExists = profileExists(longTermProfile, profiles);

  if (!longTermExists && !isLongTermProfile) {
    console.log('\nℹ️  For MFA authentication, you need a long-term profile with permanent credentials.');
    console.log(`   This profile should be named: ${longTermProfile}`);

    const createLongTerm = await askYesNo('Would you like to set up a long-term profile now?', { defaultYes: false });

    if (createLongTerm) {
      await ensureLongTermProfile(profile, longTermProfile, standardProfile);
    } else {
      console.log('ℹ️  Skipping long-term profile setup.');
    }
  } else if (isLongTermProfile) {
    console.log("ℹ️  This is a long-term profile. Let's configure the MFA device for it.");
    await promptForMfaDevice(profile);
  } else {
    console.log(`ℹ️  A long-term profile (${longTermProfile}) already exists for this profile.`);
    const updateMfa = await askYesNo('Would you like to update the MFA device for it?');
    if (updateMfa) {
      await promptForMfaDevice(longTermProfile);
    }
  }

  return true;
}

async function configureAdvancedOptions(profile) {
  console.log('\n⚙️  Configuring Advanced Options');
  console.log('=============================');

  const currentRegion = getRegion(profile);
  console.log(`\nℹ️  Current default region: ${formatRegion(currentRegion)}`);

  const changeRegion = await askYesNo('Would you like to change the default region?', { defaultYes: false });
  if (changeRegion) {
    const regionOptions = buildRegionChoices(currentRegion);
    const selectedRegion = await selectFromList(regionOptions, {
      header: '\nSelect a default region:',
      formatOption: (option) => option.label,
      valueSelector: (option) => option.value,
      defaultValue: currentRegion || regionOptions.at(-1)?.value
    });

    if (selectedRegion.value && selectedRegion.value !== currentRegion) {
      setRegion(profile, selectedRegion.value);
      console.log(`✅ Default region set to: ${selectedRegion.value}`);
    }
  }

  const currentOutput = getProfileValue(profile, 'output');
  console.log(`\nℹ️  Current output format: ${currentOutput || 'Not set'}`);

  const changeOutput = await askYesNo('Would you like to change the output format?', { defaultYes: false });
  if (changeOutput) {
    const outputOptions = buildOutputChoices(currentOutput);
    const selectedOutput = await selectFromList(outputOptions, {
      header: '\nSelect an output format:',
      formatOption: (option) => option.label,
      valueSelector: (option) => option.value,
      defaultValue: currentOutput || outputOptions.at(-1)?.value
    });

    if (selectedOutput.value && selectedOutput.value !== currentOutput) {
      setProfileValue(profile, 'output', selectedOutput.value);
      console.log(`✅ Output format set to: ${selectedOutput.value}`);
    }
  }

  return true;
}

function detectProfileType(profile, profiles) {
  const ssoSession = getProfileValue(profile, 'sso_session');
  const ssoStartUrl = getProfileValue(profile, 'sso_start_url');

  if (ssoSession || ssoStartUrl) {
    return 'sso';
  }

  if (profile.endsWith('-long-term')) {
    return 'long-term';
  }

  if (profiles.includes(`${profile}-long-term`)) {
    return 'mfa';
  }

  return 'direct';
}

async function ensureProfileExists(profile, profiles) {
  if (profileExists(profile, profiles)) {
    console.log('✅ Profile exists in AWS configuration');
    return true;
  }

  console.log(`❌ Profile ${profile} not found`);
  const createNew = await askYesNo(`Would you like to create the profile ${profile}?`);
  if (!createNew) {
    return false;
  }

  console.log(`\n🔄 Creating new profile stub: ${profile}`);
  setProfileValues(profile, [
    { key: 'region', value: 'us-east-1' },
    { key: 'output', value: 'json' }
  ]);
  console.log('ℹ️  Default region/output set. Adjust them via Advanced Options.');
  return true;
}

function summarizeProfile(profile) {
  console.log('\n📝 Profile summary');
  console.log('------------------');
  const summary = {
    region: getRegion(profile) || 'Not set',
    output: getProfileValue(profile, 'output') || 'Not set',
    sso_session: getProfileValue(profile, 'sso_session') || getProfileValue(profile, 'sso_start_url') || 'Not set',
    long_term_profile: profile.endsWith('-long-term') ? 'This profile is long-term' : getProfileValue(`${profile}-long-term`, 'aws_access_key_id') ? 'Configured' : 'Not configured',
    onepassword: getProfileValue(profile, 'aws_1password_mfa') ? 'Enabled' : 'Disabled'
  };

  Object.entries(summary).forEach(([key, value]) => {
    console.log(`${key.replace(/_/g, ' ')}: ${value}`);
  });
}

async function configureProfile(profile) {
  console.log('\n🔧 AWS Profile Configuration Wizard');
  console.log('=================================');
  console.log(`\nConfiguring profile: ${profile}`);

  const profiles = listProfiles();
  if (!(await ensureProfileExists(profile, profiles))) {
    return false;
  }

  const profileType = detectProfileType(profile, profiles);
  console.log(`ℹ️  Profile type detected: ${profileType.toUpperCase()}`);

  const configOptions = [
    { name: '1Password integration', handler: configure1PasswordIntegration },
    { name: 'MFA settings', handler: configureMfaSettings },
    { name: 'Advanced options (region & output)', handler: configureAdvancedOptions },
    { name: 'Exit configuration', handler: null }
  ];

  let continueConfig = true;
  while (continueConfig) {
    const selectedOption = await selectFromList(configOptions, {
      header: '\nWhat would you like to configure?',
      formatOption: (option) => option.name,
      valueSelector: (option) => option.name,
      defaultValue: configOptions[0].name
    });

    if (selectedOption.handler) {
      await selectedOption.handler(profile);
    } else {
      continueConfig = false;
    }
  }

  summarizeProfile(profile);
  console.log(`\n✅ Profile configuration complete! Use: awslogin ${profile}`);
  return true;
}

async function configureAllOrgProfiles(profile) {
  console.log('\n🏢 AWS Organization Profiles Configuration');
  console.log('======================================');
  console.log(`\nConfiguring profiles for all accounts using base profile: ${profile}`);

  const profiles = listProfiles();
  if (!profileExists(profile, profiles)) {
    console.log(`❌ Profile ${profile} not found`);
    return false;
  }

  console.log(`\n🔑 Logging in to base profile: ${profile}`);
  const ssoLoginResult = execAwsCommand(['sso', 'login', '--profile', profile], { stdio: 'inherit' });

  if (!ssoLoginResult.success) {
    console.log('❌ Failed to authenticate with base profile');
    return false;
  }

  console.log('\n🔍 Retrieving all AWS accounts in the organization...');
  const accounts = await listSsoAccounts(profile);

  if (!accounts || accounts.length === 0) {
    console.log('❌ No AWS accounts found or unable to list accounts');
    return false;
  }

  console.log(`✅ Found ${accounts.length} accounts in the organization`);

  let createdProfiles = 0;
  const baseRegion = getRegion(profile) || 'us-east-1';

  for (const account of accounts) {
    const accountName = account.accountName;
    const accountId = account.accountId;

    console.log(`\n📝 Processing account: ${accountName} (${accountId})`);

    const roles = await listAccountRoles(profile, accountId);
    if (!roles || roles.length === 0) {
      console.log(`⚠️  No roles available for account: ${accountName}`);
      continue;
    }

    const role = roles[0];
    const accountSlug = slugify(accountName, { fallback: accountId });
    const derivedProfile = `${profile}-${accountSlug}`;

    const ssoSession = getProfileValue(profile, 'sso_session');
    const ssoStartUrl = getProfileValue(profile, 'sso_start_url');
    const ssoRegion = getProfileValue(profile, 'sso_region');

    const entries = [
      { key: 'sso_account_id', value: accountId },
      { key: 'sso_role_name', value: role.roleName },
      { key: 'parent_profile', value: profile },
      { key: 'account_id', value: accountId },
      { key: 'account_name', value: accountName },
      { key: 'role_name', value: role.roleName }
    ];

    if (ssoSession) {
      entries.push({ key: 'sso_session', value: ssoSession });
    }
    if (ssoStartUrl) {
      entries.push({ key: 'sso_start_url', value: ssoStartUrl });
    }
    if (ssoRegion) {
      entries.push({ key: 'sso_region', value: ssoRegion });
    }

    setProfileValues(derivedProfile, entries);
    setRegion(derivedProfile, baseRegion);

    console.log(`✅ Created profile: ${derivedProfile}`);
    createdProfiles += 1;
  }

  console.log('\n🎉 Profile configuration complete!');
  console.log(`✅ Created ${createdProfiles} profiles for AWS organization accounts`);
  console.log(`\n💡 Use the profiles with: aws --profile ${profile}-<account> <command>`);
  console.log(`💡 Or authenticate with: awslogin ${profile}-<account>`);

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
