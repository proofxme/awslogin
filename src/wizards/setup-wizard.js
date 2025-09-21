'use strict';

const BaseWizard = require('./base-wizard');
const { setProfileConfig, getProfileConfig } = require('../services/aws-config');
const { checkCommand } = require('../core/aws');
const { PROFILE_TEMPLATES } = require('../config/templates');
const AutoDiscovery = require('../services/auto-discovery');

/**
 * Setup wizard for creating and configuring AWS profiles
 */
class SetupWizard extends BaseWizard {
  constructor() {
    super();
    this.autoDiscovery = new AutoDiscovery();
    this.steps = [
      'Profile Name',
      'Authentication Method',
      'Configuration',
      'Validation',
      'Save'
    ];
  }

  async run() {
    this.clear();
    this.showBanner('➕ New Profile Setup', 'Quick and easy AWS profile configuration');

    const config = {};

    // Step 1: Profile name
    config.profileName = await this.getProfileName();

    // Step 2: Authentication method (simplified)
    config.authMethod = await this.selectAuthMethod();

    // Step 3: Configuration based on method
    await this.configureAuthMethod(config);

    // Step 4: Save configuration
    const saved = await this.saveConfiguration(config);

    if (!saved) {
      this.showError('Failed to save profile configuration');
      return { success: false };
    }

    this.showSuccess(`Profile '${config.profileName}' created successfully!`);

    // Offer to test authentication
    const test = await this.confirm('Would you like to test authentication now?');
    if (test) {
      const AuthWizard = require('./auth-wizard');
      const authWizard = new AuthWizard();
      const result = await authWizard.run(config.profileName);
      return { ...result, profileName: config.profileName };
    }

    return { success: true, profileName: config.profileName };
  }

  async getProfileName() {
    // Check for existing profiles to avoid duplicates
    const existingProfiles = await this.autoDiscovery.getExistingProfiles();

    let profileName;
    let isValid = false;

    while (!isValid) {
      profileName = await this.input('Enter a name for this profile:', {
        placeholder: 'e.g., company-dev'
      });

      if (!profileName) {
        this.showError('Profile name cannot be empty');
        continue;
      }

      if (existingProfiles.includes(profileName)) {
        this.showError(`Profile '${profileName}' already exists`);
        const overwrite = await this.confirm('Do you want to overwrite it?', false);
        if (overwrite) {
          isValid = true;
        }
      } else {
        isValid = true;
      }
    }

    return profileName;
  }

  async selectAuthMethod() {
    const choices = [
      {
        title: '🏢 SSO (Recommended)',
        value: 'sso',
        description: 'Single sign-on for organizations'
      },
      {
        title: '📱 MFA',
        value: 'mfa',
        description: 'Multi-factor authentication'
      },
      {
        title: '🔑 Direct',
        value: 'direct',
        description: 'Simple access keys'
      }
    ];

    return this.select('Authentication type:', choices);
  }

  async selectTemplate() {
    const choices = Object.entries(PROFILE_TEMPLATES).map(([key, template]) => ({
      title: template.name,
      value: key,
      description: template.description
    }));

    choices.push({
      title: '🔙 Custom configuration',
      value: 'custom',
      description: 'Configure manually without a template'
    });

    const template = await this.select('Select a profile template:', choices);

    if (template === 'custom') {
      return this.selectAuthMethod();
    }

    // Apply template and return its auth method
    this.context.template = PROFILE_TEMPLATES[template];
    return this.context.template.authMethod || 'sso';
  }

  async configureAuthMethod(config) {
    switch (config.authMethod) {
      case 'sso':
        await this.configureSSO(config);
        break;
      case 'mfa':
        await this.configureMFA(config);
        break;
      case 'direct':
        await this.configureDirect(config);
        break;
      case 'import':
        await this.configureImport(config);
        break;
    }
  }

