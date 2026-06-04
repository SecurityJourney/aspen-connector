/**
 * GitHub Actions provider — Phase 2.
 *
 * Will port metadata collection from guardian-action (Octokit + context)
 * and commit-back logic (git CLI via @actions/exec).
 *
 * Dependencies to add in Phase 2:
 *   @actions/core, @actions/exec, @actions/github
 */
export class GitHubProvider {
  async getMetadata() {
    throw new Error(
      'GitHubProvider is not yet implemented (Phase 2). ' +
      'If you are running in GitHub Actions, this will be supported in an upcoming release.'
    );
  }

  async commitFile() {
    throw new Error(
      'GitHubProvider is not yet implemented (Phase 2). ' +
      'If you are running in GitHub Actions, this will be supported in an upcoming release.'
    );
  }
}
