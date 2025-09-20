# AWS Login CLI - Interactive Wizard Design Proposal

## Executive Summary
Transform the current complex argument-based CLI into an intelligent, interactive wizard that guides users through authentication and configuration with minimal commands.

## Current Problems
1. **Too Many Arguments**: 8+ different flags to remember
2. **Complex Syntax**: Users need to know specific flag combinations
3. **No Guidance**: Users must understand AWS concepts upfront
4. **Repetitive**: Common workflows require typing long commands

## Proposed Solution Architecture

### 1. Command Simplification

#### Before (Current):
```bash
awslogin company-dev --select
awslogin admin --token 123456
awslogin company --setup-iam-identity-center
awslogin company --configure --all-org
```

#### After (Proposed):
```bash
awslogin                    # Interactive mode - detects what you need
awslogin company-dev        # Smart auth - auto-detects method
awslogin setup              # Guided setup wizard
awslogin manage             # Profile management interface
```

### 2. Interactive Wizard Architecture

```
┌─────────────────────────────────────────────┐
│            Main Entry Point                  │
│              awslogin                        │
└───────────────┬─────────────────────────────┘
                │
        ┌───────▼────────┐
        │  Smart Router  │
        │   Analyzes:    │
        │  - No args?    │
        │  - Profile?    │
        │  - Command?    │
        └───────┬────────┘
                │
    ┌───────────┼───────────┬──────────────┐
    ▼           ▼           ▼              ▼
┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐
│Wizard  │ │Direct  │ │Setup     │ │Manage    │
│Mode    │ │Auth    │ │Wizard    │ │Interface │
└────────┘ └────────┘ └──────────┘ └──────────┘
```

### 3. Core Components

#### A. Interactive Wizard Mode (`awslogin` with no args)
```javascript
// src/wizards/main-wizard.js
class MainWizard {
  async run() {
    const action = await this.selectAction();

    switch(action) {
      case 'authenticate':
        return this.authWizard();
      case 'setup':
        return this.setupWizard();
      case 'manage':
        return this.manageWizard();
      case 'help':
        return this.interactiveHelp();
    }
  }

  async selectAction() {
    return prompt.select('What would you like to do?', [
      { title: '🔐 Authenticate to AWS', value: 'authenticate' },
      { title: '⚙️  Setup new profile', value: 'setup' },
      { title: '📋 Manage profiles', value: 'manage' },
      { title: '❓ Get help', value: 'help' }
    ]);
  }
}
```

#### B. Smart Authentication (`awslogin <profile>`)
```javascript
// src/services/smart-auth.js
class SmartAuth {
  async authenticate(profile) {
    // Auto-detect authentication method
    const method = await this.detectAuthMethod(profile);

    // Use appropriate flow with minimal user input
    switch(method) {
      case 'sso':
        return this.ssoFlow(profile);
      case 'mfa':
        return this.mfaFlow(profile);
      case 'direct':
        return this.directFlow(profile);
      default:
        return this.wizardFlow(profile);
    }
  }

  async detectAuthMethod(profile) {
    // Intelligent detection based on profile config
    const config = await this.getProfileConfig(profile);

    if (config.sso_start_url) return 'sso';
    if (config.mfa_serial) return 'mfa';
    if (config.aws_access_key_id) return 'direct';

    return 'wizard'; // Fall back to wizard
  }
}
```

#### C. Setup Wizard (`awslogin setup`)
```javascript
// src/wizards/setup-wizard.js
class SetupWizard {
  async run() {
    console.log('🎯 AWS Profile Setup Wizard\n');

    // Step 1: Choose setup type
    const setupType = await this.selectSetupType();

    // Step 2: Gather minimal required info
    const config = await this.gatherConfig(setupType);

    // Step 3: Validate and test
    await this.validateConfig(config);

    // Step 4: Save and confirm
    await this.saveProfile(config);

    // Step 5: Optional - test authentication
    const test = await prompt.confirm('Test authentication now?');
    if (test) await this.testAuth(config.profileName);
  }

  async selectSetupType() {
    return prompt.select('How do you authenticate to AWS?', [
      {
        title: '🏢 AWS SSO / Identity Center (Recommended)',
        value: 'sso',
        description: 'For organizations using AWS SSO'
      },
      {
        title: '📱 MFA with long-term credentials',
        value: 'mfa',
        description: 'Traditional IAM users with MFA'
      },
      {
        title: '🔑 Direct credentials (Not recommended)',
        value: 'direct',
        description: 'For development/testing only'
      },
      {
        title: '🔄 Import from existing profile',
        value: 'import',
        description: 'Copy settings from another profile'
      }
    ]);
  }
}
```

#### D. Profile Manager (`awslogin manage`)
```javascript
// src/wizards/manage-wizard.js
class ManageWizard {
  async run() {
    const profiles = await this.listProfiles();

    const action = await prompt.select('Profile Management', [
      { title: '📝 Edit profile', value: 'edit' },
      { title: '🗑️  Delete profile', value: 'delete' },
      { title: '📋 List all profiles', value: 'list' },
      { title: '🔄 Refresh credentials', value: 'refresh' },
      { title: '🧹 Clean expired sessions', value: 'clean' },
      { title: '📊 Show profile details', value: 'details' },
      { title: '🏢 Setup organization profiles', value: 'org' }
    ]);

    await this.executeAction(action, profiles);
  }
}
```

### 4. Configuration Management

#### A. Smart Defaults
```javascript
// src/config/defaults.js
const SMART_DEFAULTS = {
  sso: {
    region: 'us-east-1',
    role_name: 'AdministratorAccess',
    duration: 43200, // 12 hours
    output: 'json'
  },
  mfa: {
    duration: 3600, // 1 hour
    region: 'us-east-1'
  },
  // Auto-detect from environment
  detectFromEnv: () => ({
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
    output: process.env.AWS_DEFAULT_OUTPUT || 'json'
  })
};
```

