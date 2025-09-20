#!/bin/bash

# Base profile used for the checks. Override by exporting BASE_PROFILE=your-sso-profile
BASE_PROFILE=${BASE_PROFILE:-my-sso-profile}

# Resolve base profile SSO configuration
SSO_SESSION=$(aws configure get sso_session --profile "$BASE_PROFILE" 2>/dev/null)
SSO_START_URL=$(aws configure get sso_start_url --profile "$BASE_PROFILE" 2>/dev/null)
SSO_REGION=$(aws configure get sso_region --profile "$BASE_PROFILE" 2>/dev/null)

# Get list of active accounts in organization
echo "🔍 Retrieving active accounts from organization using profile: $BASE_PROFILE"
ACCOUNTS=$(aws organizations list-accounts --profile "$BASE_PROFILE" --query "Accounts[?Status=='ACTIVE'].{Id:Id,Name:Name}" --output json)

if [ $? -ne 0 ]; then
  echo "❌ Failed to retrieve accounts list"
  exit 1
fi

# Count accounts
ACCOUNT_COUNT=$(echo $ACCOUNTS | jq length)
echo "✅ Found $ACCOUNT_COUNT active accounts"
echo

# Loop through accounts and test access
echo "🔐 Testing access with AdministratorAccess role to each account..."
echo

for i in $(seq 0 $(($ACCOUNT_COUNT-1))); do
  ACCOUNT_ID=$(echo $ACCOUNTS | jq -r ".[$i].Id")
  ACCOUNT_NAME=$(echo $ACCOUNTS | jq -r ".[$i].Name")
  
  echo "[$((i+1))/$ACCOUNT_COUNT] 🔍 Testing access to account: $ACCOUNT_NAME ($ACCOUNT_ID)"
  
  # Create a temporary profile name based on account name (make it safe for profile name)
  TEMP_PROFILE_NAME="temp-${ACCOUNT_NAME//[^a-zA-Z0-9-]/-}"
  
  # Configure a temporary profile for this account
  if [ -n "$SSO_SESSION" ]; then
    aws configure set sso_session "$SSO_SESSION" --profile $TEMP_PROFILE_NAME
  elif [ -n "$SSO_START_URL" ]; then
    aws configure set sso_start_url "$SSO_START_URL" --profile $TEMP_PROFILE_NAME
    if [ -n "$SSO_REGION" ]; then
      aws configure set sso_region "$SSO_REGION" --profile $TEMP_PROFILE_NAME
    fi
  fi
  aws configure set sso_account_id $ACCOUNT_ID --profile $TEMP_PROFILE_NAME
  aws configure set sso_role_name AdministratorAccess --profile $TEMP_PROFILE_NAME
  BASE_REGION=$(aws configure get region --profile "$BASE_PROFILE" 2>/dev/null)
  aws configure set region "${BASE_REGION:-us-east-1}" --profile $TEMP_PROFILE_NAME
  
  # Try to get caller identity
  echo "   🔄 Attempting to assume AdministratorAccess role..."
  RESULT=$(aws sts get-caller-identity --profile $TEMP_PROFILE_NAME 2>&1)
  
  if [ $? -eq 0 ]; then
    echo "   ✅ SUCCESS: Access verified to $ACCOUNT_NAME ($ACCOUNT_ID)"
    ARN=$(echo $RESULT | jq -r .Arn 2>/dev/null)
    if [ ! -z "$ARN" ]; then
      echo "   🔑 Identity: $ARN"
    fi
  else
    echo "   ❌ FAILED: Cannot access $ACCOUNT_NAME ($ACCOUNT_ID)"
    echo "   ℹ️  Error: $RESULT"
  fi
  
  # Clean up temporary profile
  aws configure unset sso_session --profile $TEMP_PROFILE_NAME 2>/dev/null
  aws configure unset sso_start_url --profile $TEMP_PROFILE_NAME 2>/dev/null
  aws configure unset sso_region --profile $TEMP_PROFILE_NAME 2>/dev/null
  aws configure unset sso_account_id --profile $TEMP_PROFILE_NAME
  aws configure unset sso_role_name --profile $TEMP_PROFILE_NAME
  aws configure unset region --profile $TEMP_PROFILE_NAME
  
  echo
done

echo "✅ Account access test completed"
