# AWS Profile Authentication CLI

A smart CLI tool that streamlines authentication with AWS profiles, supporting multiple authentication methods including SSO, MFA, and direct credential usage.

## Features

- **Intelligent Authentication Flow**: Automatically detects and uses the appropriate authentication method for each profile
- **Supports Multiple Authentication Methods**:
  - AWS SSO (Single Sign-On) with account selection
  - MFA (Multi-Factor Authentication) with long-term credentials
  - Direct credential usage
- **Account Selection for SSO**: Choose specific accounts and roles when using SSO profiles with access to multiple accounts
- **Smart Credential Caching**: Caches selected account credentials in sub-profiles for efficient re-use
- **Session Validation**: Validates existing AWS sessions before attempting re-authentication to avoid unnecessary login prompts  
- **Smart Fallback Mechanism**: Falls back to simpler authentication methods when possible
- **Token Expiration Checking**: Only requests re-authentication when tokens have expired or are about to expire
- **1Password Integration**: Automatically retrieves MFA tokens from 1Password if the CLI is installed
- **Profile Configuration Wizard**: Interactive setup for profile preferences and integrations
- **User-Friendly Messages**: Clear, emoji-enhanced status messages

## Installation

### Global Installation (Recommended)

```bash
npm install -g aws-profile-auth-cli
```

After installation, the `awslogin` command will be available globally in your terminal.

### Local Installation

```bash
npm install aws-profile-auth-cli
```

With local installation, you can run the command using npx:

```bash
npx awslogin <profile_name>
```

## Requirements

- **Node.js**: v14.0.0 or higher
- **AWS CLI**: v2.x installed and configured

## Usage

```bash
awslogin <profile_name> [options]
```

Options:
- `--select`: Prompt for account selection after SSO authentication (for SSO profiles with multiple accounts)
- `--token <mfa_token>`: Provide MFA token directly without prompting
- `--setup-iam-identity-center`: Configure cross-account access through IAM Identity Center
- `--clean`: Remove temporary credentials from AWS profile (with confirmation prompt)
- `--configure`: Run the profile configuration wizard (1Password integration, MFA settings, regional preferences)
- `--configure --all-org`: Create profiles for all AWS organization accounts with standardized naming (main_profile-account_name)
- `--change`: Force selection of a different account, ignoring existing sub-profiles

Examples:

```bash
# Simple authentication
awslogin mycompany-dev

# SSO with account selection
awslogin dcycle --select

# MFA with token provided
awslogin myprofile --token 123456

# Set up IAM Identity Center for cross-account access
awslogin dcycle --setup-iam-identity-center

# Clean up temporary credentials from a profile
awslogin dcycle --clean

# Configure profile settings and integrations
awslogin dcycle --configure

# Create profiles for all AWS organization accounts (standardized naming)
awslogin dcycle --configure --all-org

# Select a different account (change accounts)
awslogin dcycle --change
```

## Authentication Flow

The tool follows this authentication flow:

1. **Check if profile exists** in AWS config
2. **Determine authentication type**:
   - If profile has SSO configured (either direct or via sso_session):
     - First validates the existing session with a lightweight AWS API call (S3 head-bucket)
     - If session is still valid, uses existing credentials without re-authentication
     - If session is invalid, proceeds with SSO authentication
   - If not SSO: Try direct authentication first
     - First validates the existing session with a lightweight AWS API call
     - If session is valid, checks token expiration time
     - If tokens are still valid, uses existing credentials without re-authentication
     - If tokens are expired or will expire soon (within 15 minutes), requests new tokens
   - If direct authentication fails: Try MFA if a long-term profile exists

## Configuration

This tool works with your existing AWS CLI configuration files. No additional configuration is required.

### MFA Authentication

The tool uses AWS CLI's native `sts get-session-token` command for MFA authentication. When using a profile with MFA configured:

1. The tool detects the MFA device ARN from the long-term profile
2. Prompts for the MFA token
3. Gets temporary session credentials using AWS STS
4. Stores the temporary credentials in the specified profile
5. Verifies the authentication was successful

