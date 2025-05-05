#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Get the profile name from command line arguments
const profileName = process.argv[2];

if (!profileName) {
    console.log("ℹ️  Usage: awslogin <profile_name>");
    console.log("Example: awslogin metalab");
    process.exit(1);
}

// Path to the shell script
const scriptPath = path.join(__dirname, 'awslogin.sh');

// Execute the shell script with the profile name
const child = spawn('bash', [scriptPath, profileName], {
    stdio: 'inherit',
    env: { ...process.env }
});

child.on('close', (code) => {
    process.exit(code);
});

