// lib/ai/claude.js — Anthropic Claude (공식 SDK) — 어려운 요청: 분석·요약·보고서 초안·긴 문맥
let AnthropicMod = null;
async function client(cfg) {
  if (!AnthropicMod) AnthropicMod = (await import("@anthropic-ai/sdk")).default;
  return new AnthropicMod({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
}

/** 대화 + 도구 호출 루프 (manual loop: Gemini 와 같은 도구 정의를 공유하기 위해) */
export async function claudeChat({ cfg, system, messages, tools = [], runTool, maxRounds = 6, clientImpl }) {
  const c = clientImpl || await client(cfg);
  const msgs = messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
  const usage = { input: 0, output: 0, tools: 0 };
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, strict: true }));
  for (let round = 0; round < maxRounds; round++) {
    const params = { model: cfg.CLAUDE_MODEL, max_tokens: 8000, system, messages: msgs, tools: toolDefs.length ? toolDefs : undefined, output_config: { effort: "medium" } };
    let res;
    try { res = await c.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }); }
    catch (e) { if (e?.status === 400) res = await c.messages.create(params); else throw e; } // 폴백 파라미터를 모르는 환경이면 일반 호출
    usage.input += res.usage?.input_tokens || 0; usage.output += res.usage?.output_tokens || 0;
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (res.stop_reason === "refusal") return { text: text || "(이 요청은 처리할 수 없습니다)", usage };
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) return { text: text || "(응답 없음)", usage };
    msgs.push({ role: "assistant", content: res.content });
    const results = [];
    for (const u of uses) { usage.tools++; const r = await runTool(u.name, u.input || {}); results.push({ type: "tool_result", tool_use_id: u.id, content: String(r) }); }
    msgs.push({ role: "user", content: results });
  }
  return { text: "(도구 호출이 너무 많아 중단했습니다)", usage };
}

/** JSON 추출: strict 도구 하나를 정의하고 그 입력을 결과로 쓴다 */
export async function claudeJson({ cfg, system, prompt, schema, clientImpl }) {
  const c = clientImpl || await client(cfg);
  const res = await c.messages.create({
    model: cfg.CLAUDE_MODEL, max_tokens: 4000, system: `${system}\n\n반드시 record 도구를 한 번 호출해 결과를 담아라.`, messages: [{ role: "user", content: prompt }],
    tools: [{ name: "record", description: "추출 결과 기록", input_schema: schema, strict: true }], output_config: { effort: "low" },
  });
  const u = res.content.find((b) => b.type === "tool_use");
  if (!u) throw new Error("Claude 가 record 도구를 호출하지 않았습니다");
  return { data: u.input, usage: { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0 } };
}
