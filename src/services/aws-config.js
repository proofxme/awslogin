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

async function getProfileConfig(profile) {
  const keys = [
    'aws_access_key_id',
    'aws_secret_access_key',
    'aws_session_token',
    'aws_session_expiration',
    'region',
    'output',
    'mfa_serial',
    'role_arn',
    'source_profile',
    'external_id',
    'duration_seconds',
    'sso_start_url',
    'sso_region',
    'sso_account_id',
    'sso_role_name',
    'sso_session',
    'op_item',
    'aws_expiration'
  ];

  return getProfileMetadata(profile, keys);
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
  getProfileConfig
};