No additional packages are required for MFA support.

### AWS Configuration

Your AWS configuration should be properly set up in the standard AWS CLI config files:

- `~/.aws/config`
- `~/.aws/credentials`

### Profile Types

The tool supports three types of AWS profiles:

#### 1. SSO Profiles

The tool supports two types of SSO configurations:

**A. Direct SSO Configuration (Legacy):**

```ini
[profile mycompany]
sso_start_url = https://mycompany.awsapps.com/start/
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
region = us-west-2
output = json
```

**B. Browser-based SSO with `sso_session` Reference (Recommended):**

```ini
[profile mycompany]
sso_session = mycompany
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
region = us-west-2
output = json

[sso-session mycompany]
sso_start_url = https://mycompany.awsapps.com/start/
sso_region = us-east-1
sso_registration_scopes = sso:account:access
```

#### 2. MFA Profiles

For MFA-based authentication, you need two profiles:
- A long-term profile with permanent credentials: `<profile-name>-long-term`
- A profile for the temporary session credentials: `<profile-name>`

Example:

```ini
[profile myprofile-long-term]
aws_access_key_id = AKIAXXXXXXXXXXXXXXXX
aws_secret_access_key = XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
mfa_serial = arn:aws:iam::123456789012:mfa/myuser

[profile myprofile]
region = us-west-2
output = json
```

#### 3. Direct Profiles

Simple profiles that use direct API credentials:

```ini
[profile simple-profile]
aws_access_key_id = AKIAXXXXXXXXXXXXXXXX
aws_secret_access_key = XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
region = us-west-2
output = json
```

### Account Selection for SSO Profiles

When working with AWS SSO profiles that have access to multiple accounts, you can use the `--select` flag to choose which account and role to use:

```bash
awslogin dcycle --select
```

### Cleaning Up Profile Credentials

You can remove temporary credentials from an AWS profile using the `--clean` flag:

```bash
awslogin dcycle --clean
```

This will:
1. Prompt for confirmation before proceeding
2. Remove temporary credentials (access keys, secret keys, and session tokens)
3. Remove expiration timestamps
4. For sub-profiles created with `--select`, also remove metadata like account_id and role_name

This is useful when:
- You're experiencing authentication issues
- You want to force re-authentication on the next login
- You want to clean up sensitive information from your AWS config files

### Changing Between Accounts

You can switch between different accounts in your organization using the `--change` flag:

```bash
awslogin dcycle --change
```

This will:
1. Verify or establish a valid SSO session
2. Always prompt for account selection regardless of existing sub-profiles
3. Create a new sub-profile for the selected account if it doesn't exist
4. Switch the current session to use the selected account and role

This is particularly useful when:
- You need to quickly switch between different accounts in your organization
- You want to access an account that you haven't previously created a sub-profile for
- You want to change roles within the same account

### Profile Configuration Wizard

The profile configuration wizard provides an interactive way to configure profile settings and integrations:

```bash
awslogin dcycle --configure
```

The wizard allows you to configure:

#### 1. 1Password Integration

If you have the 1Password CLI installed, the tool can automatically fetch MFA tokens:
- Detects 1Password CLI installation and authentication
- Connects AWS profiles with 1Password items that have MFA TOTP codes
- Saves 1Password item references in your AWS config for automatic retrieval

#### 2. MFA Settings

Configure MFA for your profiles:
- Set up long-term profiles for MFA authentication
- Configure MFA device ARNs
- Input and store your permanent AWS credentials

#### 3. Advanced Options

Configure regional preferences and output formats:
- Default AWS region selection
- Output format selection (JSON, YAML, text, table)

The configuration is stored in your AWS config file and used for future authentication attempts.

### Organization-Wide Profile Configuration

You can create profiles for all AWS organization accounts with standardized naming using:

```bash
awslogin dcycle --configure --all-org
```

This command:
1. Authenticates with the specified base profile
2. Retrieves all accounts from the AWS organization
3. Creates profiles for each account with standardized naming: `[profile main_profile-account_name]`
4. Configures each profile with the appropriate account ID, role, and other settings
5. Makes the profiles immediately usable without additional authentication steps

