export const SECRET_ENV_PATTERNS = [
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASS",
  "API_KEY",
  "ACCESS_KEY",
  "PRIVATE_KEY",
  "CREDENTIAL",
];

export function buildCapabilityReview({ skills, repos, env, mcpServers, permissions }) {
  const envKeys = Object.keys(env).sort();
  const secretEnvKeys = envKeys.filter(isSecretEnvKey);
  const riskFlags = [];

  for (const skill of skills) {
    if (skill.riskLevel === "high" || skill.riskLevel === "critical") {
      riskFlags.push(`${skill.riskLevel}_risk_skill:${skill.name}`);
    }
  }
  for (const key of secretEnvKeys) {
    riskFlags.push(`secret_env:${key}`);
  }
  for (const server of mcpServers) {
    riskFlags.push(`mcp_enabled:${server}`);
  }
  if (permissions.scopes.includes("repo:write")) {
    riskFlags.push("repo_write_scope");
  }
  for (const skill of skills) {
    if (skill.permissions.includes("shell:write")) {
      riskFlags.push(`shell_write_skill:${skill.name}`);
    }
  }

  return {
    repos,
    envKeys,
    secretEnvKeys,
    mcpServers,
    riskFlags,
  };
}

export function isSecretEnvKey(key) {
  const upper = key.toUpperCase();
  return SECRET_ENV_PATTERNS.some((pattern) => upper.includes(pattern));
}
