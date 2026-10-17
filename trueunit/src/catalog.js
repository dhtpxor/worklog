// src/catalog.js — 카테고리별 촬영 체크포인트.
// weight 는 위험 점수에서 그 부위가 차지하는 비중(카테고리 안에서 상대값).
// guide 는 판매자/검수사에게 보여줄 촬영 안내다. 브랜드별 세부 판정 기준은
// 공개하지 않는다(위조범이 학습하지 못하도록). 판정 기준은 AI 프롬프트와 검수사 지식에 둔다.

export const CATALOG = {
  sneakers: {
    id: "sneakers",
    label: "스니커즈",
    guarantee: { base_rate_bps: 200, max_coverage_krw: 1_000_000 },
    checkpoints: [
      { id: "overall_side", label: "옆면 전체", required: true, weight: 0.6, guide: "신발 한 짝의 바깥쪽 옆면 전체가 화면을 꽉 채우게, 정면에서 수평으로 찍어 주세요." },
      { id: "toe_box_stitching", label: "앞코 스티칭", required: true, weight: 1.2, guide: "앞코 부분 박음질이 선명하게 보이도록 10~15cm 거리에서 찍어 주세요." },
      { id: "tongue_label", label: "텅 라벨", required: true, weight: 1.4, guide: "혀(텅) 라벨의 로고와 글자가 읽히도록 정면에서 가까이 찍어 주세요." },
      { id: "size_tag", label: "사이즈 태그(안쪽)", required: true, weight: 1.6, guide: "신발 안쪽 사이즈 태그의 모든 글자와 숫자가 초점이 맞게 보이도록 찍어 주세요." },
      { id: "insole_logo", label: "인솔 로고", required: false, weight: 0.8, guide: "깔창 위쪽 로고 인쇄를 위에서 수직으로 찍어 주세요." },
      { id: "outsole", label: "밑창", required: true, weight: 0.9, guide: "밑창 전체 패턴이 보이도록 위에서 수직으로 찍어 주세요." },
      { id: "heel", label: "뒤꿈치", required: false, weight: 0.7, guide: "뒤꿈치 로고·자수와 힐탭을 정면에서 찍어 주세요." },
      { id: "box_label", label: "박스 라벨", required: true, weight: 1.3, guide: "상자 옆면 라벨의 모델명·컬러코드·사이즈·바코드가 모두 읽히게 찍어 주세요." },
    ],
  },
  handbags: {
    id: "handbags",
    label: "명품 가방",
    guarantee: { base_rate_bps: 250, max_coverage_krw: 3_000_000 },
    checkpoints: [
      { id: "overall_front", label: "정면 전체", required: true, weight: 0.6, guide: "가방 정면 전체가 화면을 채우도록, 정면에서 수평으로 찍어 주세요." },
      { id: "logo_stamp", label: "로고 각인", required: true, weight: 1.5, guide: "내부·외부 로고 각인(히트스탬프)을 비스듬한 빛 아래 가까이 찍어 주세요. 글자 깊이가 보이면 좋습니다." },
      { id: "serial_or_datecode", label: "시리얼/데이트코드", required: true, weight: 1.6, guide: "시리얼·데이트코드 택이나 각인을 글자가 읽히도록 찍어 주세요. 없으면 '없음' 메모를 남겨 주세요." },
      { id: "hardware_engraving", label: "금속 장식 각인", required: true, weight: 1.3, guide: "버클·잠금장치·지퍼 헤드의 각인을 반사가 적은 각도에서 가까이 찍어 주세요." },
      { id: "stitching_handle", label: "손잡이 박음질", required: true, weight: 1.1, guide: "손잡이 연결부 박음질 땀이 셀 수 있을 만큼 가까이 찍어 주세요." },
      { id: "pattern_alignment", label: "패턴 정렬", required: false, weight: 0.9, guide: "솔기를 가로지르는 패턴(모노그램 등) 이어짐이 보이도록 찍어 주세요." },
      { id: "interior_tag", label: "내부 태그·안감", required: true, weight: 1.0, guide: "안감과 내부 태그 전체를 찍어 주세요." },
      { id: "edge_paint", label: "엣지 마감", required: false, weight: 0.7, guide: "가죽 단면(엣지) 마감을 가까이 찍어 주세요." },
    ],
  },
};

export function getCategory(id) {
  return CATALOG[id] || null;
}

export function publicCatalog() {
  return Object.values(CATALOG).map((c) => ({
    id: c.id,
    label: c.label,
    checkpoints: c.checkpoints.map(({ id, label, required, guide }) => ({ id, label, required, guide })),
  }));
}
