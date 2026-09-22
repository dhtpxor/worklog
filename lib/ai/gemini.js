// lib/ai/gemini.js — Google Gemini API (REST, generateContent) — 가벼운 대화·추출·이미지 글자 읽기
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function toDecl(t) { return { name: t.name, description: t.description, parameters: stripSchema(t.input_schema) }; }
function stripSchema(s) {
  if (Array.isArray(s)) return s.map(stripSchema);
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) { if (k === "additionalProperties" || k === "strict") continue; o[k] = typeof v === "object" ? stripSchema(v) : v; }
  if (o.type === "object" && o.properties && Object.keys(o.properties).length === 0) delete o.properties;
  return o;
}

async function call({ cfg, body, fetchImpl = globalThis.fetch, model = cfg.GEMINI_MODEL }) {
  const r = await fetchImpl(`${BASE}/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.GEMINI_API_KEY }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini 오류 (HTTP ${r.status}): ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return j;
}

/** 대화 + 도구 호출 루프. messages: [{role:'user'|'assistant', text}] */
export async function geminiChat({ cfg, system, messages, tools = [], runTool, maxRounds = 6, fetchImpl }) {
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  const usage = { input: 0, output: 0, tools: 0 };
  for (let round = 0; round < maxRounds; round++) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.4 } };
    if (tools.length) body.tools = [{ functionDeclarations: tools.map(toDecl) }];
    const j = await call({ cfg, body, fetchImpl });
    usage.input += j.usageMetadata?.promptTokenCount || 0; usage.output += j.usageMetadata?.candidatesTokenCount || 0;
    const parts = j.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return { text: parts.map((p) => p.text || "").join("").trim() || "(응답 없음)", usage };
    contents.push({ role: "model", parts });
    const responses = [];
    for (const c of calls) { usage.tools++; const result = await runTool(c.functionCall.name, c.functionCall.args || {}); responses.push({ functionResponse: { name: c.functionCall.name, response: { result: String(result) } } }); }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "(도구 호출이 너무 많아 중단했습니다)", usage };
}

/** JSON 추출 */
export async function geminiJson({ cfg, system, prompt, schema, fetchImpl }) {
  const j = await call({ cfg, fetchImpl, body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: stripSchema(schema) } } });
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return { data: JSON.parse(text), usage: { input: j.usageMetadata?.promptTokenCount || 0, output: j.usageMetadata?.candidatesTokenCount || 0 } };
}

/** 이미지(캡처) → 텍스트 */
export async function geminiVision({ cfg, base64, mime = "image/png", prompt, fetchImpl }) {
  const j = await call({ cfg, fetchImpl, body: { contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: base64 } }, { text: prompt }] }], generationConfig: { temperature: 0.1 } } });
  return { text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim(), usage: { input: j.usageMetadata?.promptTokenCount || 0, output: j.usageMetadata?.candidatesTokenCount || 0 } };
}
