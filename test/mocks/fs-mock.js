'use strict';

/**
 * File System Mock for testing
 */

class FSMock {
  constructor() {
    this.files = new Map();
    this.reset();
  }

  reset() {
    this.files.clear();

    // Add default AWS config files
    this.files.set('/home/user/.aws/config', `
[default]
region = us-east-1

[profile test-sso]
sso_start_url = https://test.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = TestRole
region = us-east-1

[profile test-mfa]
mfa_serial = arn:aws:iam::123456789012:mfa/testuser
region = us-east-1
`);

    this.files.set('/home/user/.aws/credentials', `
[default]
aws_access_key_id = AKIADEFAULT123456
aws_secret_access_key = defaultSecret123456

[test-mfa]
aws_access_key_id = AKIATEST123456
aws_secret_access_key = testSecret123456
`);

    this.files.set('/tmp/mfa-secret.txt', 'TESTMFASECRETBASE32STRING');
  }

  existsSync(path) {
    return this.files.has(path);
  }

  readFileSync(path, encoding) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return this.files.get(path);
  }

  writeFileSync(path, content, encoding) {
    this.files.set(path, content);
  }

  unlinkSync(path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    this.files.delete(path);
  }

  mkdirSync(path, options) {
    // Mock directory creation
    return true;
  }

  readdirSync(path) {
    // Return mock directory contents
    const files = [];
    for (const [filePath, content] of this.files) {
      if (filePath.startsWith(path)) {
        const relativePath = filePath.substring(path.length + 1);
        if (!relativePath.includes('/')) {
          files.push(relativePath);
        }
      }
    }
    return files;
  }

  statSync(path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return {
      isFile: () => true,
      isDirectory: () => false,
      size: this.files.get(path).length,
      mtime: new Date()
    };
  }
}

module.exports = { FSMock };