  async configureSSO(config) {
    this.showInfo('Configuring AWS SSO / Identity Center authentication');

    // Check for existing SSO profiles
    const existingProfiles = await this.autoDiscovery.getExistingProfiles();
    const ssoProfiles = [];
    for (const profileName of existingProfiles) {
      const profileConfig = await getProfileConfig(profileName);
      if (profileConfig && (profileConfig.sso_start_url || profileConfig.sso_session)) {
        ssoProfiles.push(profileName);
      }
    }

    if (ssoProfiles.length > 0) {
      this.showInfo(`Found existing SSO profiles: ${ssoProfiles.join(', ')}`);
      const copyFromExisting = await this.confirm('Copy SSO settings from existing profile?', true);
      if (copyFromExisting) {
        const sourceProfile = await this.select('Select profile to copy from:',
          ssoProfiles.map(p => ({ title: p, value: p }))
        );
        const sourceConfig = await getProfileConfig(sourceProfile);

        // Copy SSO settings
        config.sso_start_url = sourceConfig.sso_start_url;
        config.sso_region = sourceConfig.sso_region;
        config.sso_session = sourceConfig.sso_session;
        config.sso_role_name = sourceConfig.sso_role_name;

        this.showSuccess(`Copied SSO settings from '${sourceProfile}'`);

        // Ask if they want different account/role
        const differentAccount = await this.confirm('Configure different account/role?', false);
        if (!differentAccount) {
          return; // Use the copied settings as-is
        }
      }
    }

    this.showInfo('📋 SSO Setup Guide:');
    this.showInfo('1. Get your SSO start URL from your admin (e.g., https://company.awsapps.com/start)');
    this.showInfo('2. Know the AWS region where SSO is configured');
    this.showInfo('3. Know the role name you want to assume (e.g., AdministratorAccess)');

    // Try to auto-discover SSO URL if not copied
    if (!config.sso_start_url) {
      const discoveredUrl = await this.autoDiscovery.discoverSSOUrl();
      if (discoveredUrl) {
        this.showInfo(`Found existing SSO URL: ${discoveredUrl}`);
        const useDiscovered = await this.confirm('Use this SSO URL?', true);
        if (useDiscovered) {
          config.sso_start_url = discoveredUrl;
        }
      }
    }

    if (!config.sso_start_url) {
      config.sso_start_url = await this.input('Enter your SSO start URL:', {
        placeholder: 'https://company.awsapps.com/start',
        validate: (value) => {
          if (!value) return 'SSO URL is required';
          if (!value.startsWith('https://')) return 'SSO URL must start with https://';
          if (!value.includes('.awsapps.com/start') && !value.includes('/start')) {
            return 'SSO URL should end with /start';
          }
          return true;
        }
      });
    }

    // SSO Region
    const defaultRegion = await this.autoDiscovery.getDefaultRegion();
    config.sso_region = await this.input('SSO Region:', {
      default: defaultRegion || 'us-east-1',
      placeholder: 'us-east-1'
    });

    // Check if using SSO session (newer method)
    const useSession = await this.confirm('Use SSO session configuration? (recommended)', true);

    if (useSession) {
      config.sso_session = config.profileName;
      // Session configuration will be handled by AWS CLI
    }

    // SSO Account ID (optional at this stage)
    const specifyAccount = await this.confirm('Specify a default account ID?', false);
    if (specifyAccount) {
      config.sso_account_id = await this.input('AWS Account ID:', {
        placeholder: '123456789012',
        validate: (value) => {
          if (value && !/^\d{12}$/.test(value)) {
            return 'Account ID must be 12 digits';
          }
          return true;
        }
      });

      // SSO Role Name
      config.sso_role_name = await this.input('SSO Role Name:', {
        default: 'AdministratorAccess',
        placeholder: 'AdministratorAccess'
      });
    }
  }

