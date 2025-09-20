'use strict';

/**
 * Setup Wizard Tests
 */

module.exports = async function(test) {
  test.describe('Setup Wizard', () => {
    let setupWizard;
    let mockAWS, mockPrompt, mockChild;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockPrompt = global.mockPrompt;
      mockChild = global.mockChild;

      mockAWS.reset();
      mockPrompt.reset();
      mockChild.reset();

      // Mock Setup Wizard
      setupWizard = {
        run: async function() {
          const config = {};

          // Get profile name
          config.profileName = await mockPrompt.input('Profile name:', {
            default: 'new-profile'
          });

          // Select auth method
          config.authMethod = await mockPrompt.select('Authentication method:', [
            { title: 'SSO', value: 'sso' },
            { title: 'MFA', value: 'mfa' },
            { title: 'Direct', value: 'direct' }
          ]);

          // Configure based on method
          await this.configureAuthMethod(config);

          // Save profile
          this.saveProfile(config);

          return config;
        },

        configureAuthMethod: async function(config) {
          switch (config.authMethod) {
            case 'sso':
              await this.configureSSO(config);
              break;
            case 'mfa':
              await this.configureMFA(config);
              break;
            case 'direct':
              await this.configureDirect(config);
              break;
          }
        },

        configureSSO: async function(config) {
          config.sso_start_url = await mockPrompt.input('SSO URL:');
          config.sso_region = await mockPrompt.input('SSO Region:', {
            default: 'us-east-1'
          });
          config.sso_account_id = await mockPrompt.input('Account ID:');
          config.sso_role_name = await mockPrompt.input('Role Name:', {
            default: 'AdministratorAccess'
          });
        },

        configureMFA: async function(config) {
          // New MFA setup flow
          const setupOption = await mockPrompt.select('MFA Setup:', [
            { title: 'Create new user', value: 'create' },
            { title: 'Enter existing', value: 'manual' }
          ]);

          if (setupOption === 'create') {
            await this.createUserWithMFA(config);
          } else {
            config.aws_access_key_id = await mockPrompt.input('Access Key ID:');
            config.aws_secret_access_key = await mockPrompt.password('Secret Access Key:');
            config.mfa_serial = await mockPrompt.input('MFA Serial:');
          }

          // 1Password integration
          const use1Password = await mockPrompt.confirm('Use 1Password?', true);
          if (use1Password) {
            config.op_item = await mockPrompt.input('1Password item name:');
          }
        },

        configureDirect: async function(config) {
          config.aws_access_key_id = await mockPrompt.input('Access Key ID:');
          config.aws_secret_access_key = await mockPrompt.password('Secret Access Key:');
        },

        createUserWithMFA: async function(config) {
          const username = await mockPrompt.input('New username:');

          // Simulate user creation
          const user = mockAWS.users.get(username) || {
            UserName: username,
            UserId: 'AIDANEWUSER123',
            Arn: `arn:aws:iam::123456789012:user/${username}`
          };
          mockAWS.users.set(username, user);

          // Generate credentials
          config.aws_access_key_id = 'AKIANEWUSER123456';
          config.aws_secret_access_key = 'newUserSecret123456';

          // Create MFA device
          config.mfa_serial = `arn:aws:iam::123456789012:mfa/${username}`;
          const mfaSecret = 'NEWUSERMFASECRET';

          // Setup 1Password
          config.op_item = `AWS ${username}`;

          // Enable MFA
          mockAWS.mfaDevices.set(config.mfa_serial, {
            SerialNumber: config.mfa_serial,
            EnableDate: new Date().toISOString()
          });

          return config;
        },

        saveProfile: function(config) {
          mockAWS.profiles.set(config.profileName, config);
        },

        applyTemplate: function(template) {
          const templates = {
            developer: {
              authMethod: 'sso',
              region: 'us-east-1',
              output: 'json'
            },
            administrator: {
              authMethod: 'mfa',
              region: 'us-east-1',
              output: 'json'
            },
            readonly: {
              authMethod: 'direct',
              region: 'us-east-1',
              output: 'table'
            }
          };

          return templates[template] || {};
        }
      };
    });

    test.it('should create SSO profile', async () => {
      mockPrompt.addResponses([
        'test-sso-new',  // Profile name
        'sso',  // Auth method
        'https://company.awsapps.com/start',  // SSO URL
        'us-west-2',  // SSO Region
        '987654321098',  // Account ID
        'DeveloperRole'  // Role name
      ]);

      const config = await setupWizard.run();

      test.expect(config.profileName).toBe('test-sso-new');
      test.expect(config.authMethod).toBe('sso');
      test.expect(config.sso_start_url).toBe('https://company.awsapps.com/start');
      test.expect(config.sso_account_id).toBe('987654321098');
    });

    test.it('should create MFA profile with manual setup', async () => {
      mockPrompt.addResponses([
        'test-mfa-new',  // Profile name
        'mfa',  // Auth method
        'manual',  // Setup option
        'AKIAMANUAL123456',  // Access Key
        'manualSecret123',  // Secret Key
        'arn:aws:iam::123456789012:mfa/manual',  // MFA Serial
        true,  // Use 1Password
        'AWS Manual'  // 1Password item
      ]);

      const config = await setupWizard.run();

      test.expect(config.profileName).toBe('test-mfa-new');
      test.expect(config.authMethod).toBe('mfa');
      test.expect(config.aws_access_key_id).toBe('AKIAMANUAL123456');
      test.expect(config.mfa_serial).toContain('mfa/manual');
      test.expect(config.op_item).toBe('AWS Manual');
    });

    test.it('should create MFA profile with user creation', async () => {
      mockPrompt.addResponses([
        'test-mfa-auto',  // Profile name
        'mfa',  // Auth method
        'create',  // Setup option
        'newuser'  // New username
      ]);

      const config = await setupWizard.run();

      test.expect(config.profileName).toBe('test-mfa-auto');
      test.expect(config.authMethod).toBe('mfa');
      test.expect(config.aws_access_key_id).toBeTruthy();
      test.expect(config.mfa_serial).toContain('mfa/newuser');
      test.expect(config.op_item).toBe('AWS newuser');

      // Verify user was created
      test.expect(mockAWS.users.has('newuser')).toBe(true);

      // Verify MFA device was created
      test.expect(mockAWS.mfaDevices.has(config.mfa_serial)).toBe(true);
    });

    test.it('should create direct credentials profile', async () => {
      mockPrompt.addResponses([
        'test-direct',  // Profile name
        'direct',  // Auth method
        'AKIADIRECT123456',  // Access Key
        'directSecret123'  // Secret Key
      ]);

      const config = await setupWizard.run();

      test.expect(config.profileName).toBe('test-direct');
      test.expect(config.authMethod).toBe('direct');
      test.expect(config.aws_access_key_id).toBe('AKIADIRECT123456');
      test.expect(config.aws_secret_access_key).toBe('directSecret123');
    });

    test.it('should save profile configuration', async () => {
      mockPrompt.addResponses([
        'save-test',
        'direct',
        'AKIASAVE123456',
        'saveSecret123'
      ]);

      const config = await setupWizard.run();

      // Verify profile was saved
      const savedProfile = mockAWS.profiles.get('save-test');
      test.expect(savedProfile).toBeTruthy();
      test.expect(savedProfile.aws_access_key_id).toBe('AKIASAVE123456');
    });

    test.it('should apply profile templates', () => {
      const devTemplate = setupWizard.applyTemplate('developer');
      test.expect(devTemplate.authMethod).toBe('sso');
      test.expect(devTemplate.output).toBe('json');

      const adminTemplate = setupWizard.applyTemplate('administrator');
      test.expect(adminTemplate.authMethod).toBe('mfa');

      const readonlyTemplate = setupWizard.applyTemplate('readonly');
      test.expect(readonlyTemplate.authMethod).toBe('direct');
      test.expect(readonlyTemplate.output).toBe('table');
    });
  });
};