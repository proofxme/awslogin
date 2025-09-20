'use strict';

const { spawnSync } = require('child_process');
const { execAwsCommand } = require('./aws');

function checkCredentialsExpired(profile) {
  const credsExpireResult = execAwsCommand(['configure', 'get', 'aws_session_expiration', '--profile', profile]);

  if (credsExpireResult.success && credsExpireResult.stdout) {
    const expirationTime = new Date(credsExpireResult.stdout);
    const currentTime = new Date();
    const bufferTime = new Date(currentTime.getTime() + 15 * 60 * 1000);

    if (expirationTime <= bufferTime) {
      console.log(`⚠️ Credentials for profile ${profile} have expired or will expire soon. Refreshing...`);
      return true;
    }

    const remainingTimeMs = expirationTime - currentTime;
    const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const remainingSeconds = Math.floor((remainingTimeMs % (1000 * 60)) / 1000);

    let timeRemaining = '';
    if (remainingHours > 0) {
      timeRemaining = `${remainingHours}h ${remainingMinutes}m`;
    } else if (remainingMinutes > 0) {
      timeRemaining = `${remainingMinutes}m ${remainingSeconds}s`;
    } else {
      timeRemaining = `${remainingSeconds}s`;
    }

    console.log(`✅ Successfully authenticated using profile: ${profile} (expires in ${timeRemaining} at ${expirationTime.toLocaleString()})`);
    return false;
  }

  return false;
}

function isSessionValid(profile) {
  console.log(`🔍 Validating session for profile: ${profile}`);

  const ssoSessionResult = execAwsCommand(['configure', 'get', 'sso_session', '--profile', profile]);
  const ssoStartUrlResult = execAwsCommand(['configure', 'get', 'sso_start_url', '--profile', profile]);

  const ssoSession = ssoSessionResult.success ? ssoSessionResult.stdout : '';
  const ssoStartUrl = ssoStartUrlResult.success ? ssoStartUrlResult.stdout : '';

  if (ssoSession || ssoStartUrl) {
    if (!checkSsoTokenExpiration(profile, ssoSession)) {
      console.log('⚠️ SSO token has expired or is not found');
      return false;
    }
  }

  const result = execAwsCommand(['s3api', 'head-bucket', '--bucket', 'aws-cli', '--profile', profile]);

  if (!result.success) {
    const identityResult = execAwsCommand(['sts', 'get-caller-identity', '--profile', profile]);
    return identityResult.success;
  }

  return result.success;
}

function checkSsoTokenExpiration(profile, ssoSession) {
  console.log('🔍 Checking SSO token expiration...');

  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const awsDir = `${homeDir}/.aws`;
    const ssoDir = ssoSession ? `${awsDir}/sso/cache` : `${awsDir}/.sso/cache`;

    const checkDirResult = spawnSync('test', ['-d', ssoDir], { stdio: 'pipe' });
    if (checkDirResult.status !== 0) {
      console.log(`⚠️ SSO cache directory not found: ${ssoDir}`);
      return false;
    }

    const listFilesResult = spawnSync('ls', ['-1', ssoDir], {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    if (listFilesResult.status !== 0 || !listFilesResult.stdout) {
      console.log('⚠️ No SSO token cache files found');
      return false;
    }

    const files = listFilesResult.stdout.split('\n').filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.log('⚠️ No SSO token JSON files found in cache');
      return false;
    }

    for (const file of files) {
      const tokenPath = `${ssoDir}/${file}`;
      const readResult = spawnSync('cat', [tokenPath], {
        encoding: 'utf8',
        stdio: 'pipe'
      });

      if (readResult.status === 0 && readResult.stdout) {
        try {
          const tokenData = JSON.parse(readResult.stdout);

          if (tokenData.expiresAt) {
            const expirationTime = new Date(tokenData.expiresAt);
            const currentTime = new Date();

            if (expirationTime > currentTime) {
              console.log(`✅ Found valid SSO token (expires at ${expirationTime.toLocaleString()})`);

              const remainingTimeMs = expirationTime - currentTime;
              const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
              const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));

              if (remainingHours > 0) {
                console.log(`ℹ️  SSO token valid for ${remainingHours}h ${remainingMinutes}m`);
              } else {
                console.log(`ℹ️  SSO token valid for ${remainingMinutes}m`);
              }

              return true;
            }

            console.log(`⚠️ SSO token expired at ${expirationTime.toLocaleString()}`);
          }
        } catch (error) {
          // Ignore malformed JSON and continue.
        }
      }
    }

    return false;
  } catch (error) {
    console.log(`⚠️ Error checking SSO token: ${error.message}`);
    return false;
  }
}

/**
 * Wrapper for compatibility with existing code
 */
function validateSession(profile, quiet = true) {
  // Temporarily suppress console output for quiet mode
  const originalLog = console.log;
  if (quiet) {
    console.log = () => {};
  }

  const valid = isSessionValid(profile);

  // Restore console.log
  if (quiet) {
    console.log = originalLog;
  }

  // Get expiration info if valid
  let expiresIn = null;
  if (valid) {
    const credsExpireResult = execAwsCommand(['configure', 'get', 'aws_session_expiration', '--profile', profile]);
    if (credsExpireResult.success && credsExpireResult.stdout) {
      const expirationTime = new Date(credsExpireResult.stdout);
      const currentTime = new Date();
      const remainingTimeMs = expirationTime - currentTime;
      const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
      const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));

      if (remainingHours > 0) {
        expiresIn = `${remainingHours}h ${remainingMinutes}m`;
      } else {
        expiresIn = `${remainingMinutes}m`;
      }
    }
  }

  return {
    isValid: valid,
    expiresIn: expiresIn
  };
}

module.exports = {
  checkCredentialsExpired,
  isSessionValid,
  validateSession
};
