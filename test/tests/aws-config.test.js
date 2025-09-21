'use strict';

/**
 * AWS Config Service Tests
 */

module.exports = async function(test) {
  test.describe('AWS Config Service', () => {
    let configService;
    let mockAWS, mockFS;
    let cacheTimestamp;

    test.beforeEach(() => {
      mockAWS = global.mockAWS;
      mockFS = global.mockFS;

      mockAWS.reset();
      mockFS.reset();
      cacheTimestamp = 0;

      // Mock AWS Config service with caching
      configService = {
        profileCache: null,
        cacheTimestamp: 0,
        CACHE_TTL: 5000,

        getProfileConfig: async function(profile) {
          // Check cache
          if (this.profileCache && (Date.now() - this.cacheTimestamp) < this.CACHE_TTL) {
            return this.profileCache[profile] || {};
          }

          // Refresh cache
          await this.refreshCache();
          return this.profileCache[profile] || {};
        },

        setProfileConfig: function(profile, key, value) {
          if (!mockAWS.profiles.has(profile)) {
            mockAWS.profiles.set(profile, {});
          }
          mockAWS.profiles.get(profile)[key] = value;

          // Invalidate cache
          this.profileCache = null;
          return { success: true };
        },

        refreshCache: async function() {
          this.profileCache = {};

          // Read all profiles
          for (const [name, data] of mockAWS.profiles) {
            this.profileCache[name] = { ...data };
          }

          this.cacheTimestamp = Date.now();
          return this.profileCache;
        },

        listProfiles: async function() {
          if (this.profileCache && (Date.now() - this.cacheTimestamp) < this.CACHE_TTL) {
            return Object.keys(this.profileCache);
          }

          await this.refreshCache();
          return Object.keys(this.profileCache);
        },

        deleteProfile: function(profile) {
          mockAWS.profiles.delete(profile);

          // Invalidate cache
          this.profileCache = null;
          return { success: true };
        },

        exportProfiles: function() {
          const profiles = {};
          for (const [name, data] of mockAWS.profiles) {
            profiles[name] = { ...data };
          }
          return profiles;
        },

        importProfiles: function(profiles) {
          for (const [name, data] of Object.entries(profiles)) {
            mockAWS.profiles.set(name, data);
          }

          // Invalidate cache
          this.profileCache = null;
          return { success: true };
        },

        getDefaultRegion: function() {
          return process.env.AWS_DEFAULT_REGION || 'us-east-1';
        }
      };
    });

    test.it('should get profile configuration', async () => {
      const config = await configService.getProfileConfig('test-sso');

      test.expect(config.sso_start_url).toBe('https://test.awsapps.com/start');
      test.expect(config.sso_region).toBe('us-east-1');
    });

    test.it('should set profile configuration', () => {
      const result = configService.setProfileConfig('new-profile', 'region', 'eu-west-1');

      test.expect(result.success).toBe(true);

      const profileData = mockAWS.profiles.get('new-profile');
      test.expect(profileData.region).toBe('eu-west-1');
    });

    test.it('should use cache for profile config', async () => {
      // First call - populates cache
      const config1 = await configService.getProfileConfig('test-sso');
      const timestamp1 = configService.cacheTimestamp;

      // Second call - uses cache
      const config2 = await configService.getProfileConfig('test-sso');
      const timestamp2 = configService.cacheTimestamp;

      test.expect(config1).toEqual(config2);
      test.expect(timestamp1).toBe(timestamp2); // Cache not refreshed
    });

    test.it('should invalidate cache on profile update', async () => {
      // Get config to populate cache
      await configService.getProfileConfig('test-sso');
      test.expect(configService.profileCache).toBeTruthy();

      // Update profile
      configService.setProfileConfig('test-sso', 'output', 'json');

      // Cache should be invalidated
      test.expect(configService.profileCache).toBeFalsy();
    });

    test.it('should list all profiles', async () => {
      const profiles = await configService.listProfiles();

      test.expect(profiles).toContain('test-sso');
      test.expect(profiles).toContain('test-mfa');
      test.expect(profiles.length).toBe(2);
    });

    test.it('should delete profile', () => {
      // Verify profile exists
      test.expect(mockAWS.profiles.has('test-mfa')).toBe(true);

      // Delete profile
      const result = configService.deleteProfile('test-mfa');
      test.expect(result.success).toBe(true);

      // Verify profile deleted
      test.expect(mockAWS.profiles.has('test-mfa')).toBe(false);
    });

    test.it('should export all profiles', () => {
      // Re-add test-mfa since it was deleted in previous test
      mockAWS.profiles.set('test-mfa', {
        aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        aws_secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        mfa_serial: 'arn:aws:iam::123456789012:mfa/testuser',
        region: 'us-east-1',
        output: 'json'
      });

      const exported = configService.exportProfiles();

      test.expect(exported['test-sso']).toBeTruthy();
      test.expect(exported['test-mfa']).toBeTruthy();
      test.expect(exported['test-sso'].sso_start_url).toBe('https://test.awsapps.com/start');
    });

    test.it('should import profiles', () => {
      const newProfiles = {
        'imported-profile': {
          region: 'ap-southeast-1',
          output: 'json'
        }
      };

      const result = configService.importProfiles(newProfiles);
      test.expect(result.success).toBe(true);

      // Verify imported
      const profileData = mockAWS.profiles.get('imported-profile');
      test.expect(profileData.region).toBe('ap-southeast-1');
    });

    test.it('should refresh cache when TTL expires', async () => {
      // First call
      await configService.getProfileConfig('test-sso');
      const timestamp1 = configService.cacheTimestamp;

      // Simulate TTL expiration
      configService.cacheTimestamp = Date.now() - 10000;

      // Second call should refresh cache
      await configService.getProfileConfig('test-sso');
      const timestamp2 = configService.cacheTimestamp;

      test.expect(timestamp2 > timestamp1).toBe(true);
    });

    test.it('should get default region', () => {
      // Default
      let region = configService.getDefaultRegion();
      test.expect(region).toBe('us-east-1');

      // From environment
      process.env.AWS_DEFAULT_REGION = 'eu-west-2';
      region = configService.getDefaultRegion();
      test.expect(region).toBe('eu-west-2');

      // Cleanup
      delete process.env.AWS_DEFAULT_REGION;
    });
  });
};