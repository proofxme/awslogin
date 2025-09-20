'use strict';

const BaseWizard = require('./base-wizard');
const { listProfiles, getProfileConfig, setProfileConfig } = require('../services/aws-config');
const { execSync } = require('child_process');
const { validateSession } = require('../core/session');
const { execAwsCommand } = require('../core/aws');

/**
 * Profile management wizard
 */
class ManageWizard extends BaseWizard {
  async run() {
    this.clear();
    this.showBanner('📋 Profile Management', 'Manage your AWS profiles');

    const profileNames = await listProfiles();

    if (!profileNames || profileNames.length === 0) {
      this.showWarning('No profiles found.');
      const create = await this.confirm('Would you like to create a new profile?');
      if (create) {
        const SetupWizard = require('./setup-wizard');
        const setupWizard = new SetupWizard();
        return setupWizard.run();
      }
      return { success: false };
    }

    const action = await this.selectAction();

    switch (action) {
      case 'list':
        return this.listProfiles(profileNames);
      case 'details':
        return this.showProfileDetails(profileNames);
      case 'edit':
        return this.editProfile(profileNames);
      case 'delete':
        return this.deleteProfile(profileNames);
      case 'refresh':
        return this.refreshCredentials(profileNames);
      case 'clean':
        return this.cleanExpiredSessions(profileNames);
      case 'org':
        return this.setupOrganizationProfiles();
      case 'subprofile':
        return this.createSubProfile(profileNames);
      case 'export':
        return this.exportProfiles(profileNames);
      case 'back':
        const MainWizard = require('./main-wizard');
        const mainWizard = new MainWizard();
        return mainWizard.run();
    }
  }

  async selectAction() {
    const choices = [
      {
        title: '📝 List all profiles',
        value: 'list',
        description: 'Show all configured profiles'
      },
      {
        title: '📊 Show profile details',
        value: 'details',
        description: 'View detailed configuration of a profile'
      },
      {
        title: '✏️  Edit profile',
        value: 'edit',
        description: 'Modify profile configuration'
      },
      {
        title: '🗑️  Delete profile',
        value: 'delete',
        description: 'Remove a profile'
      },
      {
        title: '🔄 Refresh credentials',
        value: 'refresh',
        description: 'Refresh expired credentials'
      },
      {
        title: '🧹 Clean expired sessions',
        value: 'clean',
        description: 'Remove all expired credentials'
      },
      {
        title: '🏢 Setup organization profiles',
        value: 'org',
        description: 'Create profiles for all organization accounts'
      },
      {
        title: '👥 Create sub-profile',
        value: 'subprofile',
        description: 'Create a sub-profile from existing SSO profile'
      },
      {
        title: '📤 Export profiles',
        value: 'export',
        description: 'Export profile configurations'
      },
      {
        title: '🔙 Back to main menu',
        value: 'back',
        description: 'Return to main menu'
      }
    ];

    return this.select('What would you like to do?', choices);
  }

  async listProfiles(profileNames) {
    this.showBanner('📝 Profile List', `Found ${profileNames.length} profile(s)`);

    // Step 1: Display profiles immediately with just config info (fast)
    const profilesInfo = [];

    for (const profileName of profileNames) {
      const info = [];

      // Get config quickly (this is fast - just reads from file)
      const profile = await getProfileConfig(profileName);

      // Determine auth type
      if (profile && profile.sso_start_url || profile && profile.sso_session) {
        info.push('🏢 SSO');
      } else if (profile && profile.mfa_serial) {
        info.push('📱 MFA');
      } else if (profile && profile.aws_access_key_id) {
        info.push('🔑 Direct');
      } else if (profile && profile.source_profile) {
        info.push('🔄 Sub-profile');
      } else {
        info.push('❓ Unknown');
      }

      // Add region if available
      if (profile && profile.region) {
        info.push(profile.region);
      }

      // Store for validation
      profilesInfo.push({ profileName, info, profile });

      // Display profile immediately without session status
      console.log(`• ${profileName}: ${info.join(' ')}`);
    }

    // Step 2: Quick check for cached credentials (fast)
    console.log('\n📊 Session Status (based on cached credentials):');
    console.log('─'.repeat(50));

    let activeCount = 0;
    let expiredCount = 0;
    let unknownCount = 0;

    for (const { profileName, profile } of profilesInfo) {
      // Quick check - just look for session token or expiration in config
      if (profile && profile.aws_session_token) {
        // Has a session token - check expiration
        if (profile.aws_expiration || profile.aws_session_expiration) {
          const expStr = profile.aws_expiration || profile.aws_session_expiration;
          const expTime = new Date(expStr);
          const now = new Date();

          if (expTime > now) {
            const hours = Math.floor((expTime - now) / (1000 * 60 * 60));
            const mins = Math.floor(((expTime - now) % (1000 * 60 * 60)) / (1000 * 60));
            console.log(`  ✅ ${profileName}: Active (expires in ${hours}h ${mins}m)`);
            activeCount++;
          } else {
            console.log(`  ❌ ${profileName}: Expired`);
            expiredCount++;
          }
        } else {
          console.log(`  ✅ ${profileName}: Has session token`);
          activeCount++;
        }
      } else if (profile && (profile.aws_access_key_id || profile.sso_start_url)) {
        // Has credentials but no session - these don't expire
        console.log(`  🔐 ${profileName}: Credentials configured`);
        unknownCount++;
      } else {
        console.log(`  ❓ ${profileName}: No credentials`);
        unknownCount++;
      }
    }

    console.log('─'.repeat(50));
    console.log(`Summary: ${activeCount} active sessions, ${expiredCount} expired, ${unknownCount} configured`);
    console.log('\n💡 Tip: Use "awslogin <profile>" to refresh expired sessions');

    await this.confirm('Press Enter to continue...');
    return this.run();
  }

