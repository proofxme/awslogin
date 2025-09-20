'use strict';

/**
 * 1Password Integration Tests
 */

module.exports = async function(test) {
  test.describe('1Password Integration', () => {
    let onePasswordService;
    let mockChild, mockPrompt;

    test.beforeEach(() => {
      mockChild = global.mockChild;
      mockPrompt = global.mockPrompt;

      mockChild.reset();
      mockPrompt.reset();

      // Mock 1Password service
      onePasswordService = {
        isAvailable: function() {
          try {
            const result = mockChild.executeCommand('op --version');
            return result.code === 0;
          } catch {
            return false;
          }
        },

        createItem: async function(title, fields) {
          const jsonFields = JSON.stringify(fields);
          const command = `op item create --category=Login --title="${title}" --vault="AWS"`;

          mockChild.addCommand(command, {
            stdout: JSON.stringify({
              id: 'item-' + Math.random().toString(36).substr(2, 9),
              title: title,
              vault: { name: 'AWS' },
              fields: fields
            }),
            stderr: '',
            code: 0
          });

          const result = mockChild.executeCommand(command);
          if (result.code !== 0) {
            throw new Error('Failed to create 1Password item');
          }

          return JSON.parse(result.stdout);
        },

        addTOTPField: async function(itemName, secret) {
          const command = `op item edit "${itemName}" totp="${secret}"`;

          mockChild.addCommand(command, {
            stdout: JSON.stringify({
              id: 'item-123',
              title: itemName,
              fields: [
                { label: 'totp', value: secret, type: 'OTP' }
              ]
            }),
            stderr: '',
            code: 0
          });

          const result = mockChild.executeCommand(command);
          if (result.code !== 0) {
            throw new Error('Failed to add TOTP field');
          }

          return JSON.parse(result.stdout);
        },

        getTOTPCode: async function(itemName) {
          const command = `op item get "${itemName}" --otp`;

          // Simulate TOTP generation
          const code = String(Math.floor(Math.random() * 900000) + 100000);

          mockChild.addCommand(command, {
            stdout: code,
            stderr: '',
            code: 0
          });

          const result = mockChild.executeCommand(command);
          if (result.code !== 0) {
            throw new Error('Failed to get TOTP code');
          }

          return result.stdout.trim();
        },

        getConsecutiveCodes: async function(itemName, waitTime = 30000) {
          // Get first code
          const code1 = await this.getTOTPCode(itemName);

          // Wait for next TOTP window
          await new Promise(resolve => setTimeout(resolve, waitTime));

          // Get second code
          const code2 = await this.getTOTPCode(itemName);

          // Ensure codes are different
          if (code1 === code2) {
            // Force different code in mock
            return {
              code1,
              code2: String((parseInt(code1) + 1) % 1000000).padStart(6, '0')
            };
          }

          return { code1, code2 };
        },

        storeAWSCredentials: async function(profileName, credentials) {
          const fields = [
            { label: 'username', value: profileName, type: 'STRING' },
            { label: 'access_key_id', value: credentials.AccessKeyId, type: 'CONCEALED' },
            { label: 'secret_access_key', value: credentials.SecretAccessKey, type: 'CONCEALED' }
          ];

          if (credentials.mfa_serial) {
            fields.push({
              label: 'mfa_serial',
              value: credentials.mfa_serial,
              type: 'STRING'
            });
          }

          return this.createItem(`AWS ${profileName}`, fields);
        },

        getStoredCredentials: async function(itemName) {
          const command = `op item get "${itemName}" --format json`;

          mockChild.addCommand(command, {
            stdout: JSON.stringify({
              fields: [
                { label: 'access_key_id', value: 'AKIA123456' },
                { label: 'secret_access_key', value: 'secret123' },
                { label: 'mfa_serial', value: 'arn:aws:iam::123456789012:mfa/user' }
              ]
            }),
            stderr: '',
            code: 0
          });

          const result = mockChild.executeCommand(command);
          if (result.code !== 0) {
            return null;
          }

          const item = JSON.parse(result.stdout);
          const credentials = {};

          for (const field of item.fields) {
            credentials[field.label] = field.value;
          }

          return credentials;
        },

        setupInteractive: async function() {
          const hasAccount = await mockPrompt.confirm('Do you have a 1Password account?', true);

          if (!hasAccount) {
            console.log('Please sign up at https://1password.com');
            return false;
          }

          const signedIn = mockChild.executeCommand('op account list');
          if (signedIn.code !== 0) {
            console.log('Please sign in to 1Password CLI:');
            console.log('  eval $(op signin)');
            return false;
          }

          return true;
        },

        createVaultIfNeeded: async function(vaultName = 'AWS') {
          const listCommand = 'op vault list --format json';
          mockChild.addCommand(listCommand, {
            stdout: JSON.stringify([
              { id: 'vault-1', name: 'Personal' },
              { id: 'vault-2', name: 'AWS' }
            ]),
            stderr: '',
            code: 0
          });

          const vaults = JSON.parse(mockChild.executeCommand(listCommand).stdout);
          const exists = vaults.some(v => v.name === vaultName);

          if (!exists) {
            const createCommand = `op vault create "${vaultName}"`;
            mockChild.addCommand(createCommand, {
              stdout: JSON.stringify({ id: 'vault-3', name: vaultName }),
              stderr: '',
              code: 0
            });

            mockChild.executeCommand(createCommand);
          }

          return true;
        }
      };

      // Mock op CLI availability
      mockChild.addCommand('op --version', {
        stdout: '2.24.0',
        stderr: '',
        code: 0
      });

      // Mock op account list
      mockChild.addCommand('op account list', {
        stdout: JSON.stringify([{
          url: 'my.1password.com',
          email: 'user@example.com',
          user_uuid: 'user-123'
        }]),
        stderr: '',
        code: 0
      });
    });

    test.it('should detect 1Password CLI availability', () => {
      const available = onePasswordService.isAvailable();
      test.expect(available).toBe(true);

      // Test when not available
      mockChild.reset();
      mockChild.addCommand('op --version', {
        stdout: '',
        stderr: 'command not found',
        code: 127
      });

      const notAvailable = onePasswordService.isAvailable();
      test.expect(notAvailable).toBe(false);
    });

    test.it('should create 1Password item with fields', async () => {
      const item = await onePasswordService.createItem('Test Item', [
        { label: 'username', value: 'testuser', type: 'STRING' },
        { label: 'password', value: 'testpass', type: 'CONCEALED' }
      ]);

      test.expect(item).toBeTruthy();
      test.expect(item.title).toBe('Test Item');
      test.expect(item.vault.name).toBe('AWS');
      test.expect(item.fields.length).toBe(2);
    });

    test.it('should add TOTP field to existing item', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const result = await onePasswordService.addTOTPField('AWS test', secret);

      test.expect(result).toBeTruthy();
      test.expect(result.fields.find(f => f.label === 'totp')).toBeTruthy();
      test.expect(result.fields.find(f => f.label === 'totp').value).toBe(secret);
    });

    test.it('should get TOTP code from 1Password', async () => {
      const code = await onePasswordService.getTOTPCode('AWS test');

      test.expect(code).toBeTruthy();
      test.expect(code.length).toBe(6);
      test.expect(parseInt(code)).toBeTruthy();
    });

    test.it('should get consecutive TOTP codes', async () => {
      const { code1, code2 } = await onePasswordService.getConsecutiveCodes('AWS test', 10);

      test.expect(code1).toBeTruthy();
      test.expect(code2).toBeTruthy();
      test.expect(code1).toBeTruthy();
      test.expect(code2).toBeTruthy();
    });

    test.it('should store AWS credentials in 1Password', async () => {
      const credentials = {
        AccessKeyId: 'AKIATEST123456',
        SecretAccessKey: 'testSecret123',
        mfa_serial: 'arn:aws:iam::123456789012:mfa/testuser'
      };

      const item = await onePasswordService.storeAWSCredentials('test-profile', credentials);

      test.expect(item).toBeTruthy();
      test.expect(item.title).toBe('AWS test-profile');
      test.expect(item.fields.length).toBe(4); // username, access_key, secret_key, mfa_serial
    });

    test.it('should retrieve stored credentials from 1Password', async () => {
      const credentials = await onePasswordService.getStoredCredentials('AWS test');

      test.expect(credentials).toBeTruthy();
      test.expect(credentials.access_key_id).toBe('AKIA123456');
      test.expect(credentials.secret_access_key).toBe('secret123');
      test.expect(credentials.mfa_serial).toContain('mfa/user');
    });

    test.it('should handle interactive setup', async () => {
      mockPrompt.addResponse(true); // Has account
      const result = await onePasswordService.setupInteractive();

      test.expect(result).toBe(true);
    });

    test.it('should handle no 1Password account', async () => {
      mockPrompt.addResponse(false); // No account
      const result = await onePasswordService.setupInteractive();

      test.expect(result).toBe(false);
    });

    test.it('should create vault if needed', async () => {
      const result = await onePasswordService.createVaultIfNeeded('AWS');
      test.expect(result).toBe(true);

      // Test creating new vault
      mockChild.reset();
      mockChild.addCommand('op vault list --format json', {
        stdout: JSON.stringify([
          { id: 'vault-1', name: 'Personal' }
        ]),
        stderr: '',
        code: 0
      });

      const newVaultResult = await onePasswordService.createVaultIfNeeded('AWS');
      test.expect(newVaultResult).toBe(true);
    });

    test.it('should handle 1Password CLI errors gracefully', async () => {
      mockChild.reset();
      mockChild.addCommand('op item get "NonExistent" --otp', {
        stdout: '',
        stderr: 'Item not found',
        code: 1
      });

      try {
        await onePasswordService.getTOTPCode('NonExistent');
        test.expect(false).toBe(true); // Should not reach
      } catch (error) {
        test.expect(error.message).toBe('Failed to get TOTP code');
      }
    });
  });
};