  async configureMFA(config) {
    this.showInfo('Configuring Multi-Factor Authentication');

    // Check for existing MFA profiles
    const existingProfiles = await this.autoDiscovery.getExistingProfiles();
    const mfaProfiles = [];
    for (const profileName of existingProfiles) {
      const profileConfig = await getProfileConfig(profileName);
      if (profileConfig && profileConfig.mfa_serial) {
        mfaProfiles.push(profileName);
      }
    }

    if (mfaProfiles.length > 0) {
      this.showInfo(`Found existing MFA profiles: ${mfaProfiles.join(', ')}`);
      const copyFromExisting = await this.confirm('Copy MFA settings from existing profile?', true);
      if (copyFromExisting) {
        const sourceProfile = await this.select('Select profile to copy from:',
          mfaProfiles.map(p => ({ title: p, value: p }))
        );
        const sourceConfig = await getProfileConfig(sourceProfile);

        // Copy MFA settings
        config.aws_access_key_id = sourceConfig.aws_access_key_id;
        config.aws_secret_access_key = sourceConfig.aws_secret_access_key;
        config.mfa_serial = sourceConfig.mfa_serial;
        config.op_item = sourceConfig.op_item; // Copy 1Password config if exists

        this.showSuccess(`Copied MFA settings from '${sourceProfile}'`);

        // Skip manual entry if copied successfully
        if (config.aws_access_key_id && config.mfa_serial) {
          return;
        }
      }
    }

    // Offer to create new user if no existing profiles copied
    const setupOption = await this.select('MFA Setup Options:', [
      {
        title: '🆕 Create new AWS user with MFA',
        value: 'create',
        description: 'Create a new IAM user and set up MFA automatically'
      },
      {
        title: '📝 Enter existing credentials',
        value: 'manual',
        description: 'I already have AWS credentials and MFA device'
      }
    ]);

    if (setupOption === 'create') {
      return await this.createUserWithMFA(config);
    }

    this.showInfo('📋 Manual MFA Setup Guide:');
    this.showInfo('1. You need your AWS Access Key ID and Secret Access Key');
    this.showInfo('2. Your MFA device serial (ARN from IAM console)');
    this.showInfo('3. Optional: 1Password for automatic token retrieval');

    // Access Key ID
    config.aws_access_key_id = await this.input('AWS Access Key ID:', {
      placeholder: 'AKIAIOSFODNN7EXAMPLE',
      validate: (value) => {
        if (!value) return 'Access Key ID is required';
        if (!/^AKIA[A-Z0-9]{16}$/.test(value)) {
          return 'Invalid Access Key ID format';
        }
        return true;
      }
    });

    // Secret Access Key
    config.aws_secret_access_key = await this.input('AWS Secret Access Key:', {
      placeholder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      password: true,
      validate: (value) => {
        if (!value) return 'Secret Access Key is required';
        if (value.length < 20) return 'Secret Access Key seems too short';
        return true;
      }
    });

    // MFA Device Serial
    config.mfa_serial = await this.input('MFA Device Serial:', {
      placeholder: 'arn:aws:iam::123456789012:mfa/username',
      validate: (value) => {
        if (!value) return 'MFA serial is required for MFA authentication';
        if (!value.startsWith('arn:aws:iam::')) {
          return 'MFA serial should start with arn:aws:iam::';
        }
        return true;
      }
    });

    // Check for 1Password integration
    const has1Password = await checkCommand('op --version');
    if (has1Password) {
      const use1Password = await this.confirm('Use 1Password for MFA tokens?', true);
      if (use1Password) {
        await this.configure1Password(config);
      }
    }
  }

  async configureDirect(config) {
    this.showWarning('Direct credentials are not recommended for production use!');

    const proceed = await this.confirm('Are you sure you want to use direct credentials?', false);
    if (!proceed) {
      config.authMethod = await this.selectAuthMethod();
      return this.configureAuthMethod(config);
    }

    // Access Key ID
    config.aws_access_key_id = await this.input('AWS Access Key ID:', {
      placeholder: 'AKIAIOSFODNN7EXAMPLE',
      validate: (value) => {
        if (!value) return 'Access Key ID is required';
        if (!/^AKIA[A-Z0-9]{16}$/.test(value)) {
          return 'Invalid Access Key ID format';
        }
        return true;
      }
    });

    // Secret Access Key
    config.aws_secret_access_key = await this.input('AWS Secret Access Key:', {
      placeholder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      password: true,
      validate: (value) => {
        if (!value) return 'Secret Access Key is required';
        if (value.length < 20) return 'Secret Access Key seems too short';
        return true;
      }
    });
  }

  async configureImport(config) {
    const profiles = await this.autoDiscovery.getExistingProfiles();

    if (profiles.length === 0) {
      this.showError('No existing profiles found to import from');
      config.authMethod = await this.selectAuthMethod();
      return this.configureAuthMethod(config);
    }

    const sourceProfile = await this.select('Select profile to import from:',
      profiles.map(p => ({ title: p, value: p }))
    );

    const sourceConfig = await getProfileConfig(sourceProfile);

    // Copy relevant configuration
    Object.assign(config, sourceConfig);

    // Remove profile-specific items
    delete config.name;
    delete config.aws_session_token;
    delete config.aws_expiration;

    this.showSuccess(`Imported configuration from '${sourceProfile}'`);
  }

