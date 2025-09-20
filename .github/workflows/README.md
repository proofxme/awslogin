# GitHub Actions Setup

## npm Publishing Workflow

This repository includes an automated npm publishing workflow that can be triggered in multiple ways.

### Prerequisites

1. **NPM Token**: You need to add your npm authentication token as a repository secret:
   - Go to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Your npm access token (get from https://www.npmjs.com/settings/YOUR_USERNAME/tokens)

### Triggering the Workflow

The publish workflow can be triggered in 3 ways:

#### 1. Manual Dispatch (Recommended)
Go to Actions → Publish to npm → Run workflow

Options:
- **Version**: Specify version to publish (e.g., `3.0.1`)
- **Create Release**: Whether to create a GitHub release (default: true)

#### 2. Git Tags
```bash
git tag v3.0.1
git push origin v3.0.1
```

This will automatically:
- Publish to npm
- Create a GitHub release with changelog

#### 3. GitHub Release
Creating a release through GitHub UI will trigger the publish workflow.

### Workflow Features

- ✅ Checks if version already exists on npm (prevents duplicate publishes)
- ✅ Runs lint tests before publishing
- ✅ Automatically generates changelog from commits
- ✅ Creates GitHub releases with proper release notes
- ✅ Updates package.json version if needed
- ✅ Provides detailed summary in GitHub Actions UI
- ✅ Verifies publication success

### Version Management

The workflow determines version from (in order of priority):
1. Manual input (when using workflow_dispatch)
2. Git tag (when pushing tags)
3. package.json version (fallback)

### Example Usage

#### Publishing a new patch version:
1. Go to Actions tab
2. Select "Publish to npm"
3. Click "Run workflow"
4. Enter version: `3.0.1`
5. Keep "Create Release" checked
6. Click "Run workflow"

#### Publishing without release:
Same as above but uncheck "Create Release" if you only want to publish to npm.

### Troubleshooting

**Error: 401 Unauthorized**
- Check that `NPM_TOKEN` secret is set correctly
- Ensure token has publish permissions

**Error: Version already exists**
- The version is already published to npm
- Update to a new version number

**Tests failing**
- Run `npm run lint` locally to check for issues
- Fix any syntax errors before publishing