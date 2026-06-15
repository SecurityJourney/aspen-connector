/**
 * Builds the `git` block included with Guardian AI requests.
 * Returns null if the required fields (headSha, committerEmail) are missing.
 * The presence of this block signals to the backend that CWE recording is desired.
 */
export function buildGitBlock(metadata, excludeFields) {
  const excluded = new Set(excludeFields ?? []);

  if (!metadata.headSha || !metadata.committerEmail) {
    return null;
  }

  const git = {
    commitSha: metadata.headSha,
    committerEmail: metadata.committerEmail,
  };

  if (!excluded.has('repo') && metadata.repo) git.repo = metadata.repo;
  if (!excluded.has('username') && metadata.username)
    git.username = metadata.username;
  if (!excluded.has('prNumber') && metadata.prNumber)
    git.prNumber = metadata.prNumber;

  return git;
}
