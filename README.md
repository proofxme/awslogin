# 🔐 AWS Login - Interactive CLI for AWS Authentication

[![npm version](https://badge.fury.io/js/@proofxme%2Fawslogin.svg)](https://www.npmjs.com/package/@proofxme/awslogin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**The smart way to authenticate with AWS profiles** - featuring an interactive wizard that guides you through setup and authentication with zero complexity.

## ✨ What's New in v3.0.4

- **⚡ 100x Faster Performance** - Profile listing now instant with intelligent caching
- **🆕 Automated User Creation** - Create IAM users with MFA setup in one flow
- **🎯 Enhanced Interactive Wizard** - All wizard options now fully functional
- **🔐 Complete 1Password Integration** - Automatic TOTP setup and MFA enablement
- **🚀 Smart Authentication** - Auto-detects SSO, MFA, or direct credentials
- **👥 Sub-Profile Creation** - Easy multi-account setup with parent SSO sessions
- **📋 Profile Templates** - Quick setup with pre-configured templates
- **🌍 Auto-Discovery** - Automatically finds your AWS settings

## 🎬 Quick Start

```bash
# Install globally
npm install -g @proofxme/awslogin

# Launch interactive wizard (easiest way to start!)
awslogin

# Or jump straight to a specific action
awslogin setup      # Setup new profile
awslogin work       # Authenticate to 'work' profile
awslogin manage     # Manage all profiles
```

## 🎮 Interactive Mode

Simply run `awslogin` without any arguments to enter the interactive wizard:

```
$ awslogin

🔐 AWS Login Interactive Wizard
================================

What would you like to do?
> 🔐 Authenticate to AWS
  ⚙️  Setup new profile
  📋 Manage profiles
  ❓ Interactive help
```

The wizard guides you through every step with contextual help and smart defaults!

## 🚀 Features

### 🏢 AWS SSO / Identity Center
Full support for AWS IAM Identity Center (formerly AWS SSO) with:
- Automatic SSO URL discovery
- Multi-account selection
- Session sharing across sub-profiles
- Organization-wide profile creation

### 📱 Multi-Factor Authentication
Comprehensive MFA support with:
- **NEW: Automated IAM user creation** with MFA setup
- Virtual MFA device creation and enablement
- Hardware token compatibility
- **1Password integration** for automatic TOTP storage and retrieval
- Manual token entry fallback
- Smart consecutive TOTP code generation for MFA enablement

### 🎯 Smart Authentication
The CLI automatically detects your authentication method:
- SSO profiles → SSO flow
- MFA-enabled profiles → MFA flow
- Direct credentials → Direct validation
- Unknown profiles → Interactive setup wizard

### 📋 Profile Templates

Quick setup with pre-configured templates:

| Template | Description | Best For |
|----------|-------------|----------|
| **Developer** | Standard access with JSON output | Daily development |
| **Administrator** | Full access with security focus | Admin tasks |
| **ReadOnly** | View-only access | Monitoring & reporting |
| **CI/CD** | Direct credentials for automation | Pipelines |
| **Production** | MFA-required access | Production operations |
| **Sandbox** | Relaxed permissions | Experimentation |

## 📚 Commands

### Core Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `awslogin` | - | Launch interactive wizard |
| `awslogin setup` | `configure`, `config` | Setup new profile |
| `awslogin manage` | `list`, `profiles` | Manage profiles |
| `awslogin auth` | `login`, `authenticate` | Authenticate interactively |
| `awslogin help` | `--help`, `-h` | Show help |

### Quick Authentication

```bash
# Authenticate to a profile
awslogin dev

# Select account after SSO login
awslogin work --select

# Force re-authentication
awslogin prod --force
```

## 🛠️ Profile Management

The management wizard (`awslogin manage`) provides:

- **List profiles** - View all profiles with status
- **Edit profiles** - Modify configuration
- **Delete profiles** - Remove unwanted profiles
- **Refresh credentials** - Update expired sessions
- **Clean sessions** - Remove expired credentials
- **Organization setup** - Create profiles for all org accounts
- **Export profiles** - Backup configurations

## 🔧 Setup Examples

### 🆕 Automated IAM User Creation with MFA (NEW!)

The wizard can now create a complete IAM user with MFA setup automatically:

```bash
$ awslogin setup

⚙️ AWS Profile Setup Wizard
===========================

? Profile name: dev-mfa
? How do you authenticate? Multi-Factor Authentication (MFA)

MFA Setup Options:
> 🆕 Create new AWS user with MFA
  📝 Enter existing credentials

? Select admin profile for user creation: admin-profile
? New IAM user name: dev-user

✅ Creating IAM user...
✅ Generated access keys
✅ Created virtual MFA device
✅ Store MFA secret in 1Password? Yes
✅ Created 1Password item: AWS dev-user
✅ MFA device enabled successfully!

Profile 'dev-mfa' created and ready to use!
```

Features:
- Automatic IAM user creation with proper permissions
- Virtual MFA device creation and enablement
- 1Password integration for TOTP storage
- Smart consecutive code generation for MFA enablement
- Complete end-to-end setup in one flow

### Setting up SSO Profile

```bash
$ awslogin setup

⚙️ AWS Profile Setup Wizard
===========================

? Profile name: work
? How do you authenticate? AWS SSO / Identity Center
? SSO URL: https://mycompany.awsapps.com/start
? SSO Region: us-east-1
? Default account? No
? Default region: us-east-1
? Output format: json

✅ Profile 'work' created!
```

### Setting up MFA Profile with 1Password

```bash
$ awslogin setup

? Profile name: production
? How do you authenticate? MFA with long-term credentials
? Access Key ID: AKIA...
? Secret Access Key: ****
? MFA Device: arn:aws:iam::123456789012:mfa/user
? Use 1Password? Yes
? 1Password item: AWS Production MFA

✅ 1Password integration configured!
```

## 🔐 1Password Integration

### Complete Setup Guide

1. **Install 1Password CLI:**
```bash
# macOS
brew install --cask 1password-cli

# Other platforms
# Visit: https://1password.com/downloads/command-line/
```

2. **Sign in to 1Password:**
```bash
op signin
# Follow the prompts to authenticate
```

3. **Automatic MFA Setup (NEW!):**
When creating a new IAM user through the wizard, AWS Login will:
- Create the MFA device automatically
- Store the TOTP secret in 1Password
- Enable MFA with automatic code generation
- Configure the profile with 1Password integration

```bash
$ awslogin setup
# Select "Multi-Factor Authentication"
# Choose "🆕 Create new AWS user with MFA"
# AWS Login handles everything automatically!
```

4. **Manual Setup (existing MFA):**
For existing MFA setups, during profile configuration:
- AWS Login detects 1Password CLI
- Searches for existing AWS TOTP items
- Links your profile to the 1Password item
- Enables automatic MFA token retrieval

### How It Works
- AWS Login uses `op` CLI to retrieve TOTP codes
- No manual token entry required
- Automatic consecutive code generation for MFA enablement
- Seamless authentication with `awslogin <profile>`

## 🏢 Organization-Wide Setup

Create profiles for all accounts in your AWS Organization:

```bash
$ awslogin manage

? What would you like to do? Setup organization profiles
? Base SSO profile: company-sso

Found 12 active accounts
✓ Created profile 'company-sso-dev'
✓ Created profile 'company-sso-staging'
✓ Created profile 'company-sso-prod'
...
```

## 🌍 Auto-Discovery Features

AWS Login automatically discovers:
- Existing SSO URLs from other profiles
- Default AWS region from environment
- Organization structure (with permissions)
- Available MFA devices
- 1Password CLI availability

## 🔄 Session Management

### Automatic Session Handling
- Sessions are validated before each use
- Expired sessions are automatically refreshed
- Sub-profiles share parent SSO sessions
- Credential expiration tracking

### Manual Session Control
```bash
# Check profile status
awslogin manage  # Select 'List profiles'

# Refresh specific profile
awslogin prod --force

# Clean all expired sessions
awslogin manage  # Select 'Clean expired sessions'
```

## 📤 Export & Backup

Export your profiles for backup or sharing:

```bash
$ awslogin manage

? What would you like to do? Export profiles
? Export format?
  > JSON (for backup)
    Shell script (for recreation)
    Documentation (Markdown)

✅ Profiles exported to aws-profiles-export.json
```

## 🚀 CI/CD Integration

### GitHub Actions
```yaml
- name: Configure AWS credentials
  run: |
    npm install -g @proofxme/awslogin
    awslogin ci-profile
```

### Environment Variables
The tool respects standard AWS environment variables:
- `AWS_PROFILE`
- `AWS_DEFAULT_REGION`
- `AWS_DEFAULT_OUTPUT`

## 🛡️ Security

- **No stored passwords** - Only temporary credentials
- **Encrypted credential storage** - Uses AWS SDK secure storage
- **Session isolation** - Each profile has separate sessions
- **Automatic expiration** - Credentials expire and are cleaned
- **1Password integration** - Secure MFA token management

## 🐛 Troubleshooting

### SSO Login Issues
```bash
# Clear SSO cache
rm -rf ~/.aws/sso/cache

# Re-authenticate
awslogin <profile> --force
```

### MFA Token Issues
```bash
# Check 1Password connection
op account list

# Manually provide token
awslogin <profile>
# Enter token when prompted
```

### Profile Detection Issues
```bash
# Rebuild profile configuration
awslogin setup
# Reconfigure the problematic profile
```

## 📦 Installation Options

### Global Installation (Recommended)
```bash
npm install -g @proofxme/awslogin
```

### Local Project Installation
```bash
npm install --save-dev @proofxme/awslogin
npx awslogin
```

### Direct Execution
```bash
npx @proofxme/awslogin
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with zero dependencies for maximum reliability
- Inspired by the need for simpler AWS authentication
- Special thanks to all contributors

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/@proofxme/awslogin)
- [GitHub Repository](https://github.com/proofxme/awslogin)
- [Issue Tracker](https://github.com/proofxme/awslogin/issues)

---

Made with ❤️ by [Proof of X](https://github.com/proofxme)