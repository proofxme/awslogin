'use strict';

const { execAwsCommand } = require('../core/aws');

function listProfiles() {
  const result = execAwsCommand(['configure', 'list-profiles']);
  if (!result.success || !result.stdout) {
    return [];
  }
  return result.stdout.split('\n').filter(Boolean);
}

function profileExists(profile, cache) {
  const profiles = Array.isArray(cache) ? cache : listProfiles();
  return profiles.includes(profile);
}

function getProfileValue(profile, key) {
  const result = execAwsCommand(['configure', 'get', key, '--profile', profile]);
  return result.success && result.stdout ? result.stdout : null;
}

function setProfileValue(profile, key, value) {
  const result = execAwsCommand(['configure', 'set', key, value, '--profile', profile]);
  return result.success;
}

function unsetProfileKey(profile, key) {
  const result = execAwsCommand(['configure', 'unset', key, '--profile', profile]);
  return result.success;
}

function setProfileValues(profile, entries) {
  return entries.every(({ key, value }) => setProfileValue(profile, key, value));
}

function clearProfileKeys(profile, keys) {
  return keys.every((key) => {
    const existingValue = getProfileValue(profile, key);
    return existingValue ? unsetProfileKey(profile, key) : true;
  });
}

function getProfileMetadata(profile, keys) {
  return keys.reduce((acc, key) => {
    const value = getProfileValue(profile, key);
    if (value) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function setTemporaryCredentials(profile, credentials) {
  const entries = [
    { key: 'aws_access_key_id', value: credentials.accessKeyId },
    { key: 'aws_secret_access_key', value: credentials.secretAccessKey },
    { key: 'aws_session_token', value: credentials.sessionToken }
  ];

  if (credentials.expiration) {
    entries.push({ key: 'aws_session_expiration', value: new Date(credentials.expiration).toISOString() });
  }

  return setProfileValues(profile, entries);
}

function getRegion(profile) {
  return getProfileValue(profile, 'region');
}

function setRegion(profile, region) {
  if (!region) {
    return unsetProfileKey(profile, 'region');
  }
  return setProfileValue(profile, 'region', region);
}

// Cache for profile configs to avoid repeated AWS CLI calls
let profileConfigCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // Cache for 5 seconds

async function getProfileConfig(profile) {
  // Use cached version if available and fresh
  if (profileConfigCache && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return profileConfigCache[profile] || {};
  }

  // If cache is stale or missing, refresh it synchronously
  refreshProfileCache();

  // Return the cached version after refresh
  return profileConfigCache[profile] || {};
}

// Fast batch reading of all profile configs
function refreshProfileCache() {
  try {
    const { execSync } = require('child_process');

    // Read both config and credentials files directly
    const configFile = execSync('cat ~/.aws/config 2>/dev/null', { encoding: 'utf8' });
    const credFile = execSync('cat ~/.aws/credentials 2>/dev/null', { encoding: 'utf8' });

    const cache = {};

    // Parse config file
    let currentProfile = null;
    for (const line of configFile.split('\n')) {
      const profileMatch = line.match(/^\[(?:profile\s+)?(.+)\]$/);
      if (profileMatch) {
        currentProfile = profileMatch[1];
        if (!cache[currentProfile]) cache[currentProfile] = {};
      } else if (currentProfile && line.includes('=')) {
        const [key, value] = line.split('=').map(s => s.trim());
        if (key && value) {
          cache[currentProfile][key.replace(/-/g, '_')] = value;
        }
      }
    }

    // Parse credentials file
    currentProfile = null;
    for (const line of credFile.split('\n')) {
      const profileMatch = line.match(/^\[(.+)\]$/);
      if (profileMatch) {
        currentProfile = profileMatch[1];
        if (!cache[currentProfile]) cache[currentProfile] = {};
      } else if (currentProfile && line.includes('=')) {
        const [key, value] = line.split('=').map(s => s.trim());
        if (key && value) {
          cache[currentProfile][key.replace(/-/g, '_')] = value;
        }
      }
    }

    profileConfigCache = cache;
    cacheTimestamp = Date.now();
  } catch (error) {
    // Fallback to empty cache on error
    profileConfigCache = {};
    cacheTimestamp = Date.now();
  }
}

function setProfileConfig(profile, key, value) {
  return setProfileValue(profile, key, value);
}

module.exports = {
  listProfiles,
  profileExists,
  getProfileValue,
  setProfileValue,
  unsetProfileKey,
  setProfileValues,
  clearProfileKeys,
  getProfileMetadata,
  setTemporaryCredentials,
  getRegion,
  setRegion,
  getProfileConfig,
  setProfileConfig
};
