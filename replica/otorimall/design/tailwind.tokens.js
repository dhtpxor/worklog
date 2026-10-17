// tailwind.config.js 의 theme.extend 에 넣는 매핑. 컴포넌트는 bg-surface text-muted 처럼 역할 이름만 쓴다.
module.exports = {
  colors: {
    bg: "var(--bg)", surface: "var(--surface)", raised: "var(--surface-raised)",
    border: "var(--border)", "border-input": "var(--border-input)",
    text: "var(--text)", muted: "var(--text-muted)", accent: "var(--accent)", "on-accent": "var(--on-accent)",
    ink: "var(--ink)", "on-ink": "var(--on-ink)", danger: "var(--danger)", success: "var(--success)", warning: "var(--warning)",
  },
  fontFamily: { sans: ["Paperlogy", "Apple SD Gothic Neo", "Malgun Gothic", "system-ui", "sans-serif"] },
  fontSize: { xs: ["12px", { lineHeight: "16px", fontWeight: 500 }], sm: ["13px", "18px"], base: ["15px", "22px"],
    md: ["16px", { lineHeight: "24px", fontWeight: 600 }], lg: ["20px", { lineHeight: "28px", fontWeight: 600 }],
    xl: ["26px", { lineHeight: "32px", fontWeight: 800 }], display: ["40px", { lineHeight: "44px", fontWeight: 800 }] },
  spacing: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 7: "32px", 8: "48px", 9: "64px" },
  borderRadius: { none: "0", sm: "4px", md: "8px", sheet: "16px", pill: "999px" },
  boxShadow: { sheet: "var(--shadow-sheet)", drawer: "var(--shadow-drawer)" },
  maxWidth: { page: "1180px" },
};
