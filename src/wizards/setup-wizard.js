'use strict';

const BaseWizard = require('./base-wizard');
const { setProfileConfig, getProfileConfig } = require('../services/aws-config');
const { checkCommand } = require('../core/aws');
const { prompt } = require('../core/prompt');
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
    this.showBanner('⚙️  AWS Profile Setup Wizard', 'Configure a new AWS profile');

    const config = {};

    // Step 1: Profile name
    this.currentStep = 0;
    this.showProgress('Profile Name');
    config.profileName = await this.getProfileName();

    // Step 2: Authentication method
    this.currentStep = 1;
    this.showProgress('Authentication Method');
    config.authMethod = await this.selectAuthMethod();

    // Step 3: Configuration based on method
    this.currentStep = 2;
    this.showProgress('Configuration');
    await this.configureAuthMethod(config);

    // Step 4: Additional settings
    this.currentStep = 3;
    this.showProgress('Additional Settings');
    await this.configureAdditionalSettings(config);

    // Step 5: Save configuration
    this.currentStep = 4;
    this.showProgress('Saving Configuration');
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
    // Check for template preference
    const useTemplate = await this.confirm('Would you like to use a profile template?', false);

    if (useTemplate) {
      return this.selectTemplate();
    }

    const choices = [
      {
        title: '🏢 AWS SSO / Identity Center',
        value: 'sso',
        description: 'Recommended for organizations using AWS SSO'
      },
      {
        title: '📱 MFA with long-term credentials',
        value: 'mfa',
        description: 'Traditional IAM users with MFA device'
      },
      {
        title: '🔑 Direct credentials',
        value: 'direct',
        description: 'For development/testing only (not recommended for production)'
      },
      {
        title: '🔄 Import from existing profile',
        value: 'import',
        description: 'Copy settings from another profile'
      }
    ];

    return this.select('How do you authenticate to AWS?', choices);
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
        await this.configureSS0(config);
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

  async configureSS0(config) {
    this.showInfo('Configuring AWS SSO / Identity Center authentication');

    // Try to auto-discover SSO URL
    const discoveredUrl = await this.autoDiscovery.discoverSSOUrl();

    if (discoveredUrl) {
      this.showInfo(`Found existing SSO URL: ${discoveredUrl}`);
      const useDiscovered = await this.confirm('Use this SSO URL?', true);
      if (useDiscovered) {
        config.sso_start_url = discoveredUrl;
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

    const itemName = await this.input('1Password item name containing MFA secret:', {
      placeholder: 'AWS MFA - ' + config.profileName
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