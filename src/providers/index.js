import { GitLabProvider } from './gitlab.js';
import { GitHubProvider } from './github.js';

/**
 * Detects the current CI platform from well-known environment variables
 * and returns the appropriate provider instance.
 */
export function detectProvider() {
  if (process.env.GITLAB_CI === 'true') {
    console.log('[aspen-connector] Platform detected: GitLab CI');
    return new GitLabProvider();
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log('[aspen-connector] Platform detected: GitHub Actions');
    return new GitHubProvider();
  }
  throw new Error(
    'Unsupported CI platform. Expected GITLAB_CI=true (GitLab) or GITHUB_ACTIONS=true (GitHub Actions) to be set.'
  );
}

export function detectSource() {
  if (process.env.GITLAB_CI === 'true')      return 'SOURCE_GITLAB';
  if (process.env.GITHUB_ACTIONS === 'true') return 'SOURCE_GITHUB';
  return null;
}