This is particularly useful for:
- Setting up consistent access to multiple AWS accounts in your organization
- Creating a standardized naming scheme for easier automation and scripting
- Ensuring all accounts are accessible with proper permissions and roles

Once configured, you can use these profiles directly:
```bash
aws --profile dcycle-account-name s3 ls
# or
awslogin dcycle-account-name
```

When using SSO account selection, this will:
1. Authenticate with AWS SSO
2. List all available accounts
3. Prompt you to select an account
4. List all available roles for that account
5. Prompt you to select a role
6. Create a sub-profile with the format `<profile>-<account-name>`
7. Store the temporary credentials in the sub-profile

The sub-profiles are cached, so subsequent runs will check for valid credentials first:
- If valid credentials exist in a sub-profile, they will be used automatically
- If credentials are expired, you'll be prompted to re-authenticate

Example workflow:

```bash
$ awslogin dcycle --select
🔐 Authenticating with AWS SSO for profile: dcycle
🌐 Using browser-based SSO authentication with session: dcycle
...
🔍 Retrieving available SSO accounts...

📋 Available AWS accounts:
   1. Development (123456789012)
   2. Staging (234567890123)
   3. Production (345678901234)

Select an account (enter number): 1

✅ Selected account: Development (123456789012)
🔍 Retrieving available roles for account 123456789012...

📋 Available roles:
   1. AdministratorAccess
   2. PowerUserAccess
   3. ReadOnlyAccess

Select a role (enter number): 1
✅ Selected role: AdministratorAccess

🔄 Creating sub-profile: dcycle-development
✅ Successfully created sub-profile: dcycle-development

💡 You can now use the sub-profile with: aws --profile dcycle-development <command>
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/AdministratorAccess/username"
}
```

On subsequent runs, if the credentials are still valid:

```bash
$ awslogin dcycle --select
🔍 Found existing sub-profiles for dcycle:
   1. dcycle-development - Account: 123456789012, Role: AdministratorAccess
   2. dcycle-staging - Account: 234567890123, Role: PowerUserAccess

✅ Found valid credentials in sub-profile: dcycle-development
💡 Using existing credentials (use awslogin dcycle --select to refresh)

{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/AdministratorAccess/username"
}
```

## Examples

### Example 1: SSO Authentication

#### Direct SSO Authentication:

```bash
$ awslogin mycompany-dev
🔐 Authenticating with AWS SSO for profile: mycompany-dev
✅ Successfully authenticated with AWS SSO for profile: mycompany-dev
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/AdministratorAccess/username"
}
```

#### Browser-based SSO Authentication:

```bash
$ awslogin dcycle
🔐 Authenticating with AWS SSO for profile: dcycle
🌐 Using browser-based SSO authentication with session: dcycle
✅ Successfully authenticated with AWS SSO for profile: dcycle
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "587922392833",
    "Arn": "arn:aws:sts::587922392833:assumed-role/AdministratorAccess/username"
}
```

### Example 2: MFA Authentication

```bash
$ awslogin production
🔑 Attempting direct authentication for profile: production
🔐 Attempting MFA authentication for profile: production
Enter MFA token: 123456
✅ Successfully authenticated with MFA for profile: production
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/PowerUserAccess/username"
}
```

### Example 3: Direct Authentication

```bash
$ awslogin simple-profile
🔑 Attempting direct authentication for profile: simple-profile
✅ Successfully authenticated using profile: simple-profile
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/apiuser"
}
```

### Example 4: Token Expiration Handling