#### B. Profile Templates
```javascript
// src/config/templates.js
const PROFILE_TEMPLATES = {
  'developer': {
    name: 'Development Setup',
    config: {
      role_name: 'DeveloperAccess',
      duration: 28800,
      output: 'json'
    }
  },
  'admin': {
    name: 'Administrator Setup',
    config: {
      role_name: 'AdministratorAccess',
      duration: 3600,
      output: 'json'
    }
  },
  'readonly': {
    name: 'Read-Only Access',
    config: {
      role_name: 'ReadOnlyAccess',
      duration: 43200,
      output: 'table'
    }
  }
};
```

### 5. User Experience Improvements

#### A. Progress Indicators
```javascript
// src/ui/progress.js
class ProgressIndicator {
  constructor(steps) {
    this.steps = steps;
    this.current = 0;
  }

  show() {
    console.log(`\n[${this.current}/${this.steps.length}] ${this.steps[this.current]}`);
    console.log('─'.repeat(50));
  }

  next() {
    this.current++;
    this.show();
  }
}
```

#### B. Contextual Help
```javascript
// src/ui/help-context.js
const CONTEXTUAL_HELP = {
  'sso_start_url': {
    description: 'Your AWS SSO portal URL',
    example: 'https://my-company.awsapps.com/start',
    hint: 'Usually ends with .awsapps.com/start'
  },
  'role_name': {
    description: 'IAM role to assume',
    example: 'AdministratorAccess',
    hint: 'Common: AdministratorAccess, DeveloperAccess, ReadOnlyAccess'
  }
};
```

#### C. Auto-Discovery
```javascript
// src/services/auto-discovery.js
class AutoDiscovery {
  async discoverSSOUrl() {
    // Check existing profiles for SSO URLs
    const profiles = await this.getAllProfiles();
    const ssoUrls = profiles
      .map(p => p.sso_start_url)
      .filter(Boolean);

    if (ssoUrls.length === 1) {
      return ssoUrls[0]; // Auto-use if only one
    }

    return null;
  }

  async discoverOrganization() {
    // Try to detect organization from existing setup
    try {
      const org = await aws('organizations describe-organization');
      return org.Organization;
    } catch {
      return null;
    }
  }
}
```

### 6. Command Aliases and Shortcuts

```javascript
// src/cli/aliases.js
const COMMAND_ALIASES = {
  // Quick actions
  'login': 'authenticate',
  'auth': 'authenticate',
  'config': 'setup',
  'wizard': 'setup',

  // Short flags
  '-s': '--select',
  '-c': '--configure',
  '-h': '--help',

  // Smart commands
  'switch': 'change-profile',
  'list': 'list-profiles',
  'clean': 'clean-sessions'
};
```

### 7. Implementation Plan

#### Phase 1: Core Wizard Infrastructure
1. Create wizard base class
2. Implement prompt utilities
3. Add progress/UI components
4. Setup configuration templates

#### Phase 2: Smart Authentication
1. Build authentication detector
2. Implement smart defaults
3. Add auto-discovery features
4. Create fallback mechanisms

#### Phase 3: Interactive Wizards
1. Main wizard (no args)
2. Setup wizard
3. Management wizard
4. Help system

#### Phase 4: Enhanced Features
1. Profile templates
2. Batch operations
3. Session management
4. Organization support

### 8. Migration Strategy

The new system will be **fully backward compatible**:

```javascript
// src/cli/compatibility.js
class CompatibilityLayer {
  async handleLegacyArgs(argv) {
    // Map old args to new system
    if (argv.includes('--setup-iam-identity-center')) {
      return this.setupWizard.run('identity-center');
    }

    if (argv.includes('--configure') && argv.includes('--all-org')) {
      return this.manageWizard.runOrgSetup();
    }

    // ... handle all legacy combinations
  }
}
```

### 9. Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| **New User Setup** | Read docs, understand flags | Run `awslogin setup`, follow prompts |
| **Daily Auth** | `awslogin profile --select` | `awslogin profile` (auto-detects) |
| **Profile Management** | Multiple commands with flags | `awslogin manage` interactive menu |
| **Learning Curve** | High - must know AWS concepts | Low - wizard guides you |
| **Command Memory** | Remember 8+ flags | Remember 3-4 commands |
| **Error Recovery** | Cryptic AWS errors | Friendly suggestions |
| **Efficiency** | Type long commands | Use shortcuts and smart defaults |

### 10. Example User Flows

#### New User First Setup
```
$ awslogin
Welcome to AWS Login! No profiles detected.

? What would you like to do?
> Setup new profile

? How do you authenticate to AWS?
> AWS SSO / Identity Center

? Enter your SSO start URL: [auto-detected: https://mycompany.awsapps.com/start]
> (press enter to accept)

? Profile name: work
✓ Profile 'work' created!

? Test authentication now? (Y/n)
> Y

✓ Successfully authenticated!
```

#### Daily Authentication
```
$ awslogin work
✓ Detected SSO profile
✓ Session valid for 11h 45m
✓ Ready to use AWS CLI!
```

#### Quick Profile Switch
```
$ awslogin
? Select profile:
> work (SSO - expires in 11h)
  personal (MFA - expired)
  dev (Direct - active)

Switched to 'work' profile
```

## Conclusion

This design transforms awslogin from a complex CLI tool into an intelligent assistant that guides users through AWS authentication with minimal friction. The wizard approach reduces cognitive load while maintaining full power-user capabilities through smart defaults and shortcuts.