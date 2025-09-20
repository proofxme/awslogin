'use strict';

const { getProfileConfig } = require('./aws-config');
const { authenticateSSO } = require('./sso');
const { authenticateMFA } = require('./mfa');
const { validateSession } = require('../core/session');
const { prompt } = require('../core/prompt');

/**
 * Smart authentication that auto-detects the best authentication method
 */
class SmartAuth {
  async authenticate(profileName, options = {}) {
    console.log(`\n🔍 Analyzing profile '${profileName}'...`);

    // Detect authentication method
    const method = await this.detectAuthMethod(profileName);
    console.log(`📊 Detected authentication method: ${this.getMethodDisplay(method)}`);

    // Check if session is still valid
    if (!options.force) {
      const sessionValid = await this.checkExistingSession(profileName);
      if (sessionValid) {
        console.log('✅ Existing session is still valid!');
        const config = await getProfileConfig(profileName);
        return {
          success: true,
          profileName,
          method,
          expiresIn: this.getSessionExpiry(config),
          accountId: config.sso_account_id || config.account_id,
          role: config.sso_role_name || config.role_arn
        };
      }
    }

    // Use appropriate authentication flow
    switch (method) {
      case 'sso':
        return this.ssoFlow(profileName, options);
      case 'mfa':
        return this.mfaFlow(profileName, options);
      case 'direct':
        return this.directFlow(profileName, options);
      case 'parent-sso':
        return this.parentSSOFlow(profileName, options);
      default:
        return this.wizardFlow(profileName, options);
    }
  }

  async detectAuthMethod(profileName) {
    try {
      const config = await getProfileConfig(profileName);

      // Check for parent SSO profile
      if (config.credential_source === 'profile' && config.source_profile) {
        const parentConfig = await getProfileConfig(config.source_profile);
        if (parentConfig.sso_start_url || parentConfig.sso_session) {
          return 'parent-sso';
        }
      }

      // Check for SSO configuration
      if (config.sso_start_url || config.sso_session) {
        return 'sso';
      }

      // Check for MFA configuration
      if (config.mfa_serial) {
        return 'mfa';
      }

      // Check for direct credentials
      if (config.aws_access_key_id && config.aws_secret_access_key) {
        return 'direct';
      }

      // Check for role assumption
      if (config.role_arn && config.source_profile) {
        return 'assume-role';
      }

      return 'unknown';
    } catch (error) {
      console.log(`⚠️  Could not detect auth method: ${error.message}`);
      return 'unknown';
    }
  }

  getMethodDisplay(method) {
    const displays = {
      'sso': '🏢 AWS SSO / Identity Center',
      'mfa': '📱 Multi-Factor Authentication',
      'direct': '🔑 Direct Credentials',
      'parent-sso': '🔄 Sub-profile (SSO)',
      'assume-role': '🎭 Role Assumption',
      'unknown': '❓ Unknown'
    };
    return displays[method] || method;
  }

  async checkExistingSession(profileName) {
    try {
      const result = await validateSession(profileName);
      return result && result.isValid;
    } catch {
      return false;
    }
  }

  getSessionExpiry(config) {
    if (config.aws_expiration) {
      const expiry = new Date(config.aws_expiration);
      const now = new Date();
      if (expiry > now) {
        const hours = Math.floor((expiry - now) / 1000 / 60 / 60);
        const minutes = Math.floor(((expiry - now) / 1000 / 60) % 60);
        return `${hours}h ${minutes}m`;
      }
    }
    return null;
  }

  async ssoFlow(profileName, options = {}) {
    console.log('\n🏢 Starting SSO authentication...');

    try {
      const result = await authenticateSSO(profileName, options);

      if (result.success) {
        console.log('✅ SSO authentication successful!');

        // Offer to select account if --select wasn't provided
        if (!options.select && result.accounts && result.accounts.length > 1) {
          const selectAccount = await prompt.confirm(
            'Multiple accounts available. Would you like to select one?',
            false
          );
          if (selectAccount) {
            return authenticateSSO(profileName, { ...options, select: true });
          }
        }
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: `SSO authentication failed: ${error.message}`
      };
    }
  }

  async mfaFlow(profileName, options = {}) {
    console.log('\n📱 Starting MFA authentication...');

    try {
      const result = await authenticateMFA(profileName, options.token);

      if (result.success) {
        console.log('✅ MFA authentication successful!');
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: `MFA authentication failed: ${error.message}`
      };
    }
  }

  async directFlow(profileName, options = {}) {
    console.log('\n🔑 Using direct credentials...');

    // Direct credentials don't need authentication, just validation
    const valid = await this.checkExistingSession(profileName);

    if (valid) {
      const config = await getProfileConfig(profileName);
      return {
        success: true,
        profileName,
        method: 'direct',
        accountId: config.account_id
      };
    }

    return {
      success: false,
      message: 'Direct credentials are not valid or expired'
    };
  }

  async parentSSOFlow(profileName, options = {}) {
    console.log('\n🔄 Using parent SSO session...');

    const config = await getProfileConfig(profileName);
    const parentProfile = config.source_profile;

    console.log(`📍 Parent profile: ${parentProfile}`);

    // First ensure parent is authenticated
    const parentResult = await this.authenticate(parentProfile, { force: false });

    if (!parentResult.success) {
      return {
        success: false,
        message: `Parent profile '${parentProfile}' authentication failed`
      };
    }

    // Sub-profile should now work with parent's session
    const valid = await this.checkExistingSession(profileName);

    if (valid) {
      return {
        success: true,
        profileName,
        method: 'parent-sso',
        parentProfile,
        accountId: config.sso_account_id || config.account_id,
        role: config.sso_role_name || config.role_arn
      };
    }

    return {
      success: false,
      message: 'Could not authenticate using parent SSO session'
    };
  }

  async wizardFlow(profileName, options = {}) {
    console.log('\n❓ Profile configuration not recognized.');

    const choices = [
      {
        title: '🔧 Configure this profile',
        value: 'configure',
        description: 'Set up authentication for this profile'
      },
      {
        title: '🔄 Try another profile',
        value: 'another',
        description: 'Select a different profile'
      },
      {
        title: '❌ Cancel',
        value: 'cancel',
        description: 'Exit without authenticating'
      }
    ];

    const action = await prompt.select('What would you like to do?', choices);

    switch (action) {
      case 'configure': {
        const SetupWizard = require('../wizards/setup-wizard');
        const setupWizard = new SetupWizard();
        const result = await setupWizard.editProfile(profileName);
        if (result.success) {
          // Try authentication again after configuration
          return this.authenticate(profileName, options);
        }
        return result;
      }

      case 'another': {
        const AuthWizard = require('../wizards/auth-wizard');
        const authWizard = new AuthWizard();
        return authWizard.run();
      }

      default:
        return {
          success: false,
          message: 'Authentication cancelled'
        };
    }
  }
}

module.exports = SmartAuth;