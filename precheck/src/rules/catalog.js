// src/rules/catalog.js — 검사 규칙과 키워드.
// basis: 근거. confidence: "official"(공식 기관 안내 확인) | "industry"(업계·실무 안내) | "unverified"(확인 필요).
// confidence 가 official 이 아니면 결과 문구에 "확인 필요"가 붙는다. 규칙은 판정이 아니라 "사람이 볼 이유"다.

export const RULES = {
  TM_IMITATION: {
    area: "trademark", severity: "block",
    title: "상표를 모방품 설명에 사용",
    action: "상품을 올리지 마세요. 상표명과 '○○st', '레플', '同款', '高仿' 같은 표현을 함께 쓰면 상표권 침해·부정경쟁 소지가 큽니다.",
    basis: "상표법, 부정경쟁방지법", confidence: "industry",
  },
  TM_MENTION: {
    area: "trademark", severity: "review",
    title: "등록 상표·캐릭터 언급",
    action: "정품이면 구입 증빙(영수증·인보이스)을 보관하고, 아니면 상표명을 지우세요. 상품 이미지 속 로고도 확인하세요.",
    basis: "상표법(정품 병행수입은 허용되나 증빙 필요)", confidence: "industry",
  },
  TM_COMPAT: {
    area: "trademark", severity: "info",
    title: "호환 대상 표기로 상표 사용",
    action: "'호환' 표기는 쓸 수 있지만, '정품', '공식', 상표 로고 사용처럼 그 회사 제품으로 오인할 표현은 빼세요.",
    basis: "상표법(상표의 기술적·설명적 사용)", confidence: "industry",
  },
  TM_CHARACTER: {
    area: "trademark", severity: "review",
    title: "캐릭터 상품",
    action: "정식 라이선스 상품인지 확인하세요. 비라이선스 캐릭터 상품은 상표권과 저작권을 함께 침해할 수 있습니다.",
    basis: "상표법, 저작권법", confidence: "industry",
  },
  TM_OFFICIAL_CLAIM: {
    area: "trademark", severity: "review",
    title: "'정품·공식' 주장",
    action: "정품 주장은 증빙이 있을 때만 쓰세요. 증빙이 없으면 문구를 지우세요.",
    basis: "전자상거래법(거짓·과장 표시), 표시광고법", confidence: "industry",
  },
  DUPE_LANGUAGE: {
    area: "trademark", severity: "review",
    title: "모방품을 뜻하는 표현",
    action: "상표명이 없더라도 모방품 표현은 플랫폼 신고 대상이 되기 쉽습니다. 표현을 지우고 이미지 속 로고를 확인하세요.",
    basis: "오픈마켓 지재권 정책", confidence: "industry",
  },
  KC_ELECTRIC: {
    area: "kc", severity: "review",
    title: "전기용품 (전안법 안전관리대상 가능성)",
    action: "KC 대상 품목인지 확인하세요. 안전인증 대상 등 일부 품목은 2018년 7월부터 KC 없이 구매대행이 불가합니다. 가능한 품목이면 상품 페이지에 구매대행 유통 제품·안전관리대상 제품임을 고지해야 합니다.",
    basis: "전기용품 및 생활용품 안전관리법 (국가기술표준원 제품안전정보센터 안내)", confidence: "official",
  },
  KC_WIRELESS: {
    area: "kc", severity: "review",
    title: "무선기기 (전파법 적합성평가 대상 가능성)",
    action: "블루투스·와이파이 등 무선 기능 제품은 전파법상 적합성평가 대상일 수 있습니다. 구매대행 시 예외 범위를 확인하세요.",
    basis: "전파법", confidence: "unverified",
  },
  KC_CHILDREN: {
    area: "kc", severity: "review",
    title: "어린이제품 (만 13세 이하 대상)",
    action: "어린이제품은 어린이제품 안전 특별법상 KC 대상입니다. 전안법의 구매대행 유예와 같은 취급을 받지 않을 수 있으니 KC 여부를 반드시 확인하세요.",
    basis: "어린이제품 안전 특별법", confidence: "unverified",
  },
  FOOD_REGISTRATION: {
    area: "food_drug", severity: "review",
    title: "식품·건강기능식품",
    action: "'수입식품등 인터넷 구매대행업' 영업등록과 수입신고가 필요합니다. 등록이 없으면 판매하지 마세요.",
    basis: "수입식품안전관리 특별법 (식약처 안내)", confidence: "official",
  },
  FOOD_NOT_REGISTERED: {
    area: "food_drug", severity: "block",
    title: "식품 구매대행업 미등록 상태에서 식품 판매",
    action: "설정에 '인터넷 구매대행업 등록'이 꺼져 있습니다. 등록 전에는 식품·건강기능식품을 올리지 마세요.",
    basis: "수입식품안전관리 특별법", confidence: "official",
  },
  BANNED_INGREDIENT: {
    area: "food_drug", severity: "block",
    title: "반입 차단·의약품 성분",
    action: "판매하지 마세요. 식약처 해외직구 위해식품 차단 대상이거나 국내에서 의약품으로 분류되는 성분입니다.",
    basis: "식약처 해외직구 위해식품 차단목록·반입차단 원료성분", confidence: "industry",
  },
  DRUG: {
    area: "food_drug", severity: "block",
    title: "의약품",
    action: "판매하지 마세요. 해외에서 일반의약품이어도 국내에서는 의약품으로 분류돼 온라인 판매·통관이 안 될 수 있습니다.",
    basis: "약사법, 식약처 해외직구 주의 안내", confidence: "industry",
  },
  QUASI_DRUG: {
    area: "food_drug", severity: "review",
    title: "의약부외품·의약외품 가능성",
    action: "국내 분류(의약품/의약외품/화장품)를 확인하세요. 분류에 따라 구매대행 가능 여부가 달라집니다.",
    basis: "약사법", confidence: "unverified",
  },
  SEED_PLANT: {
    area: "customs", severity: "block",
    title: "씨앗·종자·식물",
    action: "판매하지 마세요. 씨앗·구근·묘목은 식물검역 대상이라 우편·특송 반입이 제한됩니다.",
    basis: "식물방역법", confidence: "industry",
  },
  MEAT: {
    area: "customs", severity: "block",
    title: "육류·육가공품",
    action: "판매하지 마세요. 육포·소시지 등 축산물은 해외직구 반입이 제한됩니다.",
    basis: "가축전염병 예방법", confidence: "industry",
  },
  CANNABIS: {
    area: "customs", severity: "block",
    title: "대마·CBD",
    action: "판매하지 마세요. CBD·대마 성분은 국내에서 마약류로 관리됩니다.",
    basis: "마약류 관리에 관한 법률", confidence: "industry",
  },
  WEAPON_LIKE: {
    area: "customs", severity: "review",
    title: "모의총포·도검·전기충격기류",
    action: "총포·도검·화약류 등 단속법상 판매 제한 품목인지 확인하세요.",
    basis: "총포·도검·화약류 등의 안전관리에 관한 법률", confidence: "unverified",
  },
  FIREWORKS: {
    area: "customs", severity: "block",
    title: "화약류·폭죽",
    action: "판매하지 마세요. 폭죽 등 화약류는 반입·판매가 제한됩니다.",
    basis: "총포·도검·화약류 등의 안전관리에 관한 법률", confidence: "industry",
  },
  NICOTINE: {
    area: "customs", severity: "review",
    title: "전자담배·니코틴",
    action: "니코틴 액상·전자담배 기기는 별도 규제 대상입니다. 판매 가능 여부를 확인하세요.",
    basis: "담배사업법, 관련 고시", confidence: "unverified",
  },
  IMAGE_WATERMARK: {
    area: "listing", severity: "review",
    title: "원 판매처 워터마크·타사 이미지",
    action: "원 판매처 로고·워터마크가 있는 이미지는 저작권 신고 대상이 될 수 있습니다. 직접 촬영하거나 사용 허락을 받은 이미지로 바꾸세요.",
    basis: "저작권법", confidence: "industry",
  },
};

