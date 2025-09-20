# Repository Guidelines

## Project Structure & Module Organization
The CLI entry point is `bin/awslogin.js`, which wires together the authentication workflow. Reusable logic is split across `lib/modules/`, e.g. `authManager.js` for dispatching SSO/MFA paths, `identityCenter.js` for IAM Identity Center helpers, and `utils.js` for AWS CLI wrappers. Project metadata lives in `package.json`; top-level docs such as `README.md` and `WARP.md` describe usage scenarios. Shell utilities, including `test-accounts.sh`, sit alongside the root scripts.

## Build, Test, and Development Commands
Install dependencies locally with `npm install` (none are required today, but this keeps the lockfile consistent). During development, run `node bin/awslogin.js <profile>` or, after `npm link`, call `awslogin <profile>` directly. Use `node bin/awslogin.js --help` to confirm flag handling. The CLI targets Node.js ≥14 and shelling out to the AWS CLI; ensure `aws` and `jq` are on PATH before testing flows.

## Coding Style & Naming Conventions
Code is CommonJS-based with two-space indentation and `const`/`let` usage. Keep modules focused by exporting small functions and avoid side effects on require. Prefer descriptive function names (`handleSsoAuth`, `checkCredentialsExpired`) and mirror existing emoji-forward status messages for consistency. When adding files, place shared helpers under `lib/modules/` and keep filenames in camelCase (e.g., `profileConfig.js`).

## Testing Guidelines
There is no automated test runner yet; validate changes with targeted manual checks. Exercise SSO, MFA, and direct credential paths using representative AWS profiles. Run `./test-accounts.sh` when modifying Identity Center account selection to verify cross-account assumptions. Capture CLI output for regressions and consider contributing Jest-based unit tests for new logic—co-locate them under a `__tests__/` directory if introduced.

## Commit & Pull Request Guidelines
Match the existing conventional style (`feat:`, `fix:`, `chore:`) seen in `git log`. Write concise, imperative summaries that mention the scope (e.g., `feat: improve session validation timing`). Pull requests should describe the problem, the solution, manual verification steps, and any AWS profile specifics used for testing. Link relevant issues and add screenshots or terminal transcripts when UX changes are involved.

## Security & Configuration Tips
Never commit real AWS credentials or SSO cache files. Use example placeholders in documentation and scrub logs before sharing. If you touch configuration defaults, highlight required environment variables or AWS CLI prerequisites in the PR description so operators can update runbooks promptly.
