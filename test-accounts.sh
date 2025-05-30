#!/bin/bash

# Get list of active accounts in organization
echo "🔍 Retrieving active accounts from organization..."
ACCOUNTS=$(aws organizations list-accounts --profile dcycle --query "Accounts[?Status=='ACTIVE'].{Id:Id,Name:Name}" --output json)

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
  aws configure set sso_session dcycle --profile $TEMP_PROFILE_NAME
  aws configure set sso_account_id $ACCOUNT_ID --profile $TEMP_PROFILE_NAME
  aws configure set sso_role_name AdministratorAccess --profile $TEMP_PROFILE_NAME
  aws configure set region us-east-1 --profile $TEMP_PROFILE_NAME
  
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
  aws configure unset sso_session --profile $TEMP_PROFILE_NAME
  aws configure unset sso_account_id --profile $TEMP_PROFILE_NAME
  aws configure unset sso_role_name --profile $TEMP_PROFILE_NAME
  aws configure unset region --profile $TEMP_PROFILE_NAME
  
  echo
done

echo "✅ Account access test completed"