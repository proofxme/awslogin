'use strict';

const readline = require('readline');
const { spawnSync } = require('child_process');
const { commandExists, execAwsCommand } = require('../core/aws');

function exec1PasswordCommand(args, options = {}) {
  const result = spawnSync('op', args, {
    stdio: options.stdio || 'pipe',
    encoding: 'utf8',
    env: { ...process.env },
    ...options
  });

  return {
    stdout: result.stdout ? result.stdout.trim() : '',
    stderr: result.stderr ? result.stderr.trim() : '',
    status: result.status,
    success: result.status === 0
  };
}

async function getMfaTokenFrom1Password(profileName) {
  try {
    if (!commandExists('op')) {
      console.log('⚠️  1Password CLI not found, falling back to manual MFA entry');
      return null;
    }

    const baseProfileName = profileName.endsWith('-long-term')
      ? profileName.replace('-long-term', '')
      : profileName;

    console.log(`🔍 Searching for MFA token in 1Password for profile: ${baseProfileName}`);

    const savedItemIdResult = execAwsCommand(['configure', 'get', 'aws_1password_item_id', '--profile', baseProfileName]);
    const savedItemId = savedItemIdResult.success ? savedItemIdResult.stdout : '';

    let item = null;

    if (savedItemId) {
      console.log(`🔍 Found saved 1Password item ID: ${savedItemId}`);

      const itemInfoResult = exec1PasswordCommand(['item', 'get', savedItemId, '--format', 'json']);

      if (itemInfoResult.success) {
        try {
          item = JSON.parse(itemInfoResult.stdout);
          console.log(`🔐 Using previously selected item: ${item.title}`);
        } catch (error) {
          console.log(`⚠️  Failed to parse saved 1Password item: ${error.message}`);
          item = null;
        }
      } else {
        console.log(`⚠️  Saved 1Password item no longer exists, will search for alternatives`);
      }
    }

    if (!item) {
      let searchTerm = profileName;
      if (searchTerm.endsWith('-long-term')) {
        searchTerm = searchTerm.replace('-long-term', '');
      }

      console.log(`🔍 Using search term: ${searchTerm}`);

      const searchResult = exec1PasswordCommand(['item', 'list', '--format', 'json']);

      if (!searchResult.success) {
        console.log('⚠️  Failed to search 1Password for AWS credentials');
        return null;
      }

      let items = [];
      try {
        items = JSON.parse(searchResult.stdout);
      } catch (error) {
        console.log('⚠️  Failed to parse 1Password search results');
        return null;
      }

      const awsItems = items.filter((candidate) => {
        const lowerTitle = candidate.title.toLowerCase();
        const lowerSearchTerm = searchTerm.toLowerCase();
        return (
          (lowerTitle.includes('aws') || lowerTitle.includes('amazon')) &&
          (lowerTitle.includes(lowerSearchTerm) || lowerSearchTerm.includes(lowerTitle.replace(/aws|amazon|-/gi, '').trim()))
        );
      });

      console.log(`🔍 Found ${awsItems.length} potential matching items in 1Password`);
      if (awsItems.length > 0) {
        awsItems.forEach((candidate) => console.log(`   - ${candidate.title} (${candidate.id})`));
      }

      if (awsItems.length === 0) {
        console.log(`⚠️  No matching AWS items found in 1Password for profile: ${profileName}`);
        return null;
      }

      if (awsItems.length > 1) {
        console.log('⚠️  Multiple 1Password entries found. Please select which to use:');
        awsItems.forEach((candidate, index) => {
          console.log(`   ${index + 1}. ${candidate.title} (${candidate.id})`);
        });

        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        try {
          let validSelection = false;
          let index = -1;

          while (!validSelection) {
            const selection = await new Promise((resolve) => {
              tempRl.question('Enter number of entry to use: ', (answer) => resolve(answer));
            });

            index = parseInt(selection, 10) - 1;

            if (!Number.isNaN(index) && index >= 0 && index < awsItems.length) {
              validSelection = true;
              tempRl.close();
            } else {
              console.log(`⚠️  Invalid selection, please enter a number between 1 and ${awsItems.length}`);

              if (tempRl.closed) {
                throw new Error('Selection process was interrupted');
              }
            }
          }

          item = awsItems[index];
          console.log(`🔐 Using selected item: ${item.title}`);

          console.log(`🔄 Storing selected 1Password item in AWS config for future use`);
          execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
        } catch (error) {
          console.log(`⚠️  Error selecting 1Password entry: ${error.message}`);
          console.log('⚠️  Please try again with a valid selection');
          tempRl.close();
          return null;
        }
      } else {
        item = awsItems[0];
        console.log(`🔐 Using selected item: ${item.title}`);
        execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
      }
    }

    let itemData = item;

    if (!itemData.fields) {
      console.log(`🔍 Getting details for 1Password item: ${item.title} (${item.id})`);
      const itemDetail = exec1PasswordCommand(['item', 'get', item.id, '--format', 'json']);

      if (!itemDetail.success) {
        console.log('⚠️  Failed to get item details from 1Password');
        return null;
      }

      try {
        itemData = JSON.parse(itemDetail.stdout);
      } catch (error) {
        console.log(`⚠️  Failed to parse 1Password item details: ${error.message}`);
        return null;
      }
    }

    console.log(`🔍 Found the following field types:`);
    if (itemData.fields) {
      const fieldTypes = itemData.fields.map((field) => field.type).filter((value, index, array) => array.indexOf(value) === index);
      console.log(`   - Fields: ${fieldTypes.join(', ')}`);
    }
    if (itemData.sections) {
      console.log(`   - Has ${itemData.sections.length} sections`);
    }

    let totpField = null;

    if (itemData.fields) {
      totpField = itemData.fields.find((field) => field.type === 'OTP');
      if (!totpField) {
        totpField = itemData.fields.find((field) => field.totp);
      }
    }

    if (!totpField && itemData.sections) {
      for (const section of itemData.sections) {
        if (section.fields) {
          const sectionTotpField = section.fields.find((field) => field.type === 'OTP' || field.totp);
          if (sectionTotpField) {
            totpField = sectionTotpField;
            break;
          }
        }
      }
    }

    if (!totpField) {
      console.log(`⚠️  No TOTP field found in 1Password for item: ${itemData.title}`);
      console.log(`🔧 Try: op item get "${itemData.title}" --otp`);
      return null;
    }

    console.log(`🔐 Getting current OTP from 1Password for item: ${itemData.title}`);
    const otpResult = exec1PasswordCommand(['item', 'get', item.id, '--otp']);

    if (!otpResult.success) {
      console.log(`⚠️  Failed to get OTP from 1Password for item: ${itemData.title}`);
      console.log(`⚠️  Error: ${otpResult.stderr}`);
      return null;
    }

    const token = otpResult.stdout.trim();
    console.log(`🔐 Retrieved MFA token from 1Password for item: ${itemData.title}`);
    console.log(`🔍 DEBUG: Token length: ${token.length}, Token: ${token.substring(0, 3)}...`);
    return token;
  } catch (error) {
    console.log(`⚠️  Error getting MFA token from 1Password: ${error.message}`);
    return null;
  }
}

module.exports = {
  exec1PasswordCommand,
  getMfaTokenFrom1Password
};
