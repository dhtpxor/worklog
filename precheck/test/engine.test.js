import test from "node:test";
import assert from "node:assert/strict";
import { textChecks, summarize, mergeAi } from "../src/engine.js";

const run = (title, description = "", settings) => summarize(textChecks([{ source: "title", text: title }, { source: "description", text: description }], settings).findings);
const ids = (r) => r.checks.map((c) => c.rule_id).sort();

test("상표 + 모방 표현은 판매 불가", () => {
  for (const t of ["샤넬st 트위드 자켓", "샤넬 스타일 트위드", "耐克同款 运动鞋", "LV 아니고 루이비통 미러급 지갑", "ナイキ スーパーコピー", "Gucci 1:1 belt", "디올 느낌 레플 백"]) {
    const r = run(t);
    assert.equal(r.verdict, "block", t);
    assert.ok(ids(r).includes("TM_IMITATION"), t);
  }
});

test("상표만 언급하면 확인 필요, 정품 주장은 별도 표시", () => {
  const r = run("나이키 에어포스1 정품 미국 직구");
  assert.equal(r.verdict, "review");
  assert.deepEqual(ids(r), ["TM_MENTION", "TM_OFFICIAL_CLAIM"]);
});

test("호환 표기는 안내만", () => {
  for (const t of ["아이폰 15 호환 실리콘 케이스", "iPhone 15 対応 ケース", "适用于苹果手机 充电线"]) {
    const r = run(t);
    assert.ok(ids(r).includes("TM_COMPAT"), `${t} ${ids(r)}`);
    assert.ok(!ids(r).includes("TM_MENTION"), t);
  }
});

test("캐릭터 상품은 라이선스 확인", () => {
  assert.ok(ids(run("산리오 쿠로미 파우치")).includes("TM_CHARACTER"));
  assert.ok(ids(run("ちいかわ ぬいぐるみ")).includes("TM_CHARACTER"));
  assert.ok(ids(run("拉布布 盲盒 挂件")).includes("TM_CHARACTER"));
});

test("일상 표현은 오탐하지 않는다", () => {
  for (const t of ["fake fur 롱코트 베이비핑크", "초콜릿 브라운 니트", "젤리슈즈 여름 샌들", "prescription glasses frame", "오버핏 스타일 셔츠", "애플망고 무늬 원피스", "supreme quality cotton tee", "아기자기한 데스크 정리함", "자동차 방향제 클립"]) {
    const r = run(t);
    assert.equal(r.verdict, "ok", `${t} → ${ids(r)}`);
  }
});

test("모방 표현만 있고 상표가 없으면 확인 필요", () => {
  const r = run("미러급 레플 가방 신상");
  assert.equal(r.verdict, "review");
  assert.deepEqual(ids(r), ["DUPE_LANGUAGE"]);
});

test("KC 대상 가능성: 전기용품·무선·어린이", () => {
  assert.ok(ids(run("에어프라이어 5L 220V")).includes("KC_ELECTRIC"));
  assert.ok(ids(run("モバイルバッテリー 10000mAh")).includes("KC_ELECTRIC"));
  assert.ok(ids(run("蓝牙耳机 无线")).includes("KC_WIRELESS"));
  assert.ok(ids(run("儿童玩具 积木")).includes("KC_CHILDREN"));
  const r = run("헤어드라이어 1200W");
  assert.equal(r.required_notices.length, 1);
  assert.match(r.required_notices[0].text, /구매대행/);
});

test("식품은 구매대행업 등록 여부에 따라 판매 불가 또는 확인 필요", () => {
  assert.equal(run("일본 青汁 30포").verdict, "block");
  const ok = run("일본 青汁 30포", "", { food_agency_registered: true });
  assert.equal(ok.verdict, "review");
  assert.deepEqual(ids(ok), ["FOOD_REGISTRATION"]);
});

test("반입 차단 성분·의약품·씨앗·육가공품·CBD 는 판매 불가", () => {
  for (const [t, rule] of [["멜라토닌 10mg 구미", "BANNED_INGREDIENT"], ["育亨宾 男士", "BANNED_INGREDIENT"], ["第2類医薬品 ロイヒつぼ膏", "DRUG"], ["토마토 씨앗 50립", "SEED_PLANT"], ["牛肉干 麻辣", "MEAT"], ["CBD 오일 30ml", "CANNABIS"], ["花火 セット", "FIREWORKS"]]) {
    const r = run(t);
    assert.equal(r.verdict, "block", t);
    assert.ok(ids(r).includes(rule), `${t} ${ids(r)}`);
  }
});

test("공식 근거가 아닌 규칙은 확인 필요 표시", () => {
  const r = run("블루투스 스피커");
  assert.equal(r.checks[0].needs_confirmation, true);
  const k = run("가습기 3L");
  assert.equal(k.checks.find((c) => c.rule_id === "KC_ELECTRIC").needs_confirmation, false);
});

test("AI 결과 병합: 이미지 로고, 모방 언급, 분류, 워터마크", () => {
  const { findings } = textChecks([{ source: "title", text: "남성 러닝화 경량" }]);
  mergeAi(findings, { product_categories: ["children", "food"], brands: [{ name: "Nike", source: "image", usage: "logo_on_product" }, { name: "Hoka", source: "text", usage: "imitation_reference" }], characters: [{ name: "Pikachu", source: "image" }], ingredients_of_concern: [], foreign_shop_branding: true, notes: "" });
  const r = summarize(findings);
  assert.equal(r.verdict, "block");
  for (const id of ["TM_IMITATION", "TM_MENTION", "TM_CHARACTER", "KC_CHILDREN", "FOOD_NOT_REGISTERED", "IMAGE_WATERMARK"]) assert.ok(ids(r).includes(id), id);
  assert.ok(r.checks.every((c) => c.evidence.length));
});

test("AI 가 같은 상표를 로고로 찾으면 호환 안내는 지운다", () => {
  const { findings } = textChecks([{ source: "title", text: "아이폰 호환 케이스" }]);
  mergeAi(findings, { product_categories: [], brands: [{ name: "Apple", source: "image", usage: "logo_on_product" }], characters: [], ingredients_of_concern: [], foreign_shop_branding: false, notes: "" });
  const r = summarize(findings);
  assert.ok(!ids(r).includes("TM_COMPAT"));
  assert.ok(ids(r).includes("TM_MENTION"));
});
