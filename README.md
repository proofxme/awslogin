# AWS Profile Authentication CLI

A smart CLI tool that streamlines authentication with AWS profiles, supporting multiple authentication methods including SSO, MFA, and direct credential usage.

## Features

- **Intelligent Authentication Flow**: Automatically detects and uses the appropriate authentication method for each profile
- **Supports Multiple Authentication Methods**:
  - AWS SSO (Single Sign-On)
  - MFA (Multi-Factor Authentication) with long-term credentials
  - Direct credential usage
- **Smart Fallback Mechanism**: Falls back to simpler authentication methods when possible
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
- **aws-mfa** (optional): Required only if using MFA authentication with long-term credentials

### Installing aws-mfa (Optional)

If you need MFA support:

```bash
pip install aws-mfa
```

## Usage

```bash
awslogin <profile_name>
```

For example:

```bash
awslogin mycompany-dev
```

## Authentication Flow

The tool follows this authentication flow:

1. **Check if profile exists** in AWS config
2. **Determine authentication type**:
   - If profile has SSO configured: Use SSO authentication
   - If not SSO: Try direct authentication first
   - If direct authentication fails: Try MFA if a long-term profile exists

## Configuration

This tool works with your existing AWS CLI configuration files. No additional configuration is required.

### AWS Configuration

Your AWS configuration should be properly set up in the standard AWS CLI config files:

- `~/.aws/config`
- `~/.aws/credentials`

### Profile Types

The tool supports three types of AWS profiles:

#### 1. SSO Profiles

Example configuration in `~/.aws/config`:

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

## Examples

### Example 1: SSO Authentication

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

### Example 2: MFA Authentication

```bash
$ awslogin production
🔑 Attempting direct authentication for profile: production
🔐 Authenticating with AWS MFA for profile: production
Enter MFA code: 123456
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

## Best Practices

### Security Best Practices

1. **Use SSO when possible**: AWS SSO is more secure than long-term access keys
2. **Enable MFA for all IAM users**: Always use MFA with long-term credentials
3. **Rotate credentials regularly**: Change your long-term access keys periodically
4. **Use least privilege**: Ensure your roles have only the permissions they need

### Usage Best Practices

1. **Name profiles consistently**: Use a consistent naming scheme for profiles
2. **Structure profiles by environment**: For example, `company-dev`, `company-prod`
3. **Set default regions**: Configure a default region for each profile
4. **Set default output format**: Configure a default output format (json, text, table)

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
❌ Failed to authenticate with MFA using aws-mfa for profile: example-profile
```

**Solution**:
1. Verify `aws-mfa` is installed correctly
2. Ensure your long-term profile exists and has correct credentials
3. Verify your MFA device ARN is correctly configured

#### Direct authentication fails

```
❌ Failed to authenticate using profile: example-profile
```

**Solution**:
1. Verify your credentials in the AWS credentials file
2. Check if your credentials have expired
3. Verify IAM permissions for the user

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

