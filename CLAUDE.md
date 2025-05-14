# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Install Commands
- Install globally: `npm install -g .`
- Install dependencies: `npm install`
- Run the CLI: `awslogin <profile_name>`

## Code Style Guidelines

### JavaScript
- Node.js style (CommonJS modules using `require()`)
- Minimum Node.js version: 14.0.0
- Use const/let, avoid var
- Use meaningful variable names in camelCase
- Use error handling with try/catch blocks
- Comment complex logic with descriptive comments

### Shell Scripts
- Use bash for shell scripts
- Include shebang (`#!/usr/bin/env bash`)
- Exit with appropriate error codes
- Use quotes around variables
- Use descriptive error messages with emoji indicators

### Project Structure
- CLI logic in `/bin` directory
- Main entry point is `bin/cli.js` (Node.js wrapper)
- Core functionality in `bin/awslogin.sh` (Bash script)

### Error Handling
- Use descriptive console messages with emoji indicators
- Exit with non-zero status codes for errors
- Provide clear error messages to guide the user