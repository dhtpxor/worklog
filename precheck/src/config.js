// src/config.js
export function loadConfig(overrides = {}) {
  const e = process.env;
  return {
    PORT: Number(e.PORT || 8790),
    PRECHECK_API_KEY: e.PRECHECK_API_KEY || "",
    ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY || "",
    CLAUDE_MODEL: e.CLAUDE_MODEL || "claude-opus-5-5",
    CLAUDE_EFFORT: e.CLAUDE_EFFORT || "low",
    AI_SKIP_WHEN_BLOCKED: e.AI_SKIP_WHEN_BLOCKED !== "false",
    FOOD_AGENCY_REGISTERED: e.FOOD_AGENCY_REGISTERED === "true",
    MAX_BODY_BYTES: 2 * 1024 * 1024,
    ...overrides,
  };
}
