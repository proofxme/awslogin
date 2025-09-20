'use strict';

/**
 * Profile templates for common AWS authentication scenarios
 */
const PROFILE_TEMPLATES = {
  'developer': {
    name: '👨‍💻 Developer Access',
    description: 'Standard developer access with moderate session duration',
    authMethod: 'sso',
    config: {
      sso_role_name: 'DeveloperAccess',
      output: 'json',
      cli_pager: ''
    }
  },
  'admin': {
    name: '🔐 Administrator Access',
    description: 'Full administrative access with shorter session for security',
    authMethod: 'sso',
    config: {
      sso_role_name: 'AdministratorAccess',
      output: 'json',
      cli_pager: ''
    }
  },
  'readonly': {
    name: '👁️ Read-Only Access',
    description: 'View-only access for monitoring and reporting',
    authMethod: 'sso',
    config: {
      sso_role_name: 'ReadOnlyAccess',
      output: 'table',
      cli_pager: ''
    }
  },
  'cicd': {
    name: '🤖 CI/CD Pipeline',
    description: 'Automated deployment and testing access',
    authMethod: 'direct',
    config: {
      output: 'json',
      cli_pager: ''
    }
  },
  'production': {
    name: '🚀 Production Access',
    description: 'Production environment with MFA requirement',
    authMethod: 'mfa',
    config: {
      output: 'json',
      cli_pager: '',
      region: 'us-east-1'
    }
  },
  'sandbox': {
    name: '🏖️ Sandbox/Development',
    description: 'Experimental environment with relaxed permissions',
    authMethod: 'sso',
    config: {
      sso_role_name: 'PowerUserAccess',
      output: 'json',
      cli_pager: '',
      region: 'us-west-2'
    }
  }
};

/**
 * Smart defaults for different authentication methods
 */
const SMART_DEFAULTS = {
  sso: {
    region: 'us-east-1',
    output: 'json',
    cli_pager: '',
    sso_role_name: 'AdministratorAccess'
  },
  mfa: {
    region: 'us-east-1',
    output: 'json',
    cli_pager: ''
  },
  direct: {
    region: 'us-east-1',
    output: 'json',
    cli_pager: ''
  }
};

/**
 * Get smart defaults based on environment
 */
function getSmartDefaults(authMethod) {
  const defaults = { ...SMART_DEFAULTS[authMethod] || {} };

  // Override with environment variables if available
  if (process.env.AWS_DEFAULT_REGION) {
    defaults.region = process.env.AWS_DEFAULT_REGION;
  }

  if (process.env.AWS_DEFAULT_OUTPUT) {
    defaults.output = process.env.AWS_DEFAULT_OUTPUT;
  }

  return defaults;
}

module.exports = {
  PROFILE_TEMPLATES,
  SMART_DEFAULTS,
  getSmartDefaults
};