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
            # Prompt for MFA token
            echo -n "Enter MFA token: "
            read -r token_code

            # Get temporary credentials using the long-term profile
            creds_json=$(aws sts get-session-token \
                --profile "$long_term_profile" \
                --serial-number "$mfa_serial" \
                --token-code "$token_code" \
                --duration-seconds 28800 \
                --output json 2>/dev/null)

            if [ $? -eq 0 ]; then
                # Extract credentials from JSON response
                access_key=$(echo "$creds_json" | grep -o '"AccessKeyId": "[^"]*' | cut -d'"' -f4)
                secret_key=$(echo "$creds_json" | grep -o '"SecretAccessKey": "[^"]*' | cut -d'"' -f4)
                session_token=$(echo "$creds_json" | grep -o '"SessionToken": "[^"]*' | cut -d'"' -f4)

                # Store temporary credentials in the profile
                aws configure set aws_access_key_id "$access_key" --profile "$profile"
                aws configure set aws_secret_access_key "$secret_key" --profile "$profile"
                aws configure set aws_session_token "$session_token" --profile "$profile"

                # Verify the credentials work
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

