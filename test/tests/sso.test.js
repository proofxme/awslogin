'use strict';

/**
 * SSO Service Tests
 */

module.exports = async function(test) {
  test.describe('SSO Service', () => {
    let ssoService;
    let mockAWS, mockChild;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockChild = global.mockChild;

      mockAWS.reset();
      mockChild.reset();

      // Mock SSO service
      ssoService = {
        login: async function(profile, options = {}) {
          const profileData = mockAWS.profiles.get(profile);
          if (!profileData || !profileData.sso_start_url) {
            throw new Error('Not an SSO profile');
          }

          // Check if already logged in
          if (!options.force && this.isSessionValid(profile)) {
            return { success: true, cached: true };
          }

          // Perform SSO login
          mockAWS.ssoSessions.set(profile, {
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            accessToken: 'test-access-token'
          });

          return {
            success: true,
            cached: false,
            expiresAt: mockAWS.ssoSessions.get(profile).expiresAt
          };
        },

        isSessionValid: function(profile) {
          const session = mockAWS.ssoSessions.get(profile);
          if (!session) return false;
          return new Date(session.expiresAt) > new Date();
        },

        listAccounts: async function(profile) {
          if (!this.isSessionValid(profile)) {
            throw new Error('SSO session expired');
          }

          return [
            {
              accountId: '123456789012',
              accountName: 'Test Account',
              emailAddress: 'test@example.com'
            },
            {
              accountId: '123456789013',
              accountName: 'Dev Account',
              emailAddress: 'dev@example.com'
            }
          ];
        },

        createSubProfile: async function(parentProfile, accountId, roleName) {
          const parentData = mockAWS.profiles.get(parentProfile);
          if (!parentData) {
            throw new Error('Parent profile not found');
          }

          const subProfileName = `${parentProfile}-${accountId}`;
          mockAWS.profiles.set(subProfileName, {
            ...parentData,
            sso_account_id: accountId,
            sso_role_name: roleName
          });

          return subProfileName;
        },

        refreshToken: async function(profile) {
          const session = mockAWS.ssoSessions.get(profile);
          if (!session) {
            throw new Error('No SSO session found');
          }

          // Extend session
          session.expiresAt = new Date(Date.now() + 3600000).toISOString();
          return { success: true, expiresAt: session.expiresAt };
        }
      };
    });

    test.it('should perform SSO login successfully', async () => {
      const result = await ssoService.login('test-sso');
      test.expect(result.success).toBe(true);
      test.expect(result.cached).toBe(false);
      test.expect(result.expiresAt).toBeTruthy();
    });

    test.it('should use cached SSO session when valid', async () => {
      // First login
      await ssoService.login('test-sso');

      // Second login should use cache
      const result = await ssoService.login('test-sso');
      test.expect(result.success).toBe(true);
      test.expect(result.cached).toBe(true);
    });

    test.it('should force SSO re-login when requested', async () => {
      // First login
      await ssoService.login('test-sso');

      // Force re-login
      const result = await ssoService.login('test-sso', { force: true });
      test.expect(result.success).toBe(true);
      test.expect(result.cached).toBe(false);
    });

    test.it('should list AWS accounts after SSO login', async () => {
      await ssoService.login('test-sso');
      const accounts = await ssoService.listAccounts('test-sso');

      test.expect(accounts.length).toBe(2);
      test.expect(accounts[0].accountId).toBe('123456789012');
      test.expect(accounts[1].accountName).toBe('Dev Account');
    });

    test.it('should fail to list accounts with expired session', async () => {
      // Set expired session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      });

      try {
        await ssoService.listAccounts('test-sso');
        test.expect(false).toBe(true); // Should not reach here
      } catch (error) {
        test.expect(error.message).toBe('SSO session expired');
      }
    });

    test.it('should create sub-profile for specific account', async () => {
      await ssoService.login('test-sso');
      const subProfile = await ssoService.createSubProfile('test-sso', '123456789013', 'DevRole');

      test.expect(subProfile).toBe('test-sso-123456789013');

      const subProfileData = mockAWS.profiles.get(subProfile);
      test.expect(subProfileData.sso_account_id).toBe('123456789013');
      test.expect(subProfileData.sso_role_name).toBe('DevRole');
    });

    test.it('should refresh SSO token', async () => {
      await ssoService.login('test-sso');

      // Set session to near expiration
      mockAWS.ssoSessions.get('test-sso').expiresAt =
        new Date(Date.now() + 60000).toISOString();

      const result = await ssoService.refreshToken('test-sso');
      test.expect(result.success).toBe(true);

      // Check extended expiration
      const session = mockAWS.ssoSessions.get('test-sso');
      const remainingTime = new Date(session.expiresAt) - new Date();
      test.expect(remainingTime).toBeTruthy();
      test.expect(remainingTime > 3000000).toBe(true); // More than 50 minutes
    });

    test.it('should validate SSO session correctly', () => {
      // No session
      test.expect(ssoService.isSessionValid('test-sso')).toBe(false);

      // Valid session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
      test.expect(ssoService.isSessionValid('test-sso')).toBe(true);

      // Expired session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      });
      test.expect(ssoService.isSessionValid('test-sso')).toBe(false);
    });
  });
};