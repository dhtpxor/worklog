// src/rules/brands.js — 상표·캐릭터 사전 (시드). 완전한 목록이 아니며, 없는 상표는 키프리스 조회가 필요하다.
// aliases: 영문(소문자)·한글·일본어·중국어(간체/번체). 흔한 일반 단어와 겹치는 별칭은 넣지 않는다
// (예: "supreme", "애플", "lv", "어그", "원피스"). exclude: 이 표현이 함께 있으면 상표 언급으로 보지 않는다.

export const BRANDS = [
  { id: "nike", name: "Nike", kind: "brand", aliases: ["nike", "나이키", "ナイキ", "耐克"] },
  { id: "adidas", name: "adidas", kind: "brand", aliases: ["adidas", "아디다스", "アディダス", "阿迪达斯", "愛迪達"] },
  { id: "new_balance", name: "New Balance", kind: "brand", aliases: ["new balance", "newbalance", "뉴발란스", "ニューバランス", "新百伦", "紐巴倫"] },
  { id: "chanel", name: "Chanel", kind: "brand", aliases: ["chanel", "샤넬", "シャネル", "香奈儿", "香奈兒"] },
  { id: "louis_vuitton", name: "Louis Vuitton", kind: "brand", aliases: ["louis vuitton", "루이비통", "루이뷔통", "ルイヴィトン", "ルイ・ヴィトン", "路易威登"] },
  { id: "gucci", name: "Gucci", kind: "brand", aliases: ["gucci", "구찌", "グッチ", "古驰", "古馳"] },
  { id: "hermes", name: "Hermès", kind: "brand", aliases: ["hermes", "hermès", "에르메스", "エルメス", "爱马仕", "愛馬仕"] },
  { id: "prada", name: "Prada", kind: "brand", aliases: ["prada", "프라다", "プラダ", "普拉达"] },
  { id: "dior", name: "Dior", kind: "brand", aliases: ["dior", "디올", "ディオール", "迪奥"] },
  { id: "balenciaga", name: "Balenciaga", kind: "brand", aliases: ["balenciaga", "발렌시아가", "バレンシアガ", "巴黎世家"] },
  { id: "rolex", name: "Rolex", kind: "brand", aliases: ["rolex", "롤렉스", "ロレックス", "劳力士", "勞力士"] },
  { id: "cartier", name: "Cartier", kind: "brand", aliases: ["cartier", "까르띠에", "カルティエ", "卡地亚"] },
  { id: "burberry", name: "Burberry", kind: "brand", aliases: ["burberry", "버버리", "バーバリー", "博柏利"] },
  { id: "moncler", name: "Moncler", kind: "brand", aliases: ["moncler", "몽클레르", "몽클레어", "モンクレール", "盟可睐"] },
  { id: "the_north_face", name: "The North Face", kind: "brand", aliases: ["the north face", "northface", "노스페이스", "ノースフェイス"] },
  { id: "arcteryx", name: "Arc'teryx", kind: "brand", aliases: ["arc'teryx", "arcteryx", "아크테릭스", "アークテリクス", "始祖鸟", "始祖鳥"] },
  { id: "stone_island", name: "Stone Island", kind: "brand", aliases: ["stone island", "스톤아일랜드", "ストーンアイランド", "石头岛"] },
  { id: "crocs", name: "Crocs", kind: "brand", aliases: ["crocs", "크록스", "クロックス", "卡骆驰", "jibbitz", "지비츠"] },
  { id: "apple", name: "Apple", kind: "brand", aliases: ["iphone", "아이폰", "airpods", "에어팟", "macbook", "맥북", "ipad", "아이패드", "apple watch", "애플워치", "苹果手机", "アイフォン"] },
  { id: "samsung", name: "Samsung", kind: "brand", aliases: ["samsung", "삼성", "三星", "サムスン", "갤럭시 버즈", "galaxy buds"] },
  { id: "sony", name: "Sony", kind: "brand", aliases: ["sony", "소니", "ソニー", "索尼"] },
  { id: "dyson", name: "Dyson", kind: "brand", aliases: ["dyson", "다이슨", "ダイソン", "戴森"] },
  { id: "lego", name: "LEGO", kind: "brand", aliases: ["lego", "레고", "レゴ", "乐高", "樂高"] },
  { id: "disney", name: "Disney", kind: "character", aliases: ["disney", "디즈니", "ディズニー", "迪士尼", "mickey mouse", "미키마우스", "ミッキーマウス", "米奇"] },
  { id: "pokemon", name: "Pokémon", kind: "character", aliases: ["pokemon", "pokémon", "포켓몬", "ポケモン", "宝可梦", "寶可夢", "pikachu", "피카추", "ピカチュウ", "皮卡丘"] },
  { id: "sanrio", name: "Sanrio", kind: "character", aliases: ["sanrio", "산리오", "サンリオ", "三丽鸥", "hello kitty", "헬로키티", "ハローキティ", "凯蒂猫", "쿠로미", "クロミ", "库洛米", "시나모롤", "シナモロール", "玉桂狗", "마이멜로디", "マイメロディ", "美乐蒂"] },
  { id: "marvel", name: "Marvel", kind: "character", aliases: ["marvel", "마블", "マーベル", "漫威"] },
  { id: "shinchan", name: "크레용 신짱(짱구)", kind: "character", aliases: ["짱구는 못말려", "짱구", "クレヨンしんちゃん", "蜡笔小新", "蠟筆小新"] },
  { id: "chiikawa", name: "Chiikawa", kind: "character", aliases: ["chiikawa", "치이카와", "ちいかわ", "吉伊卡哇"] },
  { id: "labubu", name: "Labubu (Pop Mart)", kind: "character", aliases: ["labubu", "라부부", "ラブブ", "拉布布", "pop mart", "팝마트", "泡泡玛特"] },
];

// 상표를 "호환 대상"으로만 쓰는 표현 (예: "아이폰 15 호환 케이스"). 기술적 사용은 허용될 수 있으나 오인 표현은 안 된다.
export const COMPAT_MARKERS = ["호환", "전용", "용 케이스", "for ", "适用", "适配", "兼容", "対応", "用ケース", "compatible"];
