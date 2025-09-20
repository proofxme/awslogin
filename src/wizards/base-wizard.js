'use strict';

const { prompt } = require('../core/prompt');

/**
 * Base wizard class providing common functionality for all wizards
 */
class BaseWizard {
  constructor() {
    this.steps = [];
    this.currentStep = 0;
    this.context = {};
  }

  /**
   * Shows progress indicator
   */
  showProgress(message) {
    if (this.steps.length > 0) {
      console.log(`\n[${this.currentStep + 1}/${this.steps.length}] ${message}`);
      console.log('─'.repeat(50));
    } else {
      console.log(`\n${message}`);
      console.log('─'.repeat(50));
    }
  }

  /**
   * Shows a success message
   */
  showSuccess(message) {
    console.log(`✅ ${message}`);
  }

  /**
   * Shows an error message
   */
  showError(message) {
    console.log(`❌ ${message}`);
  }

  /**
   * Shows an info message
   */
  showInfo(message) {
    console.log(`ℹ️  ${message}`);
  }

  /**
   * Shows a warning message
   */
  showWarning(message) {
    console.log(`⚠️  ${message}`);
  }

  /**
   * Confirms an action with the user
   */
  async confirm(message, defaultValue = true) {
    return prompt.confirm(message, defaultValue);
  }

  /**
   * Prompts for text input
   */
  async input(message, options = {}) {
    return prompt.text(message, options);
  }

  /**
   * Prompts for selection from a list
   */
  async select(message, choices, options = {}) {
    return prompt.select(message, choices, options);
  }

  /**
   * Clear the screen
   */
  clear() {
    console.clear();
  }

  /**
   * Show a banner/header
   */
  showBanner(title, subtitle) {
    console.log('\n' + '═'.repeat(50));
    console.log(`  ${title}`);
    if (subtitle) {
      console.log(`  ${subtitle}`);
    }
    console.log('═'.repeat(50) + '\n');
  }

  /**
   * Run the wizard (must be implemented by subclasses)
   */
  async run() {
    throw new Error('run() must be implemented by subclass');
  }
}

module.exports = BaseWizard;