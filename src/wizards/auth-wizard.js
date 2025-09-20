'use strict';

const BaseWizard = require('./base-wizard');
const { listProfiles } = require('../services/aws-config');
const SmartAuth = require('../services/smart-auth');

/**
 * Authentication wizard for logging into AWS profiles
 */
class AuthWizard extends BaseWizard {
  async run(profileName = null) {
    if (!profileName) {
      // Let user select a profile
      profileName = await this.selectProfile();
      if (!profileName) {
        return { success: false, message: 'No profile selected' };
      }
    }

    this.showProgress(`Authenticating with profile: ${profileName}`);

    // Use smart authentication
    const smartAuth = new SmartAuth();
    const result = await smartAuth.authenticate(profileName);

    if (result.success) {
      this.showSuccess(`Successfully authenticated to profile '${profileName}'!`);

      if (result.expiresIn) {
        this.showInfo(`Session valid for: ${result.expiresIn}`);
      }

      if (result.accountId) {
        this.showInfo(`Account ID: ${result.accountId}`);
      }

      if (result.role) {
        this.showInfo(`Role: ${result.role}`);
      }
    } else {
      this.showError(`Authentication failed: ${result.message}`);

      // Offer to reconfigure the profile
      const reconfigure = await this.confirm('Would you like to reconfigure this profile?');
      if (reconfigure) {
        const SetupWizard = require('./setup-wizard');
        const setupWizard = new SetupWizard();
        return setupWizard.editProfile(profileName);
      }
    }

    return result;
  }

  async selectProfile() {
    const profileNames = await listProfiles();

    if (!profileNames || profileNames.length === 0) {
      this.showWarning('No profiles found. Please set up a profile first.');

      const setup = await this.confirm('Would you like to set up a new profile?');
      if (setup) {
        const SetupWizard = require('./setup-wizard');
        const setupWizard = new SetupWizard();
        const result = await setupWizard.run();
        if (result.success && result.profileName) {
          return result.profileName;
        }
      }
      return null;
    }

    // Format profiles for selection
    const choices = profileNames.map(profileName => {
      return {
        title: profileName,
        value: profileName,
        description: 'AWS Profile'
      };
    });

    // Add option to go back
    choices.push({
      title: '🔙 Back to main menu',
      value: null,
      description: 'Return to the main menu'
    });

    return this.select('Select a profile to authenticate:', choices);
  }
}

module.exports = AuthWizard;