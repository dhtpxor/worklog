import test from "node:test";
import assert from "node:assert/strict";
import { fetchImage, isPrivate, sniffImageType } from "../src/fetchImage.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const pub = async () => [{ address: "93.184.216.34", family: 4 }];
const resp = (status, body = Buffer.alloc(0), headers = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers });

test("내부망·특수 주소 판별", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) assert.equal(isPrivate(ip), false, ip);
});

test("내부망으로 풀리는 주소는 받지 않는다", async () => {
  const r = await fetchImage("http://metadata.internal/latest", { lookup: async () => [{ address: "169.254.169.254" }], fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /내부망/);
});

test("리다이렉트로 내부망에 가면 막는다", async () => {
  let calls = 0;
  const r = await fetchImage("https://img.example.com/a.png", {
    lookup: async (h) => (h === "img.example.com" ? [{ address: "93.184.216.34" }] : [{ address: "10.0.0.5" }]),
    fetchImpl: async () => { calls++; return resp(302, null, { location: "http://intranet.local/x.png" }); },
  });
  assert.equal(r.ok, false);
  assert.equal(calls, 1);
});

test("이미지 형식 판별과 정상 수신", async () => {
  assert.equal(sniffImageType(Buffer.from("RIFF0000WEBPVP8 ", "ascii")), "image/webp");
  const ok = await fetchImage("https://img.example.com/a.png", { lookup: pub, fetchImpl: async () => resp(200, PNG) });
  assert.equal(ok.ok, true);
  assert.equal(ok.media_type, "image/png");
  const html = await fetchImage("https://img.example.com/a.png", { lookup: pub, fetchImpl: async () => resp(200, Buffer.from("<html>")) });
  assert.equal(html.ok, false);
  assert.equal((await fetchImage("file:///etc/passwd", { lookup: pub })).ok, false);
  const big = await fetchImage("https://img.example.com/a.png", { lookup: pub, fetchImpl: async () => resp(200, PNG, { "content-length": String(9 * 1024 * 1024) }) });
  assert.match(big.error, /5MB/);
});
