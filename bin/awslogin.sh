#!/usr/bin/env bash

# AWS Profile Authentication Script
# Provides intelligent authentication for AWS profiles
# Supports: SSO, MFA, and direct authentication with 1Password integration

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

# Check if it's an SSO profile (either direct sso_start_url or sso_session)
sso_start_url=$(aws configure get sso_start_url --profile "$profile" 2>/dev/null)
sso_session=$(aws configure get sso_session --profile "$profile" 2>/dev/null)

if [ -n "$sso_start_url" ] || [ -n "$sso_session" ]; then
    echo "🔐 Authenticating with AWS SSO for profile: $profile"
    
    # For browser-based SSO with sso_session
    if [ -n "$sso_session" ]; then
        echo "🌐 Using browser-based SSO authentication with session: $sso_session"
    fi
    
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
        # Check for token expiration by examining the expiration timestamp for session-based credentials
        expiration_time=$(aws configure get aws_session_expiration --profile "$profile" 2>/dev/null)
        
        # If we have an expiration time, check if it's still valid
        if [ -n "$expiration_time" ]; then
            # Cross-platform date handling for macOS and Linux
            # Detect OS type
            os_type=$(uname)
            
            # Handle ISO8601 format (2023-04-25T12:34:56Z)
            if [[ "$os_type" == "Darwin" ]]; then
                # macOS date command
                expiration_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$expiration_time" "+%s" 2>/dev/null)
                if [ $? -ne 0 ]; then
                    # Try alternate format if first one failed
                    expiration_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$expiration_time" "+%s" 2>/dev/null)
                fi
            else
                # Linux date command
                expiration_epoch=$(date -d "$expiration_time" "+%s" 2>/dev/null)
            fi
            
            # Get current time plus 15 minutes (900 seconds) to give a buffer
            current_epoch=$(date "+%s")
            buffer_time=$((current_epoch + 900))
            
            if [ -n "$expiration_epoch" ] && [ "$expiration_epoch" -gt "$buffer_time" ]; then
                # Format the expiration time for display
                if [[ "$os_type" == "Darwin" ]]; then
                    # macOS
                    readable_expiry=$(date -j -f "%s" "$expiration_epoch" "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
                else
                    # Linux
                    readable_expiry=$(date -d "@$expiration_epoch" "+%Y-%m-%d %H:%M:%S" 2>/dev/null)
                fi
                echo "✅ Successfully authenticated using profile: $profile (valid until $readable_expiry)"
                aws sts get-caller-identity --profile "$profile"
                exit 0
            else
                echo "⚠️ Credentials for profile $profile have expired or will expire soon. Refreshing..."
                # Continue to authentication flow
            fi
        else
            # No expiration time found but authentication succeeded, probably using long-term credentials
            echo "✅ Successfully authenticated using profile: $profile"
            aws sts get-caller-identity --profile "$profile"
            exit 0
        fi
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
            
            # Function to process MFA token and get session
            process_mfa_token() {
                local token_code=$1
                local use_1password=$2
                
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
                    expiration=$(echo "$creds_json" | grep -o '"Expiration": "[^"]*' | cut -d'"' -f4)

                    # Store temporary credentials in the profile
                    aws configure set aws_access_key_id "$access_key" --profile "$profile"
                    aws configure set aws_secret_access_key "$secret_key" --profile "$profile"
                    aws configure set aws_session_token "$session_token" --profile "$profile"
                    aws configure set aws_session_expiration "$expiration" --profile "$profile"
                    
                    # Mark profile as using 1Password if applicable
                    if [ "$use_1password" = "true" ]; then
                        aws configure set aws_1password_mfa "true" --profile "$profile"
                    fi

                    # Verify the credentials work
                    if aws sts get-caller-identity --profile "$profile" &> /dev/null; then
                        echo "✅ Successfully authenticated with MFA for profile: $profile"
                        aws sts get-caller-identity --profile "$profile"
                        return 0
                    fi
                fi
                return 1
            }
            
            # Check if we have op (1Password CLI) installed
            if command -v op >/dev/null 2>&1; then
                # Try to find a matching AWS item in 1Password
                search_term="${long_term_profile%-long-term}"
                
                echo "🔍 Searching for MFA token in 1Password for profile: $long_term_profile"
                echo "🔍 Using search term: $search_term"
                echo "🔍 MFA serial being used: $mfa_serial"
                
                # Get region for long-term profile, crucial for MFA authentication to work
                region=$(aws configure get region --profile "$long_term_profile" 2>/dev/null)
                if [ -z "$region" ]; then
                    # Try to get region from standard profile
                    region=$(aws configure get region --profile "$profile" 2>/dev/null)
                    if [ -n "$region" ]; then
                        echo "🔍 No region found in long-term profile, using region from standard profile: $region"
                        # Ensure long-term profile has the region set
                        aws configure set region "$region" --profile "$long_term_profile"
                    else
                        echo "⚠️ No region configured for profile: $long_term_profile (required for MFA)"
                        echo "🔍 Setting default region to us-east-1"
                        # Set a default region as fallback
                        aws configure set region "us-east-1" --profile "$long_term_profile"
                        region="us-east-1"
                    fi
                else
                    echo "🔍 Using region from long-term profile: $region"
                fi
                
                # Get all items and look for AWS/Amazon items matching our profile
                op_items=$(op item list --format json 2>/dev/null)
                
                if [ $? -eq 0 ]; then
                    # Search for AWS items with matching profile name
                    # Use jq if available for better parsing, otherwise use grep
                    if command -v jq >/dev/null 2>&1; then
                        matching_items=$(echo "$op_items" | jq -r ".[] | select(.title | test(\"(?i)aws|amazon\") and test(\"(?i)${search_term}\")) | .id")
                    else
                        matching_items=$(echo "$op_items" | grep -i "aws\|amazon" | grep -i "$search_term" | grep -o "\"id\":\"[^\"]*\"" | cut -d'\"' -f4)
                    fi
                    
                    # If we found matching items, try to get the TOTP code
                    if [ -n "$matching_items" ]; then
                        # Count how many items we have
                        match_count=$(echo "$matching_items" | wc -l)
                        
                        # If multiple matches, prompt user to select one
                        if [ "$match_count" -gt 1 ]; then
                            echo "\u26a0\ufe0f  Multiple 1Password entries found. Please select which to use:"
                            item_number=1
                            
                            # Use a temp file to store the mapping of number -> item_id
                            temp_map_file=$(mktemp)
                            
                            # Display options and build mapping
                            for m_item in $matching_items; do
                                # Get item title for better display
                                title=$(op item get "$m_item" --format json 2>/dev/null | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
                                echo "   $item_number. $title ($m_item)"
                                echo "$item_number:$m_item" >> "$temp_map_file"
                                item_number=$((item_number + 1))
                            done
                            
                            # Ask user for selection
                            echo -n "Enter number of entry to use: "
                            read -r selection
                            
                            # Validate and get the selected item_id
                            if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "$match_count" ]; then
                                item_id=$(grep "^$selection:" "$temp_map_file" | cut -d':' -f2)
                                title=$(op item get "$item_id" --format json 2>/dev/null | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
                                echo "\ud83d\udd10 Using selected item: $title"
                            else
                                echo "\u26a0\ufe0f  Invalid selection, falling back to manual MFA entry"
                                rm -f "$temp_map_file"
                                continue
                            fi
                            
                            # Clean up temp file
                            rm -f "$temp_map_file"
                        else
                            # Use the only matching item
                            item_id=$(echo "$matching_items" | head -1)
                        fi
                        
                        # Get the item details
                        item_details=$(op item get "$item_id" --format json 2>/dev/null)
                        
                        if [ $? -eq 0 ]; then
                            # Try to extract the TOTP code - checking multiple possible locations
                            # Use jq if available for better JSON parsing
                            if command -v jq >/dev/null 2>&1; then
                                # Try various paths where TOTP might be stored in 1Password
                                totp=$(echo "$item_details" | jq -r '.fields[] | select(.type=="OTP") | .totp // .value.totp // .value // empty' 2>/dev/null)
                                
                                # If not found in main fields, try sections
                                if [ -z "$totp" ]; then
                                    totp=$(echo "$item_details" | jq -r '.sections[] | select(.fields) | .fields[] | select(.type=="OTP") | .totp // .value.totp // .value // empty' 2>/dev/null)
                                fi
                            else
                                # Less precise grep-based extraction if jq is not available
                                totp=$(echo "$item_details" | grep -o "\"totp\":\"[0-9]*\"" | head -1 | cut -d'\"' -f4)
                                
                                # If not found, try alternate location
                                if [ -z "$totp" ]; then
                                    totp=$(echo "$item_details" | grep -o "\"otp\":\[[0-9,]*\]" | grep -o "[0-9]*" | head -1)
                                fi
                            fi
                            
                            if [ -n "$totp" ]; then
                                echo "🔐 Retrieved MFA token from 1Password"
                                
                                # Process the token
                                if process_mfa_token "$totp" "true"; then
                                    exit 0
                                else
                                    echo "⚠️  1Password MFA token failed, falling back to manual entry"
                                fi
                            fi
                        fi
                    fi
                fi
            fi
            
            # Fallback to manual token entry
            echo -n "Enter MFA token: "
            read -r token_code
            
            if process_mfa_token "$token_code" "false"; then
                exit 0
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

