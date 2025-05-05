#!/usr/bin/env bash

# AWS Profile Authentication Script
# Provides intelligent authentication for AWS profiles
# Supports: SSO, MFA, and direct authentication

if [ -z "$1" ]; then
    echo "ℹ️  Usage: awslogin <profile_name>"
    echo "Example: awslogin metalab"
    exit 1
fi

profile="$1"

# Store profiles list first to avoid broken pipe
all_profiles=$(aws configure list-profiles)

# Check if profile exists
if ! echo "$all_profiles" | grep -q "^${profile}$"; then
    echo "❌ Profile $profile not found"
    exit 1
fi

# Check if it's an SSO profile
sso_start_url=$(aws configure get sso_start_url --profile "$profile" 2>/dev/null)
if [ -n "$sso_start_url" ]; then
    echo "🔐 Authenticating with AWS SSO for profile: $profile"
    if aws sso login --profile "$profile"; then
        if aws sts get-caller-identity --profile "$profile" &> /dev/null; then
            echo "✅ Successfully authenticated with AWS SSO for profile: $profile"
            aws sts get-caller-identity --profile "$profile"
            exit 0
        else
            echo "⚠️  Authentication succeeded but credentials validation failed"
            exit 1
        fi
    else
        echo "❌ Failed to authenticate with AWS SSO for profile: $profile"
        exit 1
    fi
else
    # Try direct authentication first
    echo "🔑 Attempting direct authentication for profile: $profile"
    if aws sts get-caller-identity --profile "$profile" &> /dev/null; then
        echo "✅ Successfully authenticated using profile: $profile"
        aws sts get-caller-identity --profile "$profile"
        exit 0
    fi
    
    # If direct authentication failed, check for long-term profile
    long_term_profile="${profile}-long-term"
    if echo "$all_profiles" | grep -q "^${long_term_profile}$"; then
        mfa_serial=$(aws configure get aws_mfa_device --profile "$long_term_profile" 2>/dev/null)
        if [ -z "$mfa_serial" ]; then
            mfa_serial=$(aws configure get mfa_serial --profile "$long_term_profile" 2>/dev/null)
        fi

        if [ -n "$mfa_serial" ]; then
            echo "🔐 Attempting MFA authentication for profile: $profile"
            if aws-mfa --duration 28800 --profile "$profile"; then
                if aws sts get-caller-identity --profile "$profile" &> /dev/null; then
                    echo "✅ Successfully authenticated with MFA for profile: $profile"
                    aws sts get-caller-identity --profile "$profile"
                    exit 0
                fi
            fi
            echo "⚠️  MFA authentication failed"
        else
            echo "⚠️  Long-term profile exists but no MFA device configured"
        fi
    else
        echo "❌ Direct authentication failed and no long-term profile found"
    fi
    
    echo "❌ Failed to authenticate using profile: $profile"
    exit 1
fi

