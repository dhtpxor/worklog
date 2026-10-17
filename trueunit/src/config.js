// src/config.js — 환경변수 → 설정 객체. 테스트에서는 loadConfig({ ... }) 로 덮어쓴다.
import path from "node:path";

export function loadConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    PORT: Number(env.PORT || 8787),
    DATA_DIR: env.DATA_DIR || path.resolve("data"),
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL || "",
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "",
    CLAUDE_MODEL: env.CLAUDE_MODEL || "claude-opus-5-5",
    CLAUDE_EFFORT: env.CLAUDE_EFFORT || "medium",
    MAX_IMAGE_BYTES: Number(env.MAX_IMAGE_BYTES || 8 * 1024 * 1024),
    MAX_BODY_BYTES: Number(env.MAX_BODY_BYTES || 12 * 1024 * 1024),
    ...overrides,
  };
  return cfg;
}