// 키워드 그룹 → 규칙. 매칭은 NFKC 정규화·소문자화 후 수행한다.
// 영문 키워드는 단어 경계로, 한·중·일 키워드는 부분 문자열로 찾는다.
export const KEYWORDS = {
  DUPE_STRONG: ["레플", "레플리카", "replica", "미러급", "정품급", "a급", "s급", "1:1", "aaa급", "高仿", "复刻", "復刻", "原单", "原單", "精仿", "超a", "スーパーコピー", "コピー品"],
  DUPE_WEAK: ["同款", "平替", "dupe", "inspired"],
  OFFICIAL_CLAIM: ["정품", "공식", "正品", "官方", "正規品", "公式", "authentic", "genuine", "official"],
  ELECTRIC: ["충전기", "어댑터", "아답터", "멀티탭", "콘센트", "220v", "110v", "헤어드라이어", "헤어드라이기", "드라이기", "고데기", "전기히터", "히터", "전기장판", "가습기", "선풍기", "전기포트", "커피머신", "믹서기", "블렌더", "에어프라이어", "보조배터리", "led 조명", "무드등", "전동",
    "充电器", "适配器", "插座", "电吹风", "吹风机", "加湿器", "电热", "电暖", "充电宝", "台灯",
    "充電器", "アダプター", "ドライヤー", "電気ケトル", "モバイルバッテリー", "ヒーター",
    "charger", "adapter", "power supply", "hair dryer", "humidifier", "heater", "electric kettle", "power bank", "power strip"],
  WIRELESS: ["블루투스", "무선", "와이파이", "드론", "무전기", "bluetooth", "wireless", "wifi", "wi-fi", "drone", "蓝牙", "藍牙", "无线", "無線", "ワイヤレス", "ドローン"],
  CHILDREN: ["아동", "유아용", "키즈", "어린이", "장난감", "완구", "신생아", "아기용", "儿童", "兒童", "婴儿", "嬰兒", "玩具", "宝宝", "子供", "キッズ", "ベビー", "おもちゃ", "kids", "toddler", "toy"],
  FOOD: ["비타민", "영양제", "건강기능식품", "프로틴", "유산균", "프로바이오틱스", "오메가3", "콜라겐", "다이어트 보조", "효소", "과자", "사탕", "원두", "커피믹스", "드립백", "녹차", "홍차", "티백", "라면", "조미료",
    "保健品", "维生素", "維生素", "益生菌", "胶原蛋白", "零食", "糖果", "咖啡", "茶叶", "茶葉",
    "サプリ", "サプリメント", "ビタミン", "乳酸菌", "青汁", "お菓子", "コーヒー", "緑茶",
    "supplement", "vitamin", "probiotic", "protein powder", "gummies", "coffee beans", "tea bags"],
  BANNED: ["시부트라민", "sibutramine", "西布曲明", "페놀프탈레인", "phenolphthalein", "실데나필", "sildenafil", "西地那非", "타다라필", "tadalafil", "他达拉非",
    "요힘빈", "yohimbine", "育亨宾", "dmaa", "에페드라", "ephedra", "麻黄", "멜라토닌", "melatonin", "褪黑素", "メラトニン", "미녹시딜", "minoxidil", "米诺地尔", "ミノキシジル"],
  DRUG: ["의약품", "처방약", "진통제", "해열제", "감기약", "소염제", "药品", "藥品", "处方药", "感冒药", "医薬品", "第1類医薬品", "第2類医薬品", "指定第2類医薬品", "第3類医薬品", "風邪薬", "鎮痛剤", "otc drug", "prescription drug", "ibuprofen", "acetaminophen", "aspirin"],
  QUASI_DRUG: ["医薬部外品", "의약외품", "医药外品"],
  SEED: ["씨앗", "종자", "모종", "구근", "种子", "種子", "球根", "苗木", "seeds", "bulbs"],
  MEAT: ["육포", "소시지", "베이컨", "육가공", "牛肉干", "肉松", "香肠", "ジャーキー", "ソーセージ", "beef jerky", "sausage"],
  CANNABIS: ["cbd", "칸나비디올", "대마", "cannabidiol", "大麻", "thc", "カンナビジオール"],
  WEAPON: ["비비탄총", "에어소프트", "가스건", "전기충격기", "석궁", "도검", "玩具枪", "电击器", "弩", "エアガン", "スタンガン", "airsoft", "taser", "crossbow"],
  FIREWORKS: ["폭죽", "불꽃놀이", "烟花", "爆竹", "花火", "fireworks", "firecracker"],
  NICOTINE: ["전자담배", "니코틴", "电子烟", "尼古丁", "電子タバコ", "ニコチン", "e-cigarette", "vape", "nicotine"],
};

export const AREAS = { trademark: "상표·지재권", kc: "KC 인증", food_drug: "식품·의약품", customs: "통관·반입 제한", listing: "상품 페이지" };
export const SEVERITY_ORDER = { block: 3, review: 2, info: 1 };
