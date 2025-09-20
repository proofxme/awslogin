'use strict';

const { askText, askYesNo, selectFromList } = require('../core/prompt');

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
    return askYesNo(message, { defaultYes: defaultValue });
  }

  /**
   * Prompts for text input
   */
  async input(message, options = {}) {
    return askText(message, options);
  }

  /**
   * Prompts for selection from a list
   */
  async select(message, choices, options = {}) {
    // Convert choices to the format expected by selectFromList
    const formattedChoices = choices.map(choice => {
      if (typeof choice === 'string') {
        return choice;
      }
      // If choice has title, use that as the display
      return choice.title || choice.label || choice.value;
    });

    const selected = await selectFromList(formattedChoices, {
      header: message,
      ...options
    });

    // Find and return the original choice object or value
    const selectedIndex = formattedChoices.indexOf(selected);
    if (selectedIndex >= 0 && typeof choices[selectedIndex] === 'object') {
      return choices[selectedIndex].value;
    }
    return selected;
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