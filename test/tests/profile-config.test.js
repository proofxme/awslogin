'use strict';

/**
 * Profile Configuration Tests
 */

module.exports = async function(test) {
  test.describe('Profile Configuration', () => {
    let profileConfigService;
    let mockAWS, mockPrompt, mockFS;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockPrompt = global.mockPrompt;
      mockFS = global.mockFS;

      mockAWS.reset();
      mockPrompt.reset();
      mockFS.reset();

      // Mock Profile Config service
      profileConfigService = {
        configureProfile: async function(profileName, options = {}) {
          const isNew = !mockAWS.profiles.has(profileName);

          if (isNew) {
            return this.createNewProfile(profileName, options);
          } else {
            return this.updateProfile(profileName, options);
          }
        },

        createNewProfile: async function(profileName, options) {
          const config = { name: profileName };

          // Get authentication method
          if (!options.authMethod) {
            config.authMethod = await this.selectAuthMethod();
          } else {
            config.authMethod = options.authMethod;
          }

          // Configure based on auth method
          switch (config.authMethod) {
            case 'sso':
              await this.configureSSOProfile(config, options);
              break;
            case 'mfa':
              await this.configureMFAProfile(config, options);
              break;
            case 'direct':
              await this.configureDirectProfile(config, options);
              break;
          }

          // Common configuration
          await this.configureCommon(config, options);

          // Save profile
          this.saveProfile(config);

          return config;
        },

        updateProfile: async function(profileName, options) {
          const config = mockAWS.profiles.get(profileName);

          if (options.region) {
            config.region = options.region;
          }

          if (options.output) {
            config.output = options.output;
          }

          if (options.mfa_serial) {
            config.mfa_serial = options.mfa_serial;
          }

          if (options.op_item) {
            config.op_item = options.op_item;
          }

          this.saveProfile(config);
          return config;
        },

        selectAuthMethod: async function() {
          const choices = [
            { title: '🔐 SSO (Identity Center)', value: 'sso' },
            { title: '📱 MFA (Multi-Factor Auth)', value: 'mfa' },
            { title: '🔑 Direct Credentials', value: 'direct' }
          ];

          mockPrompt.addResponse('mfa');
          return await mockPrompt.select('Select authentication method:', choices);
        },

        configureSSOProfile: async function(config, options) {
          config.sso_start_url = options.sso_start_url ||
            await mockPrompt.input('SSO start URL:');

          config.sso_region = options.sso_region ||
            await mockPrompt.input('SSO region:', { default: 'us-east-1' });

          config.sso_account_id = options.sso_account_id ||
            await mockPrompt.input('Account ID:');

          config.sso_role_name = options.sso_role_name ||
            await mockPrompt.input('Role name:', { default: 'AdministratorAccess' });
        },

        configureMFAProfile: async function(config, options) {
          config.aws_access_key_id = options.aws_access_key_id ||
            await mockPrompt.input('Access Key ID:');

          config.aws_secret_access_key = options.aws_secret_access_key ||
            await mockPrompt.password('Secret Access Key:');

          config.mfa_serial = options.mfa_serial ||
            await mockPrompt.input('MFA device serial:');

          // Optional 1Password integration
          const use1Password = options.use1Password !== undefined ?
            options.use1Password :
            await mockPrompt.confirm('Use 1Password for MFA?', false);

          if (use1Password) {
            config.op_item = options.op_item ||
              await mockPrompt.input('1Password item name:');
          }
        },

        configureDirectProfile: async function(config, options) {
          config.aws_access_key_id = options.aws_access_key_id ||
            await mockPrompt.input('Access Key ID:');

          config.aws_secret_access_key = options.aws_secret_access_key ||
            await mockPrompt.password('Secret Access Key:');
        },

        configureCommon: async function(config, options) {
          config.region = options.region ||
            await mockPrompt.input('AWS Region:', { default: 'us-east-1' });

          config.output = options.output ||
            await mockPrompt.select('Output format:', [
              { title: 'json', value: 'json' },
              { title: 'text', value: 'text' },
              { title: 'table', value: 'table' }
            ]);
        },

        saveProfile: function(config) {
          const profileName = config.name;
          delete config.name; // Don't store name in profile data

          mockAWS.profiles.set(profileName, config);

          // Update config files (mocked)
          mockFS.writeFile(`~/.aws/config.${profileName}`, JSON.stringify(config));
          mockFS.writeFile(`~/.aws/credentials.${profileName}`, JSON.stringify({
            aws_access_key_id: config.aws_access_key_id,
            aws_secret_access_key: config.aws_secret_access_key
          }));
        },

        deleteProfile: function(profileName) {
          if (!mockAWS.profiles.has(profileName)) {
            throw new Error(`Profile '${profileName}' not found`);
          }

          mockAWS.profiles.delete(profileName);
          mockAWS.credentials.delete(profileName);
          mockAWS.ssoSessions.delete(profileName);

          // Remove from files (mocked)
          mockFS.deleteFile(`~/.aws/config.${profileName}`);
          mockFS.deleteFile(`~/.aws/credentials.${profileName}`);

          return true;
        },

        cloneProfile: async function(sourceProfile, targetProfile) {
          const sourceConfig = mockAWS.profiles.get(sourceProfile);
          if (!sourceConfig) {
            throw new Error(`Source profile '${sourceProfile}' not found`);
          }

          const targetConfig = { ...sourceConfig };

          // Modify name-specific fields
          if (targetConfig.op_item) {
            targetConfig.op_item = targetConfig.op_item.replace(
              sourceProfile,
              targetProfile
            );
          }

          this.saveProfile({ name: targetProfile, ...targetConfig });
          return targetConfig;
        },

        exportProfile: function(profileName) {
          const config = mockAWS.profiles.get(profileName);
          if (!config) {
            throw new Error(`Profile '${profileName}' not found`);
          }

          return {
            name: profileName,
            config: { ...config },
            credentials: mockAWS.credentials.has(profileName) ?
              { ...mockAWS.credentials.get(profileName) } : null
          };
        },

        importProfile: function(profileData) {
          const { name, config, credentials } = profileData;

          mockAWS.profiles.set(name, config);
          if (credentials) {
            mockAWS.credentials.set(name, credentials);
          }

          this.saveProfile({ name, ...config });
          return true;
        },

        validateProfile: function(profileName) {
          const config = mockAWS.profiles.get(profileName);
          if (!config) {
            return { valid: false, errors: [`Profile '${profileName}' not found`] };
          }

          const errors = [];

          // Check SSO profiles
          if (config.sso_start_url) {
            if (!config.sso_region) errors.push('Missing SSO region');
            if (!config.sso_account_id) errors.push('Missing SSO account ID');
            if (!config.sso_role_name) errors.push('Missing SSO role name');
          }

          // Check MFA profiles
          if (config.mfa_serial) {
            if (!config.aws_access_key_id) errors.push('Missing access key for MFA profile');
            if (!config.aws_secret_access_key) errors.push('Missing secret key for MFA profile');
          }

          // Check direct profiles
          if (!config.sso_start_url && !config.mfa_serial) {
            if (!config.aws_access_key_id) errors.push('Missing access key');
            if (!config.aws_secret_access_key) errors.push('Missing secret key');
          }

          return {
            valid: errors.length === 0,
            errors
          };
        },

        migrateProfiles: async function(fromFormat, toFormat) {
          const migrated = [];

          for (const [name, config] of mockAWS.profiles) {
            if (fromFormat === 'legacy' && toFormat === 'modern') {
              // Migrate legacy format to modern
              if (config.aws_security_token) {
                config.aws_session_token = config.aws_security_token;
                delete config.aws_security_token;
              }

              if (config.mfa_device) {
                config.mfa_serial = config.mfa_device;
                delete config.mfa_device;
              }

              mockAWS.profiles.set(name, config);
              migrated.push(name);
            }
          }

          return migrated;
        }
      };

      // Add mock responses
      mockPrompt.addResponses([
        'mfa',                           // Auth method
        'AKIATEST123',                   // Access Key
        'secretTest123',                 // Secret Key
        'arn:aws:iam::123456789012:mfa/test', // MFA serial
        true,                            // Use 1Password
        'AWS Test',                      // 1Password item
        'us-west-2',                     // Region
        'json'                           // Output format
      ]);
    });

    test.it('should create new MFA profile', async () => {
      const config = await profileConfigService.configureProfile('new-mfa');

      test.expect(config.name).toBe('new-mfa');
      test.expect(config.authMethod).toBe('mfa');
      test.expect(config.aws_access_key_id).toBe('AKIATEST123');
      test.expect(config.mfa_serial).toContain('mfa/test');
      test.expect(config.op_item).toBe('AWS Test');
      test.expect(config.region).toBe('us-west-2');
    });

    test.it('should create new SSO profile', async () => {
      mockPrompt.reset();
      mockPrompt.addResponses([
        'sso',                                    // Auth method
        'https://company.awsapps.com/start',     // SSO URL
        'us-east-1',                              // SSO region
        '123456789012',                           // Account ID
        'DeveloperAccess',                        // Role name
        'eu-west-1',                              // AWS region
        'table'                                   // Output format
      ]);

      const config = await profileConfigService.configureProfile('new-sso');

      test.expect(config.authMethod).toBe('sso');
      test.expect(config.sso_start_url).toBe('https://company.awsapps.com/start');
      test.expect(config.sso_account_id).toBe('123456789012');
      test.expect(config.sso_role_name).toBe('DeveloperAccess');
      test.expect(config.output).toBe('table');
    });

    test.it('should update existing profile', async () => {
      // Create initial profile
      mockAWS.profiles.set('existing', {
        region: 'us-east-1',
        output: 'json'
      });

      const updated = await profileConfigService.updateProfile('existing', {
        region: 'ap-southeast-1',
        output: 'text'
      });

      test.expect(updated.region).toBe('ap-southeast-1');
      test.expect(updated.output).toBe('text');
    });

    test.it('should delete profile', () => {
      mockAWS.profiles.set('to-delete', { region: 'us-east-1' });
      mockAWS.credentials.set('to-delete', { AccessKeyId: 'AKIA123' });

      const result = profileConfigService.deleteProfile('to-delete');

      test.expect(result).toBe(true);
      test.expect(mockAWS.profiles.has('to-delete')).toBe(false);
      test.expect(mockAWS.credentials.has('to-delete')).toBe(false);
    });

    test.it('should clone profile', async () => {
      mockAWS.profiles.set('source', {
        region: 'us-east-1',
        output: 'json',
        op_item: 'AWS source'
      });

      const cloned = await profileConfigService.cloneProfile('source', 'target');

      test.expect(cloned.region).toBe('us-east-1');
      test.expect(cloned.output).toBe('json');
      test.expect(cloned.op_item).toBe('AWS target');

      const savedProfile = mockAWS.profiles.get('target');
      test.expect(savedProfile).toBeTruthy();
    });

    test.it('should export profile', () => {
      mockAWS.profiles.set('export-test', {
        region: 'us-east-1',
        output: 'json'
      });
      mockAWS.credentials.set('export-test', {
        AccessKeyId: 'AKIA123',
        SecretAccessKey: 'secret123'
      });

      const exported = profileConfigService.exportProfile('export-test');

      test.expect(exported.name).toBe('export-test');
      test.expect(exported.config.region).toBe('us-east-1');
      test.expect(exported.credentials.AccessKeyId).toBe('AKIA123');
    });

    test.it('should import profile', () => {
      const profileData = {
        name: 'imported',
        config: {
          region: 'eu-central-1',
          output: 'table'
        },
        credentials: {
          AccessKeyId: 'AKIAIMPORT',
          SecretAccessKey: 'importSecret'
        }
      };

      const result = profileConfigService.importProfile(profileData);

      test.expect(result).toBe(true);
      test.expect(mockAWS.profiles.has('imported')).toBe(true);
      test.expect(mockAWS.credentials.get('imported').AccessKeyId).toBe('AKIAIMPORT');
    });

    test.it('should validate SSO profile', () => {
      // Valid SSO profile
      mockAWS.profiles.set('valid-sso', {
        sso_start_url: 'https://company.awsapps.com/start',
        sso_region: 'us-east-1',
        sso_account_id: '123456789012',
        sso_role_name: 'Developer'
      });

      const validResult = profileConfigService.validateProfile('valid-sso');
      test.expect(validResult.valid).toBe(true);
      test.expect(validResult.errors.length).toBe(0);

      // Invalid SSO profile
      mockAWS.profiles.set('invalid-sso', {
        sso_start_url: 'https://company.awsapps.com/start',
        sso_region: 'us-east-1'
        // Missing account_id and role_name
      });

      const invalidResult = profileConfigService.validateProfile('invalid-sso');
      test.expect(invalidResult.valid).toBe(false);
      test.expect(invalidResult.errors).toContain('Missing SSO account ID');
      test.expect(invalidResult.errors).toContain('Missing SSO role name');
    });

    test.it('should validate MFA profile', () => {
      // Valid MFA profile
      mockAWS.profiles.set('valid-mfa', {
        aws_access_key_id: 'AKIA123',
        aws_secret_access_key: 'secret123',
        mfa_serial: 'arn:aws:iam::123456789012:mfa/user'
      });

      const validResult = profileConfigService.validateProfile('valid-mfa');
      test.expect(validResult.valid).toBe(true);

      // Invalid MFA profile
      mockAWS.profiles.set('invalid-mfa', {
        mfa_serial: 'arn:aws:iam::123456789012:mfa/user'
        // Missing credentials
      });

      const invalidResult = profileConfigService.validateProfile('invalid-mfa');
      test.expect(invalidResult.valid).toBe(false);
      test.expect(invalidResult.errors).toContain('Missing access key for MFA profile');
    });

    test.it('should migrate legacy profiles', async () => {
      // Add legacy format profiles
      mockAWS.profiles.set('legacy1', {
        aws_security_token: 'oldToken123',
        mfa_device: 'arn:aws:iam::123456789012:mfa/old',
        region: 'us-east-1'
      });

      mockAWS.profiles.set('legacy2', {
        aws_security_token: 'oldToken456',
        region: 'us-west-2'
      });

      const migrated = await profileConfigService.migrateProfiles('legacy', 'modern');

      test.expect(migrated.length).toBe(2);
      test.expect(migrated).toContain('legacy1');
      test.expect(migrated).toContain('legacy2');

      // Check migration
      const profile1 = mockAWS.profiles.get('legacy1');
      test.expect(profile1.aws_session_token).toBe('oldToken123');
      test.expect(profile1.aws_security_token).toBeUndefined();
      test.expect(profile1.mfa_serial).toBe('arn:aws:iam::123456789012:mfa/old');
      test.expect(profile1.mfa_device).toBeUndefined();
    });

    test.it('should handle profile not found errors', () => {
      try {
        profileConfigService.deleteProfile('non-existent');
        test.expect(false).toBe(true); // Should not reach
      } catch (error) {
        test.expect(error.message).toBe("Profile 'non-existent' not found");
      }

      try {
        profileConfigService.exportProfile('non-existent');
        test.expect(false).toBe(true); // Should not reach
      } catch (error) {
        test.expect(error.message).toBe("Profile 'non-existent' not found");
      }
    });
  });
};