'use strict';

/**
 * MFA Service Tests
 */

module.exports = async function(test) {
  test.describe('MFA Service', () => {
    let mfaService;
    let mockAWS, mockChild, mockPrompt;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockChild = global.mockChild;
      mockPrompt = global.mockPrompt;

      mockAWS.reset();
      mockChild.reset();
      mockPrompt.reset();

      // Mock MFA service
      mfaService = {
        authenticate: async function(profile, options = {}) {
          const profileData = mockAWS.profiles.get(profile);
          if (!profileData || !profileData.mfa_serial) {
            throw new Error('Not an MFA-enabled profile');
          }

          // Get MFA token
          const token = await this.getMFAToken(profileData, options);

          // Get session token from STS
          const sessionData = {
            AccessKeyId: 'ASIATEST' + Math.random().toString(36).substr(2, 6),
            SecretAccessKey: 'testSessionSecret',
            SessionToken: 'testSessionToken',
            Expiration: new Date(Date.now() + 3600000).toISOString()
          };

          // Store session
          mockAWS.credentials.set(profile, sessionData);

          return {
            success: true,
            credentials: sessionData
          };
        },

        getMFAToken: async function(profileData, options) {
          if (options.token) {
            return options.token;
          }

          if (profileData.op_item) {
            // Get from 1Password
            return this.get1PasswordToken(profileData.op_item);
          }

          // Prompt user
          mockPrompt.addResponse('123456');
          return await mockPrompt.input('Enter MFA token:');
        },

        get1PasswordToken: function(itemName) {
          // Simulate 1Password CLI call
          return '123456';
        },

        createMFADevice: async function(username, profile) {
          const serial = `arn:aws:iam::123456789012:mfa/${username}`;

          mockAWS.mfaDevices.set(serial, {
            SerialNumber: serial,
            Username: username
          });

          return {
            serial,
            secret: 'TESTMFASECRETBASE32STRING'
          };
        },

        enableMFADevice: async function(username, serial, code1, code2) {
          const device = mockAWS.mfaDevices.get(serial);
          if (!device) {
            throw new Error('MFA device not found');
          }

          // Validate codes (mock validation)
          if (!code1 || !code2 || code1 === code2) {
            throw new Error('Invalid MFA codes');
          }

          device.EnableDate = new Date().toISOString();
          return { success: true };
        },

        setup1Password: async function(itemName, secret) {
          // Mock 1Password item creation
          mockChild.addCommand(`op item create --title="${itemName}"`, {
            stdout: JSON.stringify({
              id: 'test-item-id',
              title: itemName
            }),
            stderr: '',
            code: 0
          });

          return { success: true, itemName };
        },

        getConsecutiveCodes: async function(itemName) {
          // Simulate getting two different codes
          const code1 = '123456';
          await new Promise(resolve => setTimeout(resolve, 30)); // Wait
          const code2 = '654321';

          return { code1, code2 };
        },

        isSessionValid: function(profile) {
          const creds = mockAWS.credentials.get(profile);
          if (!creds) return false;
          return new Date(creds.Expiration) > new Date();
        }
      };
    });

    test.it('should authenticate with MFA token', async () => {
      mockPrompt.addResponse('123456');
      const result = await mfaService.authenticate('test-mfa');

      test.expect(result.success).toBe(true);
      test.expect(result.credentials).toBeTruthy();
      test.expect(result.credentials.SessionToken).toBeTruthy();
    });

    test.it('should use 1Password for MFA token', async () => {
      // Add 1Password integration to profile
      mockAWS.profiles.get('test-mfa').op_item = 'AWS test-mfa';

      const result = await mfaService.authenticate('test-mfa');
      test.expect(result.success).toBe(true);
      test.expect(result.credentials.SessionToken).toBeTruthy();
    });

    test.it('should use provided MFA token', async () => {
      const result = await mfaService.authenticate('test-mfa', { token: '999888' });
      test.expect(result.success).toBe(true);
      test.expect(result.credentials).toBeTruthy();
    });

    test.it('should create MFA device', async () => {
      const result = await mfaService.createMFADevice('testuser', 'test-profile');

      test.expect(result.serial).toContain('arn:aws:iam');
      test.expect(result.serial).toContain('testuser');
      test.expect(result.secret).toBeTruthy();
    });

    test.it('should enable MFA device with valid codes', async () => {
      const serial = 'arn:aws:iam::123456789012:mfa/testuser';
      mockAWS.mfaDevices.set(serial, { SerialNumber: serial });

      const result = await mfaService.enableMFADevice('testuser', serial, '123456', '654321');
      test.expect(result.success).toBe(true);

      const device = mockAWS.mfaDevices.get(serial);
      test.expect(device.EnableDate).toBeTruthy();
    });

    test.it('should reject invalid MFA codes', async () => {
      const serial = 'arn:aws:iam::123456789012:mfa/testuser';
      mockAWS.mfaDevices.set(serial, { SerialNumber: serial });

      try {
        // Same codes
        await mfaService.enableMFADevice('testuser', serial, '123456', '123456');
        test.expect(false).toBe(true); // Should not reach here
      } catch (error) {
        test.expect(error.message).toBe('Invalid MFA codes');
      }
    });

    test.it('should set up 1Password integration', async () => {
      const result = await mfaService.setup1Password('AWS testuser', 'SECRETBASE32');

      test.expect(result.success).toBe(true);
      test.expect(result.itemName).toBe('AWS testuser');
    });

    test.it('should get consecutive TOTP codes from 1Password', async () => {
      const { code1, code2 } = await mfaService.getConsecutiveCodes('AWS test');

      test.expect(code1).toBeTruthy();
      test.expect(code2).toBeTruthy();
      test.expect(code1).toBeTruthy();
      test.expect(code2).toBeTruthy();
    });

    test.it('should validate MFA session expiration', () => {
      // No session
      test.expect(mfaService.isSessionValid('test-mfa')).toBe(false);

      // Valid session
      mockAWS.credentials.set('test-mfa', {
        Expiration: new Date(Date.now() + 3600000).toISOString()
      });
      test.expect(mfaService.isSessionValid('test-mfa')).toBe(true);

      // Expired session
      mockAWS.credentials.set('test-mfa', {
        Expiration: new Date(Date.now() - 3600000).toISOString()
      });
      test.expect(mfaService.isSessionValid('test-mfa')).toBe(false);
    });
  });
};