```bash
# First authentication (stores token expiration time)
$ awslogin dev-profile
🔐 Attempting MFA authentication for profile: dev-profile
Enter MFA token: 123456
✅ Successfully authenticated with MFA for profile: dev-profile
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/PowerUserAccess/username"
}

# Later, running the command again with valid tokens
$ awslogin dev-profile
🔑 Attempting direct authentication for profile: dev-profile
✅ Successfully authenticated using profile: dev-profile (valid until 2023-04-25 18:30:45)
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/PowerUserAccess/username"
}

# When tokens are expiring soon
$ awslogin dev-profile
🔑 Attempting direct authentication for profile: dev-profile
⚠️ Credentials for profile dev-profile have expired or will expire soon. Refreshing...
🔐 Attempting MFA authentication for profile: dev-profile
Enter MFA token: 654321
✅ Successfully authenticated with MFA for profile: dev-profile
{
    "UserId": "AROAXXXXXXXXXXXXXXXX:username",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/PowerUserAccess/username"
}
```

## Cross-Account Access with IAM Identity Center

This tool provides an easy way to set up and use cross-account access through AWS IAM Identity Center (formerly AWS SSO). 

### Setting Up Cross-Account Access

To set up cross-account access properly:

```bash
awslogin your-sso-profile --setup-iam-identity-center
```

This command will:
1. Verify your authentication and IAM Identity Center setup
2. Provide step-by-step guidance for configuring cross-account access
3. List available accounts in your AWS Organization
4. Show existing permission sets in your IAM Identity Center

Benefits of using IAM Identity Center for cross-account access:
- No need to modify IAM role trust policies
- Centralized management of all account access
- Unified permission sets across accounts
- Automatic account discovery from AWS Organizations

### Using Cross-Account Access

Once set up, you can access any account where you have been assigned a permission set:

```bash
awslogin your-sso-profile --select
```

This will:
1. Authenticate with AWS SSO
2. List all accounts where you have access
3. Allow you to select an account and role
4. Create a profile with temporary credentials

## Best Practices

### Security Best Practices

1. **Use SSO when possible**: AWS SSO is more secure than long-term access keys
2. **Enable MFA for all IAM users**: Always use MFA with long-term credentials
3. **Rotate credentials regularly**: Change your long-term access keys periodically
4. **Use least privilege**: Ensure your roles have only the permissions they need
5. **Use IAM Identity Center** for cross-account access instead of modifying role trust policies

### Usage Best Practices

1. **Name profiles consistently**: Use a consistent naming scheme for profiles
2. **Structure profiles by environment**: For example, `company-dev`, `company-prod`
3. **Set default regions**: Configure a default region for each profile
4. **Set default output format**: Configure a default output format (json, text, table)
5. **Use permission sets** in IAM Identity Center to standardize access across accounts

## Troubleshooting

### Common Issues

#### "Profile not found" error

```
❌ Profile example-profile not found
```

**Solution**: Check if the profile exists in your AWS config file. Run `aws configure list-profiles` to see available profiles.

#### SSO authentication fails

```
❌ Failed to authenticate with AWS SSO for profile: example-profile
```

**Solution**:
1. Ensure your SSO configuration is correct
2. Check if your SSO session is expired
3. Try manually running `aws sso login --profile example-profile`

#### MFA authentication fails

```
⚠️  MFA authentication failed
```

**Solution**:
1. Ensure your long-term profile exists and has correct credentials
2. Verify your MFA device ARN is correctly configured (check aws_mfa_device or mfa_serial in AWS config)
3. Make sure you're entering the correct MFA token
4. Check if your IAM user has permission to use STS services

#### Direct authentication fails

```
❌ Failed to authenticate using profile: example-profile
```

**Solution**:
1. Verify your credentials in the AWS credentials file
2. Check if your credentials have expired
3. Verify IAM permissions for the user
4. Try clearing temporary credentials with `awslogin example-profile --clean`

## Security Considerations

### Credential Storage

- **Long-term credentials** are stored in plaintext in `~/.aws/credentials`
- Consider using a credential manager for extra security
- When possible, prefer SSO over long-term credentials

### MFA Best Practices

- Always enable MFA for IAM users with console access
- Use virtual MFA devices or hardware tokens
- Configure MFA for the AWS root user

### Permission Boundaries

- Apply IAM permission boundaries to limit the maximum permissions
- Use AWS Organizations SCPs to establish permission guardrails

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by the AWS CLI and its authentication mechanisms
- Thanks to all contributors who have helped improve this tool

