// 1Password Integration Module
// Handles MFA token retrieval from 1Password

const readline = require('readline');
const { spawnSync } = require('child_process');
const { commandExists } = require('./utils');
const { execAwsCommand } = require('./awsCommand');

// Function to execute 1Password CLI commands
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

// Function to get MFA token from 1Password
async function getMfaTokenFrom1Password(profileName) {
  try {
    // Check if 1Password CLI is installed
    if (!commandExists('op')) {
      console.log('⚠️  1Password CLI not found, falling back to manual MFA entry');
      return null;
    }

    // Strip the -long-term suffix if present for consistent 1Password searching
    const baseProfileName = profileName.endsWith('-long-term') 
      ? profileName.replace('-long-term', '') 
      : profileName;
    
    console.log(`🔍 Searching for MFA token in 1Password for profile: ${baseProfileName}`);
    
    // First, check if we have a saved item ID for this profile
    // Use the base profile name for consistent storage/retrieval
    const savedItemIdResult = execAwsCommand(['configure', 'get', 'aws_1password_item_id', '--profile', baseProfileName]);
    const savedItemId = savedItemIdResult.success ? savedItemIdResult.stdout : '';
    
    let item = null;
    
    // If we have a saved item ID, try to use it directly
    if (savedItemId) {
      console.log(`🔍 Found saved 1Password item ID: ${savedItemId}`);
      
      // Get item info to verify it still exists
      const itemInfoResult = exec1PasswordCommand(['item', 'get', savedItemId, '--format', 'json']);
      
      if (itemInfoResult.success) {
        try {
          item = JSON.parse(itemInfoResult.stdout);
          console.log(`🔐 Using previously selected item: ${item.title}`);
        } catch (e) {
          console.log(`⚠️  Failed to parse saved 1Password item: ${e.message}`);
          item = null;
        }
      } else {
        console.log(`⚠️  Saved 1Password item no longer exists, will search for alternatives`);
      }
    }
    
    // If we don't have a saved item or it's no longer valid, search for items
    if (!item) {
      // Try to find an account name based on the profile name
      let searchTerm = profileName;
      
      // If it's a long-term profile, remove the -long-term suffix
      if (searchTerm.endsWith('-long-term')) {
        searchTerm = searchTerm.replace('-long-term', '');
      }
      
      console.log(`🔍 Using search term: ${searchTerm}`)
      
      // Search for AWS items in 1Password that match the profile name
      const searchResult = exec1PasswordCommand(['item', 'list', '--format', 'json']);
      
      if (!searchResult.success) {
        console.log('⚠️  Failed to search 1Password for AWS credentials');
        return null;
      }
      
      let items = [];
      try {
        items = JSON.parse(searchResult.stdout);
      } catch (e) {
        console.log('⚠️  Failed to parse 1Password search results');
        return null;
      }
      
      // Filter items that might match our AWS profile
      const awsItems = items.filter(item => {
        const lowerTitle = item.title.toLowerCase();
        const lowerSearchTerm = searchTerm.toLowerCase();
        return (
          (lowerTitle.includes('aws') || lowerTitle.includes('amazon')) && 
          (lowerTitle.includes(lowerSearchTerm) || lowerSearchTerm.includes(lowerTitle.replace(/aws|amazon|-/gi, '').trim()))
        );
      });
      
      console.log(`🔍 Found ${awsItems.length} potential matching items in 1Password`);
      if (awsItems.length > 0) {
        awsItems.forEach(item => console.log(`   - ${item.title} (${item.id})`));
      }
      
      if (awsItems.length === 0) {
        console.log(`⚠️  No matching AWS items found in 1Password for profile: ${profileName}`);
        return null;
      }
      
      // If multiple matches found, prompt the user to select one
      if (awsItems.length > 1) {
        console.log('⚠️  Multiple 1Password entries found. Please select which to use:');
        for (let i = 0; i < awsItems.length; i++) {
          console.log(`   ${i+1}. ${awsItems[i].title} (${awsItems[i].id})`);
        }
        
        // Create a temporary readline interface for this prompt
        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        try {
          // Use a do-while loop to repeatedly prompt until a valid selection is made
          let validSelection = false;
          let index = -1;
          
          while (!validSelection) {
            const selection = await new Promise(resolve => {
              tempRl.question('Enter number of entry to use: ', answer => {
                resolve(answer);
              });
            });
            
            index = parseInt(selection) - 1;
            
            if (!isNaN(index) && index >= 0 && index < awsItems.length) {
              validSelection = true;
              tempRl.close();
            } else {
              console.log('⚠️  Invalid selection, please enter a number between 1 and ' + awsItems.length);
              
              // If the RL was closed unexpectedly (e.g. by terminal closing or Ctrl+C)
              if (tempRl.closed) {
                throw new Error('Selection process was interrupted');
              }
            }
          }
          
          item = awsItems[index];
          console.log(`🔐 Using selected item: ${item.title}`);
          
          // Store the selected 1Password item ID in the AWS config
          console.log(`🔄 Storing selected 1Password item in AWS config for future use`);
          execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
        } catch (error) {
          console.log(`⚠️  Error selecting 1Password entry: ${error.message}`);
          console.log('⚠️  Please try again with a valid selection');
          tempRl.close(); // Ensure the readline interface is closed
          return null;
        }
      } else {
        // Use the only matching item
        item = awsItems[0];
        
        // Store the selected 1Password item ID in the AWS config
        console.log(`🔄 Storing selected 1Password item in AWS config for future use`);
        execAwsCommand(['configure', 'set', 'aws_1password_item_id', item.id, '--profile', baseProfileName]);
      }
    }
    // Get the item details to find the TOTP field if we haven't already
    let itemData = item;
    
    // If the item was loaded in a simplified format, we need to get full details
    if (!item.fields) {
      console.log(`🔍 Getting details for 1Password item: ${item.title} (${item.id})`);
      const itemDetail = exec1PasswordCommand(['item', 'get', item.id, '--format', 'json']);
      
      if (!itemDetail.success) {
        console.log('⚠️  Failed to get item details from 1Password');
        return null;
      }
      
      try {
        itemData = JSON.parse(itemDetail.stdout);
      } catch (e) {
        console.log(`⚠️  Failed to parse 1Password item details: ${e.message}`);
        return null;
      }
    }
    
    // Debug field types
    console.log(`🔍 Found the following field types:`);
    if (itemData.fields) {
      const fieldTypes = itemData.fields.map(f => f.type).filter((v, i, a) => a.indexOf(v) === i);
      console.log(`   - Fields: ${fieldTypes.join(', ')}`);
    }
    if (itemData.sections) {
      console.log(`   - Has ${itemData.sections.length} sections`);
    }
    
    // Find the TOTP field - in different versions of 1Password, the TOTP field might have different properties
    let totpField = null;
    
    // First check standard OTP type
    if (itemData.fields) {
      totpField = itemData.fields.find(field => field.type === 'OTP');
      
      // If not found, look for field with TOTP property
      if (!totpField) {
        totpField = itemData.fields.find(field => field.totp);
      }
    }
    
    // If not found, look for sections that might contain OTP fields
    if (!totpField && itemData.sections) {
      for (const section of itemData.sections) {
        if (section.fields) {
          const sectionTotpField = section.fields.find(field => field.type === 'OTP' || field.totp);
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
    
    // Now get the actual OTP code using 1Password CLI
    console.log(`🔐 Getting current OTP from 1Password for item: ${itemData.title}`);
    const otpResult = exec1PasswordCommand(['item', 'get', item.id, '--otp']);
    
    if (!otpResult.success) {
      console.log(`⚠️  Failed to get OTP from 1Password for item: ${itemData.title}`);
      console.log(`⚠️  Error: ${otpResult.stderr}`);
      return null;
    }
    
    // Return the current OTP value
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