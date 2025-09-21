'use strict';

/**
 * Identity Center Tests
 */

module.exports = async function(test) {
  test.describe('Identity Center', () => {
    let identityCenterService;
    let mockAWS, mockPrompt;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockPrompt = global.mockPrompt;

      mockAWS.reset();
      mockPrompt.reset();

      // Mock Identity Center service
      identityCenterService = {
        setupCrossAccount: async function(parentProfile) {
          const parentData = mockAWS.profiles.get(parentProfile);
          if (!parentData || !parentData.sso_start_url) {
            throw new Error('Parent profile must be an SSO profile');
          }

          // List available accounts
          const accounts = await this.listAccounts(parentProfile);

          // Select accounts
          const selectedAccounts = await this.selectAccounts(accounts);

          // Create sub-profiles
          const createdProfiles = [];
          for (const account of selectedAccounts) {
            const profileName = await this.createSubProfile(
              parentProfile,
              account.accountId,
              account.accountName
            );
            createdProfiles.push(profileName);
          }

          return createdProfiles;
        },

        listAccounts: async function(profile) {
          // Ensure SSO session
          if (!mockAWS.ssoSessions.has(profile)) {
            throw new Error('SSO login required');
          }

          // Simulate account list from SSO
          return [
            {
              accountId: '111111111111',
              accountName: 'Development',
              emailAddress: 'dev@company.com',
              status: 'ACTIVE'
            },
            {
              accountId: '222222222222',
              accountName: 'Staging',
              emailAddress: 'staging@company.com',
              status: 'ACTIVE'
            },
            {
              accountId: '333333333333',
              accountName: 'Production',
              emailAddress: 'prod@company.com',
              status: 'ACTIVE'
            }
          ];
        },

        selectAccounts: async function(accounts) {
          const choices = accounts.map(acc => ({
            title: `${acc.accountName} (${acc.accountId})`,
            value: acc,
            selected: false
          }));

          // Mock user selecting first two accounts
          mockPrompt.addResponse([accounts[0], accounts[1]]);

          return await mockPrompt.multiselect('Select accounts to configure:', choices);
        },

        createSubProfile: async function(parentProfile, accountId, accountName) {
          const parentData = mockAWS.profiles.get(parentProfile);
          const subProfileName = `${parentProfile}-${accountName.toLowerCase()}`;

          // List available roles for account
          const roles = await this.listAccountRoles(parentProfile, accountId);

          // Select role
          const selectedRole = await this.selectRole(roles, accountName);

          // Create sub-profile
          const subProfileData = {
            ...parentData,
            sso_account_id: accountId,
            sso_role_name: selectedRole,
            parent_profile: parentProfile
          };

          mockAWS.profiles.set(subProfileName, subProfileData);

          return subProfileName;
        },

        listAccountRoles: async function(profile, accountId) {
          // Simulate role listing
          return [
            'AdministratorAccess',
            'PowerUserAccess',
            'ReadOnlyAccess',
            'DeveloperAccess'
          ];
        },

        selectRole: async function(roles, accountName) {
          const choices = roles.map(role => ({
            title: role,
            value: role
          }));

          // Mock selecting AdministratorAccess for Development, PowerUserAccess for others
          const defaultRole = accountName === 'Development' ?
            'AdministratorAccess' : 'PowerUserAccess';

          mockPrompt.addResponse(defaultRole);

          return await mockPrompt.select(`Select role for ${accountName}:`, choices);
        },

        getSubProfiles: function(parentProfile) {
          const subProfiles = [];

          for (const [name, data] of mockAWS.profiles) {
            if (data.parent_profile === parentProfile) {
              subProfiles.push({
                name,
                accountId: data.sso_account_id,
                role: data.sso_role_name
              });
            }
          }

          return subProfiles;
        },

        refreshSubProfile: async function(subProfileName) {
          const profileData = mockAWS.profiles.get(subProfileName);
          if (!profileData || !profileData.parent_profile) {
            throw new Error('Not a sub-profile');
          }

          const parentProfile = profileData.parent_profile;

          // Ensure parent SSO session is valid
          if (!mockAWS.ssoSessions.has(parentProfile)) {
            throw new Error('Parent SSO session expired');
          }

          // Get role credentials
          const credentials = {
            AccessKeyId: 'ASIA' + Math.random().toString(36).substr(2, 12),
            SecretAccessKey: 'secret' + Math.random().toString(36).substr(2, 20),
            SessionToken: 'token' + Math.random().toString(36).substr(2, 100),
            Expiration: new Date(Date.now() + 3600000).toISOString()
          };

          // Store credentials
          mockAWS.credentials.set(subProfileName, credentials);

          return credentials;
        },

        validateSetup: async function(profileName) {
          const profileData = mockAWS.profiles.get(profileName);

          if (!profileData) {
            return { valid: false, error: 'Profile not found' };
          }

          if (!profileData.sso_start_url) {
            return { valid: false, error: 'Not an SSO profile' };
          }

          if (!profileData.sso_region) {
            return { valid: false, error: 'Missing SSO region' };
          }

          if (!profileData.sso_account_id) {
            return { valid: false, error: 'Missing account ID' };
          }

          if (!profileData.sso_role_name) {
            return { valid: false, error: 'Missing role name' };
          }

          return { valid: true };
        },

        cleanupExpiredSessions: function() {
          const now = Date.now();
          let cleaned = 0;

          for (const [profile, creds] of mockAWS.credentials) {
            if (creds.Expiration && new Date(creds.Expiration) < now) {
              mockAWS.credentials.delete(profile);
              cleaned++;
            }
          }

          return cleaned;
        }
      };
    });

    test.it('should setup cross-account access', async () => {
      // Setup parent SSO session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });

      // Mock user selections
      mockPrompt.addResponses([
        // Select Development and Staging accounts
        [
          { accountId: '111111111111', accountName: 'Development' },
          { accountId: '222222222222', accountName: 'Staging' }
        ],
        'AdministratorAccess', // Role for Development
        'PowerUserAccess'      // Role for Staging
      ]);

      const profiles = await identityCenterService.setupCrossAccount('test-sso');

      test.expect(profiles.length).toBe(2);
      test.expect(profiles).toContain('test-sso-development');
      test.expect(profiles).toContain('test-sso-staging');

      // Verify sub-profiles created
      const devProfile = mockAWS.profiles.get('test-sso-development');
      test.expect(devProfile.sso_account_id).toBe('111111111111');
      test.expect(devProfile.sso_role_name).toBe('AdministratorAccess');
      test.expect(devProfile.parent_profile).toBe('test-sso');
    });

    test.it('should list available AWS accounts', async () => {
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });

      const accounts = await identityCenterService.listAccounts('test-sso');

      test.expect(accounts.length).toBe(3);
      test.expect(accounts[0].accountName).toBe('Development');
      test.expect(accounts[1].accountName).toBe('Staging');
      test.expect(accounts[2].accountName).toBe('Production');
    });

    test.it('should fail without SSO session', async () => {
      try {
        await identityCenterService.listAccounts('test-sso');
        test.expect(false).toBe(true); // Should not reach
      } catch (error) {
        test.expect(error.message).toBe('SSO login required');
      }
    });

    test.it('should create sub-profile with selected role', async () => {
      mockPrompt.addResponse('PowerUserAccess');

      const profileName = await identityCenterService.createSubProfile(
        'test-sso',
        '444444444444',
        'Testing'
      );

      test.expect(profileName).toBe('test-sso-testing');

      const profile = mockAWS.profiles.get(profileName);
      test.expect(profile.sso_account_id).toBe('444444444444');
      test.expect(profile.sso_role_name).toBe('PowerUserAccess');
      test.expect(profile.parent_profile).toBe('test-sso');
    });

    test.it('should get sub-profiles for parent', () => {
      // Create sub-profiles
      mockAWS.profiles.set('test-sso-dev', {
        parent_profile: 'test-sso',
        sso_account_id: '111111111111',
        sso_role_name: 'DeveloperAccess'
      });

      mockAWS.profiles.set('test-sso-prod', {
        parent_profile: 'test-sso',
        sso_account_id: '333333333333',
        sso_role_name: 'ReadOnlyAccess'
      });

      const subProfiles = identityCenterService.getSubProfiles('test-sso');

      test.expect(subProfiles.length).toBe(2);
      test.expect(subProfiles[0].name).toBe('test-sso-dev');
      test.expect(subProfiles[0].accountId).toBe('111111111111');
      test.expect(subProfiles[1].name).toBe('test-sso-prod');
      test.expect(subProfiles[1].role).toBe('ReadOnlyAccess');
    });

    test.it('should refresh sub-profile credentials', async () => {
      // Setup sub-profile
      mockAWS.profiles.set('test-sso-dev', {
        parent_profile: 'test-sso',
        sso_account_id: '111111111111',
        sso_role_name: 'DeveloperAccess'
      });

      // Setup parent SSO session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });

      const credentials = await identityCenterService.refreshSubProfile('test-sso-dev');

      test.expect(credentials).toBeTruthy();
      test.expect(credentials.AccessKeyId).toBeTruthy();
      test.expect(credentials.AccessKeyId.startsWith('ASIA')).toBe(true);
      test.expect(credentials.SessionToken).toBeTruthy();
      test.expect(credentials.Expiration).toBeTruthy();

      // Verify credentials stored
      const storedCreds = mockAWS.credentials.get('test-sso-dev');
      test.expect(storedCreds).toEqual(credentials);
    });

    test.it('should fail to refresh without parent session', async () => {
      mockAWS.profiles.set('test-sso-dev', {
        parent_profile: 'test-sso',
        sso_account_id: '111111111111',
        sso_role_name: 'DeveloperAccess'
      });

      try {
        await identityCenterService.refreshSubProfile('test-sso-dev');
        test.expect(false).toBe(true); // Should not reach
      } catch (error) {
        test.expect(error.message).toBe('Parent SSO session expired');
      }
    });

    test.it('should validate SSO profile setup', async () => {
      // Valid profile
      mockAWS.profiles.set('valid-sso', {
        sso_start_url: 'https://company.awsapps.com/start',
        sso_region: 'us-east-1',
        sso_account_id: '123456789012',
        sso_role_name: 'DeveloperAccess'
      });

      const validResult = await identityCenterService.validateSetup('valid-sso');
      test.expect(validResult.valid).toBe(true);

      // Missing SSO URL
      mockAWS.profiles.set('invalid-sso', {
        sso_region: 'us-east-1',
        sso_account_id: '123456789012',
        sso_role_name: 'DeveloperAccess'
      });

      const invalidResult = await identityCenterService.validateSetup('invalid-sso');
      test.expect(invalidResult.valid).toBe(false);
      test.expect(invalidResult.error).toBe('Not an SSO profile');
    });

    test.it('should cleanup expired sessions', () => {
      // Add expired credentials
      mockAWS.credentials.set('profile1', {
        Expiration: new Date(Date.now() - 3600000).toISOString()
      });

      // Add valid credentials
      mockAWS.credentials.set('profile2', {
        Expiration: new Date(Date.now() + 3600000).toISOString()
      });

      // Add permanent credentials (no expiration)
      mockAWS.credentials.set('profile3', {
        AccessKeyId: 'AKIA123456'
      });

      const cleaned = identityCenterService.cleanupExpiredSessions();

      test.expect(cleaned).toBe(1);
      test.expect(mockAWS.credentials.has('profile1')).toBe(false);
      test.expect(mockAWS.credentials.has('profile2')).toBe(true);
      test.expect(mockAWS.credentials.has('profile3')).toBe(true);
    });

    test.it('should list available roles for account', async () => {
      const roles = await identityCenterService.listAccountRoles('test-sso', '123456789012');

      test.expect(roles.length).toBe(4);
      test.expect(roles).toContain('AdministratorAccess');
      test.expect(roles).toContain('PowerUserAccess');
      test.expect(roles).toContain('ReadOnlyAccess');
      test.expect(roles).toContain('DeveloperAccess');
    });
  });
};