  async showProfileDetails(profileNames) {
    const profileName = await this.selectProfile(profileNames);
    if (!profileName) return this.run();

    const config = await getProfileConfig(profileName);

    this.showBanner('📊 Profile Details', profileName);

    // Format and display configuration
    const sensitiveKeys = ['aws_secret_access_key', 'aws_session_token'];

    for (const [key, value] of Object.entries(config)) {
      if (sensitiveKeys.includes(key)) {
        console.log(`  ${key}: ****`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }

    // Check session validity
    let session;
    try {
      session = validateSession(profileName);
    } catch {
      session = null;
    }
    console.log('\nSession Status:');
    if (session && session.isValid) {
      console.log('  ✅ Valid');
      if (session.expiresIn) {
        console.log(`  ⏱️  Expires in: ${session.expiresIn}`);
      }
    } else {
      console.log('  ❌ Expired or Invalid');
    }

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async editProfile(profileNames) {
    const profileName = await this.selectProfile(profileNames);
    if (!profileName) return this.run();

    const SetupWizard = require('./setup-wizard');
    const setupWizard = new SetupWizard();
    const result = await setupWizard.editProfile(profileName);

    if (result.success) {
      this.showSuccess(`Profile '${profileName}' updated successfully!`);
    }

    return this.run();
  }

  async deleteProfile(profileNames) {
    const profileName = await this.selectProfile(profileNames);
    if (!profileName) return this.run();

    this.showWarning(`This will permanently delete profile '${profileName}'`);
    const confirm = await this.confirm('Are you sure?', false);

    if (!confirm) {
      return this.run();
    }

    try {
      // Remove all configuration keys
      const config = await getProfileConfig(profileName);

      for (const key of Object.keys(config)) {
        execSync(`aws configure set profile.${profileName}.${key} ""`, { stdio: 'pipe' });
      }

      this.showSuccess(`Profile '${profileName}' deleted successfully!`);
    } catch (error) {
      this.showError(`Failed to delete profile: ${error.message}`);
    }

    return this.run();
  }

  async refreshCredentials(profileNames) {
    const profileName = await this.selectProfile(profileNames);
    if (!profileName) return this.run();

    this.showProgress(`Refreshing credentials for '${profileName}'...`);

    const AuthWizard = require('./auth-wizard');
    const authWizard = new AuthWizard();
    const result = await authWizard.run(profileName);

    if (result.success) {
      this.showSuccess('Credentials refreshed successfully!');
    } else {
      this.showError('Failed to refresh credentials');
    }

    return this.run();
  }

  async cleanExpiredSessions(profileNames) {
    this.showProgress('Checking for expired sessions...');

    let cleanedCount = 0;

    for (const profileName of profileNames) {
      let session;
      try {
        session = validateSession(profileName);
      } catch {
        session = null;
      }

      if (!session || !session.isValid) {
        // Check if profile has temporary credentials
        const config = await getProfileConfig(profileName);

        if (config.aws_session_token || config.aws_expiration) {
          try {
            // Remove temporary credentials
            await setProfileConfig(profileName, 'aws_session_token', '');
            await setProfileConfig(profileName, 'aws_expiration', '');

            console.log(`  ✓ Cleaned expired session for '${profileName}'`);
            cleanedCount++;
          } catch (error) {
            console.log(`  ✗ Failed to clean '${profileName}': ${error.message}`);
          }
        }
      }
    }

    if (cleanedCount > 0) {
      this.showSuccess(`Cleaned ${cleanedCount} expired session(s)`);
    } else {
      this.showInfo('No expired sessions found');
    }

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async setupOrganizationProfiles() {
    this.showBanner('🏢 Organization Profile Setup', 'Create profiles for all AWS accounts');

    // Select base profile
    const profileNames = await listProfiles();
    const ssoProfiles = [];
    for (const profileName of profileNames) {
      const config = await getProfileConfig(profileName);
      if (config && (config.sso_start_url || config.sso_session)) {
        ssoProfiles.push(profileName);
      }
    }

    if (ssoProfiles.length === 0) {
      this.showError('No SSO profiles found. Please set up an SSO profile first.');
      await this.confirm('Press Enter to continue...');
      return this.run();
    }

    const baseProfile = await this.select(
      'Select base SSO profile:',
      ssoProfiles.map(p => ({ title: p, value: p }))
    );

    this.showProgress('Retrieving organization accounts...');

    try {
      // Get all accounts in the organization
      const result = execAwsCommand([
        'organizations', 'list-accounts',
        '--profile', baseProfile,
        '--query', "Accounts[?Status=='ACTIVE'].{Id:Id,Name:Name}",
        '--output', 'json'
      ]);

      if (!result.success) {
        throw new Error(result.stderr || 'Failed to list organization accounts');
      }

      const accounts = JSON.parse(result.stdout);

      if (!accounts || accounts.length === 0) {
        this.showError('No active accounts found in the organization');
        await this.confirm('Press Enter to continue...');
        return this.run();
      }

      this.showInfo(`Found ${accounts.length} active account(s)`);

      // Get base profile configuration
      const baseConfig = await getProfileConfig(baseProfile);

      let createdCount = 0;

      for (const account of accounts) {
        const profileName = `${baseProfile}-${this.slugify(account.Name)}`;

        // Check if profile already exists
        const existingProfiles = await this.getExistingProfiles();
        if (existingProfiles.includes(profileName)) {
          console.log(`  ⊘ Profile '${profileName}' already exists, skipping`);
          continue;
        }

        // Create sub-profile configuration
        const config = {
          sso_account_id: account.Id,
          sso_role_name: baseConfig.sso_role_name || 'AdministratorAccess',
          region: baseConfig.region || 'us-east-1',
          output: baseConfig.output || 'json'
        };

        // Copy SSO configuration
        if (baseConfig.sso_session) {
          config.sso_session = baseConfig.sso_session;
        } else {
          config.sso_start_url = baseConfig.sso_start_url;
          config.sso_region = baseConfig.sso_region;
        }

        // Save profile
        for (const [key, value] of Object.entries(config)) {
          await setProfileConfig(profileName, key, value);
        }

        console.log(`  ✓ Created profile '${profileName}' for account ${account.Name}`);
        createdCount++;
      }

      this.showSuccess(`Created ${createdCount} new profile(s)`);
    } catch (error) {
      this.showError(`Failed to retrieve organization accounts: ${error.message}`);
      this.showInfo('Make sure you have organizations:ListAccounts permission');
    }

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async createSubProfile(profileNames) {
    this.showBanner('👥 Sub-Profile Creation', 'Create a sub-profile for specific account access');

    // Find SSO profiles to use as parent
    const ssoProfiles = [];
    for (const profileName of profileNames) {
      const config = await getProfileConfig(profileName);
      if (config && (config.sso_start_url || config.sso_session)) {
        ssoProfiles.push(profileName);
      }
    }

    if (ssoProfiles.length === 0) {
      this.showError('No SSO profiles found. Sub-profiles require an SSO parent profile.');
      await this.confirm('Press Enter to continue...');
      return this.run();
    }

    this.showInfo('📋 Sub-Profile Guide:');
    this.showInfo('Sub-profiles inherit SSO settings from a parent profile but target specific AWS accounts.');
    this.showInfo('Benefits: Single sign-on, account-specific access, organized profile management.');

    // Select parent profile
    const parentProfile = await this.select(
      'Select parent SSO profile:',
      ssoProfiles.map(p => ({ title: p, value: p }))
    );

    const parentConfig = await getProfileConfig(parentProfile);

    // Get sub-profile name
    let subProfileName;
    let isValid = false;
    while (!isValid) {
      subProfileName = await this.input('Enter sub-profile name:', {
        placeholder: `${parentProfile}-account-name`,
        validate: (value) => {
          if (!value) return 'Sub-profile name is required';
          if (value === parentProfile) return 'Sub-profile name must be different from parent';
          return true;
        }
      });

      if (profileNames.includes(subProfileName)) {
        const overwrite = await this.confirm(`Profile '${subProfileName}' already exists. Overwrite?`, false);
        if (overwrite) {
          isValid = true;
        }
      } else {
        isValid = true;
      }
    }

    // Get AWS Account ID
    const accountId = await this.input('AWS Account ID:', {
      placeholder: '123456789012',
      validate: (value) => {
        if (!value) return 'Account ID is required';
        if (!/^\d{12}$/.test(value)) return 'Account ID must be 12 digits';
        return true;
      }
    });

    // Get role name
    const roleName = await this.input('Role name:', {
      default: parentConfig.sso_role_name || 'AdministratorAccess',
      placeholder: 'AdministratorAccess'
    });

    // Create sub-profile configuration
    const subConfig = {
      sso_account_id: accountId,
      sso_role_name: roleName,
      region: parentConfig.region || 'us-east-1',
      output: parentConfig.output || 'json'
    };

    // Copy SSO configuration from parent
    if (parentConfig.sso_session) {
      subConfig.sso_session = parentConfig.sso_session;
    } else {
      subConfig.sso_start_url = parentConfig.sso_start_url;
      subConfig.sso_region = parentConfig.sso_region;
    }

    // Save sub-profile
    this.showProgress('Creating sub-profile...');
    try {
      for (const [key, value] of Object.entries(subConfig)) {
        await setProfileConfig(subProfileName, key, value);
      }

      this.showSuccess(`Sub-profile '${subProfileName}' created successfully!`);
      this.showInfo(`Parent profile: ${parentProfile}`);
      this.showInfo(`Target account: ${accountId}`);
      this.showInfo(`Role: ${roleName}`);

      // Offer to test authentication
      const testAuth = await this.confirm('Test authentication to this sub-profile?', true);
      if (testAuth) {
        const AuthWizard = require('./auth-wizard');
        const authWizard = new AuthWizard();
        await authWizard.run(subProfileName);
      }

    } catch (error) {
      this.showError(`Failed to create sub-profile: ${error.message}`);
    }

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async exportProfiles(profileNames) {
    this.showBanner('📤 Export Profiles', 'Export profile configurations');

    const format = await this.select('Select export format:', [
      { title: 'JSON', value: 'json', description: 'JSON format for backup' },
      { title: 'Shell script', value: 'shell', description: 'Bash script to recreate profiles' },
      { title: 'Documentation', value: 'docs', description: 'Markdown documentation' }
    ]);

    const includeSecrets = await this.confirm('Include sensitive data (access keys)?', false);

    const exportData = [];

    for (const profileName of profileNames) {
      const config = await getProfileConfig(profileName);

      // Remove sensitive data if requested
      if (!includeSecrets) {
        delete config.aws_access_key_id;
        delete config.aws_secret_access_key;
        delete config.aws_session_token;
      }

      exportData.push({
        name: profileName,
        config
      });
    }

    let output;

    switch (format) {
      case 'json':
        output = JSON.stringify(exportData, null, 2);
        break;

      case 'shell':
        output = '#!/bin/bash\n\n# AWS Profile Recreation Script\n\n';
        for (const profile of exportData) {
          output += `# Profile: ${profile.name}\n`;
          for (const [key, value] of Object.entries(profile.config)) {
            if (value) {
              output += `aws configure set profile.${profile.name}.${key} "${value}"\n`;
            }
          }
          output += '\n';
        }
        break;

      case 'docs':
        output = '# AWS Profile Documentation\n\n';
        for (const profile of exportData) {
          output += `## Profile: ${profile.name}\n\n`;
          output += '```\n';
          for (const [key, value] of Object.entries(profile.config)) {
            if (value) {
              output += `${key}: ${value}\n`;
            }
          }
          output += '```\n\n';
        }
        break;
    }

    const filename = `aws-profiles-export-${Date.now()}.${format === 'shell' ? 'sh' : format === 'docs' ? 'md' : 'json'}`;

    require('fs').writeFileSync(filename, output);
    this.showSuccess(`Profiles exported to ${filename}`);

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async selectProfile(profileNames) {
    const choices = profileNames.map(p => ({
      title: p,
      value: p
    }));

    choices.push({
      title: '🔙 Cancel',
      value: null
    });

    return this.select('Select a profile:', choices);
  }

  async getExistingProfiles() {
    const profileNames = await listProfiles();
    return profileNames;
  }

  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

module.exports = ManageWizard;