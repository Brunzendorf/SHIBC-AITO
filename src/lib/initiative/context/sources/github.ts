/**
 * GitHub Context Source
 * TASK-037: GitHub issues context for initiatives
 */

import type { ContextSource, AgentType } from '../../types.js';
import { fetchGitHubIssues, isGitHubAvailable } from '../../github/index.js';

/**
 * GitHub Context Source
 * Fetches open/recent issues for context
 */
export class GitHubContextSource implements ContextSource {
  readonly name = 'github';
  readonly label = 'GitHub Issues';
  readonly cacheTTL = 900; // 15 minutes

  async fetch(_agentType: AgentType): Promise<string> {
    const issues = await fetchGitHubIssues();

    const parts: string[] = [];

    if (issues.open.length > 0) {
      parts.push(`### Open Issues (${issues.open.length})`);
      parts.push(issues.open.slice(0, 10).join('\n'));
    } else {
      parts.push('### Open Issues\nNone');
    }

    if (issues.recent.length > 0) {
      parts.push('\n### Recently Completed');
      parts.push(issues.recent.slice(0, 5).join('\n'));
    }

    return parts.join('\n');
  }

  async isAvailable(): Promise<boolean> {
    return isGitHubAvailable();
  }
}

/**
 * Create GitHub context source
 */
export function createGitHubSource(): ContextSource {
  return new GitHubContextSource();
}
