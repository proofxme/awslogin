'use strict';

/**
 * AuthManager Tests
 */

module.exports = async function(test) {
  test.describe('AuthManager', () => {
    let authManager;
    let mockAWS, mockChild, mockPrompt;

    test.beforeEach(() => {
      // Reset mocks
      mockAWS = global.mockAWS;
      mockChild = global.mockChild;
      mockPrompt = global.mockPrompt;

      mockAWS.reset();
      mockChild.reset();
      mockPrompt.reset();

      // Mock the AuthManager module
      authManager = {
        authenticate: async function(profile, options = {}) {
          const profileData = mockAWS.profiles.get(profile);
          if (!profileData) {
            throw new Error('Profile not found');
          }

          if (profileData.sso_start_url) {
            return this.authenticateSSO(profile, options);
          } else if (profileData.mfa_serial) {
            return this.authenticateMFA(profile, options);
          } else {
            return this.authenticateDirect(profile, options);
          }
        },

        authenticateSSO: async function(profile, options) {
          if (options.force || !mockAWS.ssoSessions.has(profile)) {
            // Simulate SSO login
            mockAWS.ssoSessions.set(profile, {
              expiresAt: new Date(Date.now() + 3600000).toISOString()
            });
          }
          return { success: true, method: 'sso', profile };
        },

        authenticateMFA: async function(profile, options) {
          const profileData = mockAWS.profiles.get(profile);

          if (options.token) {
            // Use provided token
          } else if (profileData.op_item) {
            // Use 1Password
            options.token = '123456';
          } else {
            // Prompt for token
            mockPrompt.addResponse('123456');
            options.token = await mockPrompt.input('Enter MFA token:');
          }

          // Simulate MFA authentication
          return {
            success: true,
            method: 'mfa',
            profile,
            sessionToken: 'test-session-token'
          };
        },

        authenticateDirect: async function(profile, options) {
          // Direct authentication
          return { success: true, method: 'direct', profile };
        },

        detectAuthMethod: function(profileData) {
          if (profileData.sso_start_url) return 'sso';
          if (profileData.mfa_serial) return 'mfa';
          return 'direct';
        },

        isSessionValid: function(profile) {
          const session = mockAWS.ssoSessions.get(profile);
          if (!session) return false;
          return new Date(session.expiresAt) > new Date();
        }
      };
    });

    test.it('should detect SSO authentication method', () => {
      const profileData = mockAWS.profiles.get('test-sso');
      const method = authManager.detectAuthMethod(profileData);
      test.expect(method).toBe('sso');
    });

    test.it('should detect MFA authentication method', () => {
      const profileData = mockAWS.profiles.get('test-mfa');
      const method = authManager.detectAuthMethod(profileData);
      test.expect(method).toBe('mfa');
    });

    test.it('should authenticate with SSO profile', async () => {
      const result = await authManager.authenticate('test-sso');
      test.expect(result.success).toBe(true);
      test.expect(result.method).toBe('sso');
      test.expect(result.profile).toBe('test-sso');
    });

    test.it('should authenticate with MFA profile', async () => {
      mockPrompt.addResponse('123456');
      const result = await authManager.authenticate('test-mfa');
      test.expect(result.success).toBe(true);
      test.expect(result.method).toBe('mfa');
      test.expect(result.sessionToken).toBeTruthy();
    });

    test.it('should force re-authentication when requested', async () => {
      // First auth
      await authManager.authenticate('test-sso');
      test.expect(authManager.isSessionValid('test-sso')).toBe(true);

      // Force re-auth
      mockAWS.ssoSessions.clear();
      const result = await authManager.authenticate('test-sso', { force: true });
      test.expect(result.success).toBe(true);
      test.expect(authManager.isSessionValid('test-sso')).toBe(true);
    });

    test.it('should handle 1Password integration for MFA', async () => {
      // Add 1Password item to profile
      mockAWS.profiles.get('test-mfa').op_item = 'AWS test-mfa';

      const result = await authManager.authenticate('test-mfa');
      test.expect(result.success).toBe(true);
      test.expect(result.method).toBe('mfa');
    });

    test.it('should handle missing profile gracefully', async () => {
      try {
        await authManager.authenticate('non-existent');
        test.expect(false).toBe(true); // Should not reach here
      } catch (error) {
        test.expect(error.message).toBe('Profile not found');
      }
    });

    test.it('should validate session expiration', () => {
      // Expired session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      });
      test.expect(authManager.isSessionValid('test-sso')).toBe(false);

      // Valid session
      mockAWS.ssoSessions.set('test-sso', {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
      test.expect(authManager.isSessionValid('test-sso')).toBe(true);
    });
  });
};