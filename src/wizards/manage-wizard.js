'use strict';

const BaseWizard = require('./base-wizard');
const { getProfiles, getProfileConfig } = require('../services/profile-service');
const { setProfileConfig } = require('../services/aws-config');
const { execSync } = require('child_process');
const { validateSession } = require('../core/session');

/**
 * Profile management wizard
 */
class ManageWizard extends BaseWizard {
  async run() {
    this.clear();
    this.showBanner('📋 Profile Management', 'Manage your AWS profiles');

    const profiles = await getProfiles();

    if (!profiles || profiles.length === 0) {
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
        return this.listProfiles(profiles);
      case 'details':
        return this.showProfileDetails(profiles);
      case 'edit':
        return this.editProfile(profiles);
      case 'delete':
        return this.deleteProfile(profiles);
      case 'refresh':
        return this.refreshCredentials(profiles);
      case 'clean':
        return this.cleanExpiredSessions(profiles);
      case 'org':
        return this.setupOrganizationProfiles();
      case 'export':
        return this.exportProfiles(profiles);
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

  async listProfiles(profiles) {
    this.showBanner('📝 Profile List', `Found ${profiles.length} profile(s)`);

    for (const profile of profiles) {
      const info = [];

      // Determine auth type
      if (profile.sso_start_url || profile.sso_session) {
        info.push('🏢 SSO');
      } else if (profile.mfa_serial) {
        info.push('📱 MFA');
      } else if (profile.aws_access_key_id) {
        info.push('🔑 Direct');
      } else if (profile.source_profile) {
        info.push('🔄 Sub-profile');
      }

      // Check session status
      const session = await validateSession(profile.name).catch(() => null);
      if (session && session.isValid) {
        info.push('✅ Active');
        if (session.expiresIn) {
          info.push(`(${session.expiresIn})`);
        }
      } else {
        info.push('❌ Expired');
      }

      // Region
      if (profile.region) {
        info.push(profile.region);
      }

      console.log(`• ${profile.name}: ${info.join(' ')}`);
    }

    await this.confirm('\nPress Enter to continue...');
    return this.run();
  }

  async showProfileDetails(profiles) {
    const profileName = await this.selectProfile(profiles);
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
    const session = await validateSession(profileName).catch(() => null);
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

  async editProfile(profiles) {
    const profileName = await this.selectProfile(profiles);
    if (!profileName) return this.run();

    const SetupWizard = require('./setup-wizard');
    const setupWizard = new SetupWizard();
    const result = await setupWizard.editProfile(profileName);

    if (result.success) {
      this.showSuccess(`Profile '${profileName}' updated successfully!`);
    }

    return this.run();
  }

  async deleteProfile(profiles) {
    const profileName = await this.selectProfile(profiles);
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

  async refreshCredentials(profiles) {
    const profileName = await this.selectProfile(profiles);
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

  async cleanExpiredSessions(profiles) {
    this.showProgress('Checking for expired sessions...');

    let cleanedCount = 0;

    for (const profile of profiles) {
      const session = await validateSession(profile.name).catch(() => null);

      if (!session || !session.isValid) {
        // Check if profile has temporary credentials
        const config = await getProfileConfig(profile.name);

        if (config.aws_session_token || config.aws_expiration) {
          try {
            // Remove temporary credentials
            await setProfileConfig(profile.name, 'aws_session_token', '');
            await setProfileConfig(profile.name, 'aws_expiration', '');

            console.log(`  ✓ Cleaned expired session for '${profile.name}'`);
            cleanedCount++;
          } catch (error) {
            console.log(`  ✗ Failed to clean '${profile.name}': ${error.message}`);
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
    const profiles = await getProfiles();
    const ssoProfiles = profiles.filter(p => p.sso_start_url || p.sso_session);

    if (ssoProfiles.length === 0) {
      this.showError('No SSO profiles found. Please set up an SSO profile first.');
      await this.confirm('Press Enter to continue...');
      return this.run();
    }

    const baseProfile = await this.select(
      'Select base SSO profile:',
      ssoProfiles.map(p => ({ title: p.name, value: p.name }))
    );

    this.showProgress('Retrieving organization accounts...');

    try {
      // Get all accounts in the organization
      const result = execSync(
        `aws organizations list-accounts --profile ${baseProfile} --query "Accounts[?Status=='ACTIVE'].{Id:Id,Name:Name}" --output json`,
        { stdio: 'pipe', encoding: 'utf8' }
      );

      const accounts = JSON.parse(result);

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

  async exportProfiles(profiles) {
    this.showBanner('📤 Export Profiles', 'Export profile configurations');

    const format = await this.select('Select export format:', [
      { title: 'JSON', value: 'json', description: 'JSON format for backup' },
      { title: 'Shell script', value: 'shell', description: 'Bash script to recreate profiles' },
      { title: 'Documentation', value: 'docs', description: 'Markdown documentation' }
    ]);

    const includeSecrets = await this.confirm('Include sensitive data (access keys)?', false);

    const exportData = [];

    for (const profile of profiles) {
      const config = await getProfileConfig(profile.name);

      // Remove sensitive data if requested
      if (!includeSecrets) {
        delete config.aws_access_key_id;
        delete config.aws_secret_access_key;
        delete config.aws_session_token;
      }

      exportData.push({
        name: profile.name,
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

  async selectProfile(profiles) {
    const choices = profiles.map(p => ({
      title: p.name,
      value: p.name
    }));

    choices.push({
      title: '🔙 Cancel',
      value: null
    });

    return this.select('Select a profile:', choices);
  }

  async getExistingProfiles() {
    const profiles = await getProfiles();
    return profiles.map(p => p.name);
  }

  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

module.exports = ManageWizard;