'use strict';

/**
 * Prompt Mock for testing user input
 */

class PromptMock {
  constructor() {
    this.responses = [];
    this.responseIndex = 0;
    this.reset();
  }

  reset() {
    this.responses = [];
    this.responseIndex = 0;
  }

  addResponse(response) {
    this.responses.push(response);
  }

  addResponses(responses) {
    this.responses.push(...responses);
  }

  async prompt(question) {
    if (this.responseIndex >= this.responses.length) {
      throw new Error(`No mock response available for prompt: ${question.message || question}`);
    }
    return this.responses[this.responseIndex++];
  }

  async input(message, options = {}) {
    if (this.responseIndex >= this.responses.length) {
      return options.default || '';
    }
    return this.responses[this.responseIndex++];
  }

  async confirm(message, defaultValue = false) {
    if (this.responseIndex >= this.responses.length) {
      return defaultValue;
    }
    const response = this.responses[this.responseIndex++];
    return response === true || response === 'yes' || response === 'y';
  }

  async select(message, choices) {
    if (this.responseIndex >= this.responses.length) {
      return choices[0].value || choices[0];
    }
    return this.responses[this.responseIndex++];
  }

  async password(message, options = {}) {
    if (this.responseIndex >= this.responses.length) {
      return '';
    }
    return this.responses[this.responseIndex++];
  }
}

module.exports = { PromptMock };

