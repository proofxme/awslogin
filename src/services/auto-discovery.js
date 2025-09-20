'use strict';

const { execSync } = require('child_process');
const { getProfiles, getProfileConfig } = require('./profile-service');

/**
 * Auto-discovery service for AWS configuration
 */
class AutoDiscovery {
  /**
   * Discover SSO start URL from existing profiles
   */
  async discoverSSOUrl() {
    try {
      const profiles = await getProfiles();

      const ssoUrls = new Set();

      for (const profile of profiles) {
        if (profile.sso_start_url) {
          ssoUrls.add(profile.sso_start_url);
        }

        // Check SSO session configuration
        if (profile.sso_session) {
          try {
            const sessionUrl = execSync(
              `aws configure get sso-session.${profile.sso_session}.sso_start_url`,
              { stdio: 'pipe', encoding: 'utf8' }
            ).trim();
            if (sessionUrl) {
              ssoUrls.add(sessionUrl);
            }
          } catch {
            // Session not found
          }
        }
      }

      // If only one SSO URL found, return it
      if (ssoUrls.size === 1) {
        return Array.from(ssoUrls)[0];
      }

      // If multiple, return the most common one
      if (ssoUrls.size > 1) {
        const urlCounts = {};
        for (const profile of profiles) {
          if (profile.sso_start_url) {
            urlCounts[profile.sso_start_url] = (urlCounts[profile.sso_start_url] || 0) + 1;
          }
        }

        const sortedUrls = Object.entries(urlCounts)
          .sort((a, b) => b[1] - a[1]);

        return sortedUrls[0][0];
      }

      return null;
    } catch (error) {
      console.debug('Error discovering SSO URL:', error.message);
      return null;
    }
  }

  /**
   * Discover AWS Organization information
   */
  async discoverOrganization(profileName = null) {
    try {
      const profileArg = profileName ? `--profile ${profileName}` : '';
      const result = execSync(
        `aws organizations describe-organization ${profileArg}`,
        { stdio: 'pipe', encoding: 'utf8' }
      );

      const org = JSON.parse(result);
      return org.Organization;
    } catch (error) {
      console.debug('Could not discover organization:', error.message);
      return null;
    }
  }

  /**
   * Discover available AWS accounts through SSO
   */
  async discoverSSOAccounts(ssoUrl, ssoRegion) {
    try {
      // First, ensure we have an SSO token
      execSync(
        `aws sso login --sso-session temp-discovery || aws sso login`,
        { stdio: 'pipe' }
      );

      const result = execSync(
        `aws sso list-accounts --access-token $(aws sso login --sso-session temp-discovery) --region ${ssoRegion}`,
        { stdio: 'pipe', encoding: 'utf8' }
      );

      const response = JSON.parse(result);
      return response.accountList || [];
    } catch (error) {
      console.debug('Could not discover SSO accounts:', error.message);
      return [];
    }
  }

  /**
   * Get default region from environment or existing profiles
   */
  async getDefaultRegion() {
    // Check environment variable first
    if (process.env.AWS_DEFAULT_REGION) {
      return process.env.AWS_DEFAULT_REGION;
    }

    if (process.env.AWS_REGION) {
      return process.env.AWS_REGION;
    }

    // Check default profile
    try {
      const defaultRegion = execSync(
        'aws configure get region',
        { stdio: 'pipe', encoding: 'utf8' }
      ).trim();

      if (defaultRegion) {
        return defaultRegion;
      }
    } catch {
      // No default region set
    }

    // Check most common region in existing profiles
    try {
      const profiles = await getProfiles();
      const regionCounts = {};

      for (const profile of profiles) {
        if (profile.region) {
          regionCounts[profile.region] = (regionCounts[profile.region] || 0) + 1;
        }
      }

      if (Object.keys(regionCounts).length > 0) {
        const sortedRegions = Object.entries(regionCounts)
          .sort((a, b) => b[1] - a[1]);
        return sortedRegions[0][0];
      }
    } catch {
      // Error getting profiles
    }

    // Default to us-east-1
    return 'us-east-1';
  }

  /**
   * Get list of existing profile names
   */
  async getExistingProfiles() {
    try {
      const profiles = await getProfiles();
      return profiles.map(p => p.name);
    } catch {
      return [];
    }
  }

  /**
   * Detect if running in CI/CD environment
   */
  isCI() {
    return !!(
      process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.CIRCLECI ||
      process.env.JENKINS_URL ||
      process.env.TEAMCITY_VERSION ||
      process.env.TF_BUILD ||
      process.env.BUILDKITE
    );
  }

  /**
   * Detect if 1Password CLI is available
   */
  async has1PasswordCLI() {
    try {
      execSync('op --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if 1Password is signed in
   */
  async is1PasswordSignedIn() {
    try {
      execSync('op account list', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available MFA devices for a profile
   */
  async getMFADevices(profileName) {
    try {
      const result = execSync(
        `aws iam list-mfa-devices --profile ${profileName}`,
        { stdio: 'pipe', encoding: 'utf8' }
      );

      const response = JSON.parse(result);
      return response.MFADevices || [];
    } catch {
      return [];
    }
  }

  /**
   * Detect profile type from configuration
   */
  async detectProfileType(profileConfig) {
    if (profileConfig.sso_start_url || profileConfig.sso_session) {
      return 'sso';
    }

    if (profileConfig.mfa_serial) {
      return 'mfa';
    }

    if (profileConfig.role_arn && profileConfig.source_profile) {
      return 'assume-role';
    }

    if (profileConfig.aws_access_key_id && profileConfig.aws_secret_access_key) {
      return 'direct';
    }

    return 'unknown';
  }

  /**
   * Get suggested role names based on common patterns
   */
  getSuggestedRoles() {
    return [
      'AdministratorAccess',
      'PowerUserAccess',
      'DeveloperAccess',
      'ReadOnlyAccess',
      'ViewOnlyAccess',
      'SecurityAudit',
      'SystemAdministrator',
      'DatabaseAdministrator',
      'DataScientist',
      'Billing'
    ];
  }
}

module.exports = AutoDiscovery;