  async configure1Password(config) {
    this.showInfo('Configuring 1Password integration');

    // Check if 1Password CLI is authenticated
    const opStatus = await checkCommand('op whoami');
    if (!opStatus) {
      this.showWarning('1Password CLI is not signed in');
      this.showInfo('📋 1Password Setup Guide:');
      this.showInfo('1. Run: op signin');
      this.showInfo('2. Enter your 1Password credentials');
      this.showInfo('3. Come back and try again');

      const tryAgain = await this.confirm('Is 1Password CLI signed in now?', false);
      if (!tryAgain) {
        this.showInfo('Skipping 1Password integration');
        return;
      }
    }

    // Search for existing AWS MFA items
    this.showProgress('Searching for AWS MFA items in 1Password...');
    try {
      const searchResult = await checkCommand('op item list --categories TOTP --format json');
      if (searchResult) {
        // Parse and filter AWS-related items
        const items = JSON.parse(searchResult.toString() || '[]');
        const awsItems = items.filter(item =>
          item.title && (
            item.title.toLowerCase().includes('aws') ||
            item.title.toLowerCase().includes('mfa') ||
            item.title.toLowerCase().includes('amazon')
          )
        );

        if (awsItems.length > 0) {
          this.showInfo(`Found ${awsItems.length} potential AWS MFA items`);
          const useExisting = await this.confirm('Use existing 1Password item?', true);

          if (useExisting) {
            const choices = awsItems.map(item => ({
              title: `${item.title} (${item.id})`,
              value: item.title
            }));
            choices.push({ title: '➕ Enter different item name', value: 'custom' });

            const selection = await this.select('Select 1Password item:', choices);
            if (selection !== 'custom') {
              config.op_item = selection;
              this.showSuccess(`Using 1Password item: ${selection}`);
              return;
            }
          }
        }
      }
    } catch (error) {
      this.showWarning('Could not search 1Password items automatically');
    }

    const itemName = await this.input('1Password item name containing MFA secret:', {
      placeholder: 'AWS MFA - ' + config.profileName,
      validate: (value) => {
        if (!value) return 'Item name is required';
        return true;
      }
    });

    config.op_item = itemName;

    // Test 1Password access
    const testResult = await this.test1PasswordAccess(itemName);
    if (!testResult) {
      this.showWarning('Could not verify 1Password item. Make sure it exists and contains a TOTP field.');
    } else {
      this.showSuccess('1Password integration configured successfully!');
    }
  }

