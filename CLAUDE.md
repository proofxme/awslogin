# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands
- Install dependencies: `npm install`
- Install globally: `npm install -g .`
- Run the CLI: `awslogin <profile_name>`
- Test all organization accounts: `./test-accounts.sh`

## High-Level Architecture

### Overview
AWS Profile Auth CLI is a zero-dependency Node.js tool that provides intelligent AWS authentication across SSO, MFA, and direct credential methods. It acts as a wrapper around AWS CLI v2, adding session validation, credential caching, and enhanced user experience.

### Core Modules (`lib/modules/`)
- **authManager.js**: Central orchestrator for all authentication flows. Routes to appropriate auth methods and manages sub-profile creation for multi-account access
- **sso.js**: Handles SSO-specific operations including account listing, role selection, and credential retrieval with fallback mechanisms
- **mfa.js**: Manages MFA authentication flows and device configuration
- **onePassword.js**: Integrates with 1Password CLI for automatic MFA token retrieval
- **identityCenter.js**: Guides IAM Identity Center setup for cross-account access
- **profileConfig.js**: Interactive configuration wizard for profile setup and organization-wide profile creation
- **awsCommand.js**: Unified wrapper for AWS CLI command execution
- **utils.js**: Session validation, credential expiration checking, and profile utilities

### Authentication Flow
1. Profile validation and type detection (SSO/MFA/Direct)
2. Session validation via lightweight S3 API calls
3. Credential expiration checking with human-readable time display
4. Automatic re-authentication when needed
5. Sub-profile creation for SSO accounts (format: `profile-account-name`)

### Key Implementation Details
- Entry point: `bin/awslogin.js` (not a shell script)
- Uses AWS CLI's native config files (`~/.aws/config`, `~/.aws/credentials`)
- Stores metadata in profile config (parent_profile, account_id, role_name, aws_1password_item_id)
- Implements intelligent fallback for SSO authentication failures
- Validates sessions before re-authenticating to minimize login prompts

## Code Style Guidelines

### JavaScript
- CommonJS modules (`require()`/`module.exports`)
- Node.js 14.0.0+ (uses async/await extensively)
- Descriptive variable names in camelCase
- Error handling with try/catch blocks
- Console output with emoji indicators for status

### Error Handling
- Exit with appropriate codes (0 for success, non-zero for failures)
- Descriptive error messages that guide users to solutions
- Graceful fallbacks for authentication failures