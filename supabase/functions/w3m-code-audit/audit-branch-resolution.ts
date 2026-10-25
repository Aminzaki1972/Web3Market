export function shouldFallbackToDefaultBranch(
  storedBranch: string,
  attemptedBranch: string,
  defaultBranch: string,
  errorMessage: string,
): boolean {
  if (!storedBranch.trim() || attemptedBranch === defaultBranch) return false;
  return /GitHub API (?:404|422).*?(?:No commit found|branch not found|not found|does not exist)/i.test(errorMessage);
}
