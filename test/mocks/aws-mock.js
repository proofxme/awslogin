'use strict';

/**
 * AWS CLI Mock for testing
 */

class AWSMock {
  constructor() {
    this.profiles = new Map();
    this.credentials = new Map();
    this.mfaDevices = new Map();
    this.users = new Map();
    this.ssoSessions = new Map();
    this.reset();
  }

  reset() {
    this.profiles.clear();
    this.credentials.clear();
    this.mfaDevices.clear();
    this.users.clear();
    this.ssoSessions.clear();

    // Add default test data
    this.profiles.set('test-sso', {
      sso_start_url: 'https://test.awsapps.com/start',
      sso_region: 'us-east-1',
      sso_account_id: '123456789012',
      sso_role_name: 'TestRole',
      region: 'us-east-1'
    });

    this.profiles.set('test-mfa', {
      aws_access_key_id: 'AKIATEST123456',
      aws_secret_access_key: 'testSecret123456',
      mfa_serial: 'arn:aws:iam::123456789012:mfa/testuser',
      region: 'us-east-1'
    });

    this.users.set('testuser', {
      UserId: 'AIDATEST123456',
      Arn: 'arn:aws:iam::123456789012:user/testuser',
      UserName: 'testuser',
      CreateDate: '2025-01-01T00:00:00Z'
    });

    this.mfaDevices.set('arn:aws:iam::123456789012:mfa/testuser', {
      SerialNumber: 'arn:aws:iam::123456789012:mfa/testuser',
      EnableDate: '2025-01-01T00:00:00Z'
    });
  }

  // Mock AWS CLI commands
  executeCommand(args) {
    const [service, operation, ...params] = args;

    if (service === 'configure') {
      return this.handleConfigure(operation, params);
    }

    if (service === 'sts') {
      return this.handleSts(operation, params);
    }

    if (service === 'iam') {
      return this.handleIam(operation, params);
    }

    if (service === 'sso') {
      return this.handleSso(operation, params);
    }

    return {
      success: false,
      stderr: 'Unknown AWS command',
      stdout: '',
      code: 1
    };
  }

  handleConfigure(operation, params) {
    if (operation === 'list-profiles') {
      return {
        success: true,
        stdout: Array.from(this.profiles.keys()).join('\n'),
        stderr: '',
        code: 0
      };
    }

    if (operation === 'get') {
      const profile = this.extractProfile(params);
      const key = params[0];
      const profileData = this.profiles.get(profile) || {};
      return {
        success: true,
        stdout: profileData[key] || '',
        stderr: '',
        code: 0
      };
    }

    if (operation === 'set') {
      const profile = this.extractProfile(params);
      const [key, value] = params;
      if (!this.profiles.has(profile)) {
        this.profiles.set(profile, {});
      }
      this.profiles.get(profile)[key] = value;
      return {
        success: true,
        stdout: '',
        stderr: '',
        code: 0
      };
    }

    return {
      success: false,
      stderr: 'Invalid configure command',
      stdout: '',
      code: 1
    };
  }

  handleSts(operation, params) {
    if (operation === 'get-caller-identity') {
      const profile = this.extractProfile(params);
      const profileData = this.profiles.get(profile);

      if (!profileData) {
        return {
          success: false,
          stderr: 'Unable to locate credentials',
          stdout: '',
          code: 1
        };
      }

      return {
        success: true,
        stdout: JSON.stringify({
          UserId: 'AIDATEST123456',
          Account: '123456789012',
          Arn: 'arn:aws:iam::123456789012:user/testuser'
        }),
        stderr: '',
        code: 0
      };
    }

    if (operation === 'get-session-token') {
      return {
        success: true,
        stdout: JSON.stringify({
          Credentials: {
            AccessKeyId: 'ASIATEST123456',
            SecretAccessKey: 'testSessionSecret',
            SessionToken: 'testSessionToken',
            Expiration: new Date(Date.now() + 3600000).toISOString()
          }
        }),
        stderr: '',
        code: 0
      };
    }

    return {
      success: false,
      stderr: 'Invalid STS command',
      stdout: '',
      code: 1
    };
  }

  handleIam(operation, params) {
    if (operation === 'create-user') {
      const username = this.extractValue(params, '--user-name');
      const user = {
        UserName: username,
        UserId: `AIDA${Math.random().toString(36).substr(2, 12).toUpperCase()}`,
        Arn: `arn:aws:iam::123456789012:user/${username}`,
        CreateDate: new Date().toISOString()
      };
      this.users.set(username, user);
      return {
        success: true,
        stdout: JSON.stringify({ User: user }),
        stderr: '',
        code: 0
      };
    }

    if (operation === 'create-access-key') {
      const username = this.extractValue(params, '--user-name');
      return {
        success: true,
        stdout: JSON.stringify({
          AccessKey: {
            AccessKeyId: `AKIA${Math.random().toString(36).substr(2, 12).toUpperCase()}`,
            SecretAccessKey: Math.random().toString(36).substr(2, 40),
            UserName: username,
            Status: 'Active',
            CreateDate: new Date().toISOString()
          }
        }),
        stderr: '',
        code: 0
      };
    }

    if (operation === 'create-virtual-mfa-device') {
      const deviceName = this.extractValue(params, '--virtual-mfa-device-name');
      const serial = `arn:aws:iam::123456789012:mfa/${deviceName}`;
      this.mfaDevices.set(serial, {
        SerialNumber: serial
      });
      return {
        success: true,
        stdout: JSON.stringify({
          VirtualMFADevice: {
            SerialNumber: serial
          }
        }),
        stderr: '',
        code: 0
      };
    }

    if (operation === 'enable-mfa-device') {
      const username = this.extractValue(params, '--user-name');
      const serial = this.extractValue(params, '--serial-number');
      this.mfaDevices.get(serial).EnableDate = new Date().toISOString();
      return {
        success: true,
        stdout: '',
        stderr: '',
        code: 0
      };
    }

    if (operation === 'list-mfa-devices') {
      const username = this.extractValue(params, '--user-name');
      const devices = Array.from(this.mfaDevices.values()).filter(d => d.EnableDate);
      return {
        success: true,
        stdout: JSON.stringify({ MFADevices: devices }),
        stderr: '',
        code: 0
      };
    }

    return {
      success: false,
      stderr: 'Invalid IAM command',
      stdout: '',
      code: 1
    };
  }

  handleSso(operation, params) {
    if (operation === 'login') {
      const profile = this.extractProfile(params);
      this.ssoSessions.set(profile, {
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
      return {
        success: true,
        stdout: 'Successfully logged into Start URL',
        stderr: '',
        code: 0
      };
    }

    if (operation === 'list-accounts') {
      return {
        success: true,
        stdout: JSON.stringify({
          accountList: [
            {
              accountId: '123456789012',
              accountName: 'Test Account',
              emailAddress: 'test@example.com'
            }
          ]
        }),
        stderr: '',
        code: 0
      };
    }

    return {
      success: false,
      stderr: 'Invalid SSO command',
      stdout: '',
      code: 1
    };
  }

  extractProfile(params) {
    const profileIndex = params.indexOf('--profile');
    return profileIndex !== -1 ? params[profileIndex + 1] : 'default';
  }

  extractValue(params, flag) {
    const index = params.indexOf(flag);
    return index !== -1 ? params[index + 1] : null;
  }
}

module.exports = { AWSMock };