  async test1PasswordAccess(itemName) {
    try {
      const { execSync } = require('child_process');
      execSync(`op item get "${itemName}" --fields type=otp`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  async createUserWithMFA(config) {
    this.showInfo('🆕 Creating new AWS user with MFA setup');

    // Get admin profile for user creation
    const existingProfiles = await this.autoDiscovery.getExistingProfiles();
    if (existingProfiles.length === 0) {
      this.showError('No existing AWS profiles found. You need an admin profile to create users.');
      this.showInfo('Please create an admin profile first (SSO or existing credentials)');
      return;
    }

    const adminProfile = await this.select('Select admin profile for user creation:',
      existingProfiles.map(p => ({ title: p, value: p }))
    );

    // Get username for new user
    const username = await this.input('New IAM user name:', {
      default: config.profileName || 'awslogin-user',
      placeholder: 'awslogin-user',
      validate: (value) => {
        if (!value) return 'Username is required';
        if (!/^[a-zA-Z0-9_+=,.@-]+$/.test(value)) {
          return 'Username contains invalid characters';
        }
        return true;
      }
    });

    try {
      this.showProgress('Creating IAM user...');

      // Import AWS command execution
      const { execAwsCommand } = require('../core/aws');

      // Create IAM user
      const createUserResult = execAwsCommand([
        'iam', 'create-user',
        '--user-name', username,
        '--profile', adminProfile
      ]);

      if (!createUserResult.success) {
        throw new Error(`Failed to create user: ${createUserResult.stderr}`);
      }

      this.showSuccess(`Created IAM user: ${username}`);

      // Generate access keys
      this.showProgress('Generating access keys...');
      const createKeysResult = execAwsCommand([
        'iam', 'create-access-key',
        '--user-name', username,
        '--profile', adminProfile
      ]);

      if (!createKeysResult.success) {
        throw new Error(`Failed to create access keys: ${createKeysResult.stderr}`);
      }

      const accessKeyData = JSON.parse(createKeysResult.stdout);
      config.aws_access_key_id = accessKeyData.AccessKey.AccessKeyId;
      config.aws_secret_access_key = accessKeyData.AccessKey.SecretAccessKey;

      this.showSuccess('Generated access keys');

      // Create virtual MFA device
      this.showProgress('Creating virtual MFA device...');
      const createMfaResult = execAwsCommand([
        'iam', 'create-virtual-mfa-device',
        '--virtual-mfa-device-name', username,
        '--bootstrap-method', 'Base32StringSeed',
        '--outfile', `/tmp/mfa-${username}.txt`,
        '--profile', adminProfile
      ]);

      if (!createMfaResult.success) {
        throw new Error(`Failed to create MFA device: ${createMfaResult.stderr}`);
      }

      const mfaData = JSON.parse(createMfaResult.stdout);
      config.mfa_serial = mfaData.VirtualMFADevice.SerialNumber;

      // Read the MFA secret
      const { readFileSync } = require('fs');
      const mfaSecret = readFileSync(`/tmp/mfa-${username}.txt`, 'utf8').trim();

      this.showSuccess('Created virtual MFA device');

      // Setup 1Password integration
      const has1Password = await checkCommand('op --version');
      if (has1Password) {
        const use1Password = await this.confirm('Store MFA secret in 1Password?', true);
        if (use1Password) {
          await this.setup1PasswordForUser(config, username, mfaSecret);
        }
      }

      // Enable MFA device
      this.showProgress('Enabling MFA device...');
      if (config.op_item) {
        // Get two consecutive TOTP codes from 1Password
        await this.enableMfaWith1Password(config, username, adminProfile);
      } else {
        // Manual MFA setup
        this.showInfo(`MFA Secret for ${username}: ${mfaSecret}`);
        this.showInfo('Please add this secret to your authenticator app');
        await this.enableMfaManually(config, username, adminProfile);
      }

      // Clean up temporary file
      require('fs').unlinkSync(`/tmp/mfa-${username}.txt`);

      this.showSuccess('✅ User creation and MFA setup completed successfully!');
      this.showInfo(`User: ${username}`);
      this.showInfo(`MFA Serial: ${config.mfa_serial}`);
      if (config.op_item) {
        this.showInfo(`1Password Item: ${config.op_item}`);
      }

    } catch (error) {
      this.showError(`User creation failed: ${error.message}`);
      throw error;
    }
  }

  async setup1PasswordForUser(config, username, mfaSecret) {
    try {
      this.showProgress('Setting up 1Password integration...');

      const { execSync } = require('child_process');
      const itemName = `AWS ${username}`;

      // Create 1Password item with TOTP
      const createItemCmd = `op item create --category="Login" --title="${itemName}" 'totp[otp]=otpauth://totp/${username}?secret=${mfaSecret}&issuer=AWS'`;
      execSync(createItemCmd, { stdio: 'pipe' });

      config.op_item = itemName;
      this.showSuccess(`Created 1Password item: ${itemName}`);

    } catch (error) {
      this.showWarning(`Failed to create 1Password item: ${error.message}`);
      throw error;
    }
  }

  async enableMfaWith1Password(config, username, adminProfile) {
    try {
      const { execSync } = require('child_process');

      // Get first TOTP code
      const getCode = () => {
        const output = execSync(`op item get "${config.op_item}" --otp`, { encoding: 'utf8' });
        return output.trim();
      };

      const code1 = getCode();
      this.showProgress('Waiting for next TOTP window...');

      // Wait for next TOTP window (max 30 seconds)
      let code2 = code1;
      let attempts = 0;
      while (code2 === code1 && attempts < 35) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        code2 = getCode();
        attempts++;
      }

      if (code2 === code1) {
        throw new Error('Could not get consecutive TOTP codes');
      }

      this.showProgress('Enabling MFA device...');

      // Import AWS command execution
      const { execAwsCommand } = require('../core/aws');

      const enableResult = execAwsCommand([
        'iam', 'enable-mfa-device',
        '--user-name', username,
        '--serial-number', config.mfa_serial,
        '--authentication-code1', code1,
        '--authentication-code2', code2,
        '--profile', adminProfile
      ]);

      if (!enableResult.success) {
        throw new Error(`Failed to enable MFA device: ${enableResult.stderr}`);
      }

      this.showSuccess('MFA device enabled successfully');

    } catch (error) {
      this.showError(`Failed to enable MFA device: ${error.message}`);
      throw error;
    }
  }

  async enableMfaManually(config, username, adminProfile) {
    this.showInfo('Please enter two consecutive MFA codes from your authenticator app:');

    const code1 = await this.input('First MFA code (6 digits):', {
      validate: (value) => {
        if (!/^\d{6}$/.test(value)) return 'MFA code must be 6 digits';
        return true;
      }
    });

    const code2 = await this.input('Second MFA code (6 digits):', {
      validate: (value) => {
        if (!/^\d{6}$/.test(value)) return 'MFA code must be 6 digits';
        if (value === code1) return 'Second code must be different from first';
        return true;
      }
    });

    this.showProgress('Enabling MFA device...');

    // Import AWS command execution
    const { execAwsCommand } = require('../core/aws');

    const enableResult = execAwsCommand([
      'iam', 'enable-mfa-device',
      '--user-name', username,
      '--serial-number', config.mfa_serial,
      '--authentication-code1', code1,
      '--authentication-code2', code2,
      '--profile', adminProfile
    ]);

    if (!enableResult.success) {
      throw new Error(`Failed to enable MFA device: ${enableResult.stderr}`);
    }

    this.showSuccess('MFA device enabled successfully');
  }

  async configureAdditionalSettings(config) {
    // Default region
    const defaultRegion = await this.autoDiscovery.getDefaultRegion();
    config.region = await this.input('Default AWS Region:', {
      default: config.region || defaultRegion || 'us-east-1',
      placeholder: 'us-east-1'
    });

    // Output format
    config.output = await this.select('Default output format:', [
      { title: 'JSON', value: 'json' },
      { title: 'Table', value: 'table' },
      { title: 'Text', value: 'text' },
      { title: 'YAML', value: 'yaml' }
    ]);

    // CLI pager
    const disablePager = await this.confirm('Disable CLI pager for output?', true);
    if (disablePager) {
      config.cli_pager = '';
    }
  }

  async saveConfiguration(config) {
    try {
      const profileName = config.profileName;
      delete config.profileName;
      delete config.authMethod;

      // Handle SSO session configuration separately
      if (config.sso_session) {
        await this.saveSSOSession(config);
      }

      // Save profile configuration
      for (const [key, value] of Object.entries(config)) {
        if (value !== undefined && value !== null && value !== '') {
          await setProfileConfig(profileName, key, value);
        }
      }

      return true;
    } catch (error) {
      console.error('Error saving configuration:', error);
      return false;
    }
  }

  async saveSSOSession(config) {
    if (!config.sso_session || !config.sso_start_url || !config.sso_region) {
      return;
    }

    // Create SSO session configuration
    const sessionName = config.sso_session;

    // Use AWS CLI to set SSO session
    const { execSync } = require('child_process');

    try {
      // Set SSO session configuration
      execSync(`aws configure set sso-session.${sessionName}.sso_start_url "${config.sso_start_url}"`, { stdio: 'pipe' });
      execSync(`aws configure set sso-session.${sessionName}.sso_region "${config.sso_region}"`, { stdio: 'pipe' });
      execSync(`aws configure set sso-session.${sessionName}.sso_registration_scopes "sso:account:access"`, { stdio: 'pipe' });
    } catch (error) {
      console.warn('Could not set SSO session configuration:', error.message);
    }
  }

  async editProfile(profileName) {
    this.clear();
    this.showBanner('📝 Edit Profile Configuration', `Modifying profile: ${profileName}`);

    const config = await getProfileConfig(profileName);

    if (!config) {
      this.showError(`Profile '${profileName}' not found`);
      return { success: false };
    }

    // Show current configuration
    this.showInfo('Current configuration:');
    console.log(JSON.stringify(config, null, 2));

    const reconfigure = await this.confirm('Do you want to reconfigure this profile?', true);
    if (!reconfigure) {
      return { success: false };
    }

    // Reuse the setup flow with existing profile name
    config.profileName = profileName;
    config.authMethod = await this.detectAuthMethod(config);

    await this.configureAuthMethod(config);
    await this.configureAdditionalSettings(config);

    const saved = await this.saveConfiguration(config);

    if (saved) {
      this.showSuccess(`Profile '${profileName}' updated successfully!`);
      return { success: true, profileName };
    }

    return { success: false };
  }

  detectAuthMethod(config) {
    if (config.sso_start_url || config.sso_session) return 'sso';
    if (config.mfa_serial) return 'mfa';
    if (config.aws_access_key_id && config.aws_secret_access_key) return 'direct';
    return 'unknown';
  }
}

module.exports = SetupWizard;