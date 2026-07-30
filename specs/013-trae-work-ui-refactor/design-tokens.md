# Design Token 定义

> **来源**: 从 [TRAE 概览页](https://docs.trae.cn/ide_trae-overview) 提取的 CSS 变量
> **版本**: v1.0 (2026-07-30)
> **状态**: 权威源,实施时复制到 `src/less/variable.less`

---

## 一、Token 分层架构

```
┌─────────────────────────────────────────────────────────┐
│ Layer 3: Tailwind 工具类 (tailwind.config.js)           │
│   bg-trae-ink, text-trae-grey, border-trae-line ...     │
└────────────────────────┬────────────────────────────────┘
                         │ var() 映射
┌────────────────────────▼────────────────────────────────┐
│ Layer 2: CSS 变量 (variable.less) ← 新权威源            │
│   --trae-ink, --trae-grey, --trae-line ...              │
└────────────────────────┬────────────────────────────────┘
                         │ 渐进替换
┌────────────────────────▼────────────────────────────────┐
│ Layer 1: Less 变量 (variable.less) ← @deprecated        │
│   @gray2, @gray3, @gray8 ... (旧代码兼容)               │
└─────────────────────────────────────────────────────────┘
```

**迁移原则**:
- Layer 2 是新权威源,所有新代码使用 `var(--trae-xxx)`
- Layer 1 保留但标记 `@deprecated`,旧代码渐进迁移
- Layer 3 通过 Tailwind `extend.colors` 映射,提供 `bg-trae-ink` 等工具类

---

## 二、完整 Token 清单

### 2.1 品牌色(Brand)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-green` | `#11C566` | 主品牌色(链接/激活/强调) |
| `--trae-green-dim` | `#0e9e52` | 次品牌色(标签/边框) |
| `--trae-green-bright` | `#32F08C` | 高亮品牌色(CTA 按钮背景) |
| `--trae-green-glow` | `rgba(17,197,102,.5)` | 品牌色发光阴影 |
| `--trae-green-soft` | `rgba(17,197,102,.12)` | 品牌色弱背景(径向渐变) |
| `--trae-green-tint` | `rgba(17,197,102,.06)` | 品牌色微背景(表头) |
| `--trae-green-border` | `rgba(20,178,104,.28)` | 品牌色边框(标签) |

### 2.2 中性色 — Light 主题

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-ink` | `#0d0f0e` | 主文本(标题/正文) |
| `--trae-ink-2` | `#f4f5f6` | 次背景(卡片悬停) |
| `--trae-grey` | `#3a403c` | 次文本(描述) |
| `--trae-grey-2` | `#5e655f` | 弱文本(元信息) |
| `--trae-line` | `rgba(0,0,0,.18)` | 分割线/弱边框 |
| `--trae-line-strong` | `rgba(0,0,0,.30)` | 强分割线/卡片边框 |
| `--trae-card-bg` | `transparent` | 卡片背景(默认透明) |
| `--trae-card-bg-hover` | `linear-gradient(180deg, rgba(255,255,255,.022), rgba(255,255,255,.004))` | 卡片悬停背景 |
| `--trae-nav-bg` | `rgba(255,255,255,.72)` | 导航栏背景(毛玻璃) |
| `--trae-surface` | `#ffffff` | 命令框/输入框背景 |

### 2.3 中性色 — Dark 主题

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-ink-dark` | `#ffffff` | 主文本(Dark) |
| `--trae-grey-dark` | `#ffffff` | 次文本(Dark,文档原值) |
| `--trae-grey-2-dark` | `#ffffff` | 弱文本(Dark,文档原值) |
| `--trae-line-dark` | `rgba(255,255,255,.18)` | 分割线(Dark) |
| `--trae-line-strong-dark` | `rgba(255,255,255,.30)` | 强分割线(Dark) |
| `--trae-nav-bg-dark` | `rgba(13,15,14,.72)` | 导航栏背景(Dark) |
| `--trae-surface-dark` | `#1a1d1c` | 命令框背景(Dark) |

> **注**: TRAE Work 文档中 `--grey`/`--grey-2` 在 Dark 主题下均为 `#fff`,实际使用时建议分层:
> - `--trae-grey-dark` → `#c8ccc9`(略暗于纯白,提升层次)
> - `--trae-grey-2-dark` → `#9aa09c`(更弱)
> 此为 AgentUI 实施时的微调,需在 Storybook 中验证。

### 2.4 字体(Font Family)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-font-body` | `'Inter', -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif` | 正文 |
| `--trae-font-display` | `'Outfit', 'Instrument Sans', -apple-system, "Microsoft YaHei", sans-serif` | 标题/Display |
| `--trae-font-mono` | `'JetBrains Mono', ui-monospace, monospace` | 代码/命令 |

> **注**: AgentUI 已内置 Inter 字体(见 [src/assets/inter/](../../src/assets/inter/)),`Outfit` 和 `JetBrains Mono` 需新增引入。

### 2.5 字号(Font Size)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-text-xs` | `12px` | 元信息/标签 |
| `--trae-text-sm` | `13px` | 次文本 |
| `--trae-text-sm-2` | `13.5px` | 导航/按钮 |
| `--trae-text-base` | `14px` | 正文 |
| `--trae-text-md` | `14.5px` | 卡片描述 |
| `--trae-text-lg` | `15px` | 引导文案 |
| `--trae-text-xl` | `16px` | 章节描述 |
| `--trae-text-2xl` | `22px` | 子标题 |
| `--trae-text-3xl` | `30px` | 卡片大标题 |
| `--trae-text-4xl` | `32px` | 产品名 |
| `--trae-text-5xl` | `46px` | 章节大标题 |

### 2.6 字重(Font Weight)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-font-normal` | `400` | 正文 |
| `--trae-font-medium` | `500` | 次强调 |
| `--trae-font-semibold` | `600` | 按钮/强调 |
| `--trae-font-bold` | `700` | 标题/Display |

### 2.7 行高(Line Height)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-leading-tight` | `1.1` | 大标题 |
| `--trae-leading-snug` | `1.6` | 列表项 |
| `--trae-leading-normal` | `1.7` | 正文 |
| `--trae-leading-relaxed` | `1.74` | 卡片描述 |
| `--trae-leading-loose` | `1.8` | 长描述 |
| `--trae-leading-2` | `1.85` | 引导文案 |
| `--trae-leading-display` | `1.02` | Hero 标题 |

### 2.8 字间距(Letter Spacing)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-tracking-tight` | `-.02em` | 大标题 |
| `--trae-tracking-normal` | `0` | 正文 |
| `--trae-tracking-wide` | `.02em` | 导航 |
| `--trae-tracking-wider` | `.04em` | 元信息 |
| `--trae-tracking-widest` | `.32em` | Eyebrow(大写) |

### 2.9 圆角(Border Radius)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-radius-xs` | `3px` | 小标签 |
| `--trae-radius-sm` | `6px` | 表单标签 |
| `--trae-radius-md` | `8px` | 按钮/命令框 |
| `--trae-radius-lg` | `10px` | CTA 按钮 |
| `--trae-radius-xl` | `12px` | 卡片(pick) |
| `--trae-radius-2xl` | `14px` | 卡片(feat) |
| `--trae-radius-3xl` | `16px` | 表格容器 |
| `--trae-radius-full` | `999px` | chip/胶囊 |

### 2.10 阴影(Box Shadow)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-shadow-none` | `0 0 0 rgba(50,240,140,0)` | 默认(无阴影) |
| `--trae-shadow-glow-sm` | `0 0 14px var(--trae-green)` | Logo 圆点发光 |
| `--trae-shadow-glow-md` | `0 0 16px rgba(17,197,102,.5)` | 分割线发光 |
| `--trae-shadow-cta-hover` | `0 10px 30px rgba(50,240,140,.28)` | CTA 按钮悬停 |
| `--trae-shadow-elev-1` | `0 4px 12px rgba(0,0,0,.06)` | 卡片浮起 |
| `--trae-shadow-elev-2` | `0 8px 24px rgba(0,0,0,.08)` | 弹层 |

### 2.11 间距(Spacing)

> 采用 4px 基线,与 Tailwind 默认对齐

| Token | 值 | Tailwind 对应 |
|-------|-----|---------------|
| `--trae-space-1` | `4px` | `1` |
| `--trae-space-2` | `8px` | `2` |
| `--trae-space-3` | `12px` | `3` |
| `--trae-space-4` | `16px` | `4` |
| `--trae-space-5` | `20px` | `5` |
| `--trae-space-6` | `24px` | `6` |
| `--trae-space-8` | `32px` | `8` |
| `--trae-space-10` | `40px` | `10` |
| `--trae-space-12` | `48px` | `12` |
| `--trae-space-16` | `64px` | `16` |
| `--trae-space-20` | `80px` | `20` |

### 2.12 过渡(Transition)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-transition-fast` | `.2s` | 快速(背景/边框) |
| `--trae-transition-base` | `.25s` | 基础(悬停/颜色) |
| `--trae-transition-slow` | `.3s` | 慢速(卡片浮起) |
| `--trae-transition-x-slow` | `.35s` | 极慢(径向渐变) |

### 2.13 模糊(Backdrop Filter)

| Token | 值 | 用途 |
|-------|-----|------|
| `--trae-blur-nav` | `blur(14px)` | 导航栏毛玻璃 |

---

## 三、CSS 变量定义(复制到 variable.less)

```less
// =============================================================================
// TRAE Work Design Tokens (权威源, 2026-07-30)
// 来源: https://docs.trae.cn/ide_trae-overview
// =============================================================================

:root {
  // ---- 品牌色 ----
  --trae-green: #11C566;
  --trae-green-dim: #0e9e52;
  --trae-green-bright: #32F08C;
  --trae-green-glow: rgba(17, 197, 102, .5);
  --trae-green-soft: rgba(17, 197, 102, .12);
  --trae-green-tint: rgba(17, 197, 102, .06);
  --trae-green-border: rgba(20, 178, 104, .28);

  // ---- 中性色 (Light) ----
  --trae-ink: #0d0f0e;
  --trae-ink-2: #f4f5f6;
  --trae-grey: #3a403c;
  --trae-grey-2: #5e655f;
  --trae-line: rgba(0, 0, 0, .18);
  --trae-line-strong: rgba(0, 0, 0, .30);
  --trae-card-bg: transparent;
  --trae-card-bg-hover: linear-gradient(180deg, rgba(255, 255, 255, .022), rgba(255, 255, 255, .004));
  --trae-nav-bg: rgba(255, 255, 255, .72);
  --trae-surface: #ffffff;

  // ---- 字体 ----
  --trae-font-body: 'Inter', -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --trae-font-display: 'Outfit', 'Instrument Sans', -apple-system, "Microsoft YaHei", sans-serif;
  --trae-font-mono: 'JetBrains Mono', ui-monospace, monospace;

  // ---- 字号 ----
  --trae-text-xs: 12px;
  --trae-text-sm: 13px;
  --trae-text-sm-2: 13.5px;
  --trae-text-base: 14px;
  --trae-text-md: 14.5px;
  --trae-text-lg: 15px;
  --trae-text-xl: 16px;
  --trae-text-2xl: 22px;
  --trae-text-3xl: 30px;
  --trae-text-4xl: 32px;
  --trae-text-5xl: 46px;

  // ---- 字重 ----
  --trae-font-normal: 400;
  --trae-font-medium: 500;
  --trae-font-semibold: 600;
  --trae-font-bold: 700;

  // ---- 行高 ----
  --trae-leading-tight: 1.1;
  --trae-leading-snug: 1.6;
  --trae-leading-normal: 1.7;
  --trae-leading-relaxed: 1.74;
  --trae-leading-loose: 1.8;
  --trae-leading-2: 1.85;
  --trae-leading-display: 1.02;

  // ---- 字间距 ----
  --trae-tracking-tight: -.02em;
  --trae-tracking-normal: 0;
  --trae-tracking-wide: .02em;
  --trae-tracking-wider: .04em;
  --trae-tracking-widest: .32em;

  // ---- 圆角 ----
  --trae-radius-xs: 3px;
  --trae-radius-sm: 6px;
  --trae-radius-md: 8px;
  --trae-radius-lg: 10px;
  --trae-radius-xl: 12px;
  --trae-radius-2xl: 14px;
  --trae-radius-3xl: 16px;
  --trae-radius-full: 999px;

  // ---- 阴影 ----
  --trae-shadow-none: 0 0 0 rgba(50, 240, 140, 0);
  --trae-shadow-glow-sm: 0 0 14px var(--trae-green);
  --trae-shadow-glow-md: 0 0 16px rgba(17, 197, 102, .5);
  --trae-shadow-cta-hover: 0 10px 30px rgba(50, 240, 140, .28);
  --trae-shadow-elev-1: 0 4px 12px rgba(0, 0, 0, .06);
  --trae-shadow-elev-2: 0 8px 24px rgba(0, 0, 0, .08);

  // ---- 间距 ----
  --trae-space-1: 4px;
  --trae-space-2: 8px;
  --trae-space-3: 12px;
  --trae-space-4: 16px;
  --trae-space-5: 20px;
  --trae-space-6: 24px;
  --trae-space-8: 32px;
  --trae-space-10: 40px;
  --trae-space-12: 48px;
  --trae-space-16: 64px;
  --trae-space-20: 80px;

  // ---- 过渡 ----
  --trae-transition-fast: .2s;
  --trae-transition-base: .25s;
  --trae-transition-slow: .3s;
  --trae-transition-x-slow: .35s;

  // ---- 模糊 ----
  --trae-blur-nav: blur(14px);
}

// =============================================================================
// Dark 主题覆盖
// =============================================================================

.dark {
  --trae-ink: #ffffff;
  --trae-ink-2: #1a1d1c;      // AgentUI 补充覆盖(Light 为 #f4f5f6 次背景,Dark 需为深色)
  --trae-grey: #c8ccc9;       // AgentUI 微调(文档原值 #fff)
  --trae-grey-2: #9aa09c;     // AgentUI 微调(文档原值 #fff)
  --trae-line: rgba(255, 255, 255, .18);
  --trae-line-strong: rgba(255, 255, 255, .30);
  --trae-nav-bg: rgba(13, 15, 14, .72);
  --trae-surface: #1a1d1c;
  --trae-card-bg-hover: linear-gradient(180deg, rgba(255, 255, 255, .022), rgba(255, 255, 255, .004));
}

// =============================================================================
// 旧 Less 变量 (@deprecated, 向后兼容, 新代码勿用)
// =============================================================================

@fontWeight600: 600;
@fontWeight700: 700;

@grayBackground: rgba(247, 248, 250, 0.1);   // @deprecated → var(--trae-card-bg-hover)
@gray2: rgba(29, 25, 41, 1);                  // @deprecated → var(--trae-ink)
@gray3: rgba(52, 48, 62, 1);                  // @deprecated → var(--trae-grey)
@gray8: rgba(165, 163, 169, 1);               // @deprecated → var(--trae-grey-2)
@gray11: rgba(232, 232, 234, 1);              // @deprecated → var(--trae-ink-2)
@purple: rgba(127, 86, 217, 1);               // @deprecated → var(--trae-green)
@selectedBackgroundColor: rgba(239, 248, 255, 1); // @deprecated → var(--trae-green-tint)
@blurBackground: rgba(22, 119, 255, 0.5);     // @deprecated → var(--trae-green-glow)
@blurBackgroundHover: rgba(22, 119, 255, 0.2); // @deprecated → var(--trae-green-soft)

@fontSize12: 12px;  // @deprecated → var(--trae-text-xs)
@fontSize14: 14px;  // @deprecated → var(--trae-text-base)
@fontSize16: 16px;  // @deprecated → var(--trae-text-xl)
@fontSize18: 18px;  // @deprecated → (无直接映射, 用 1.125rem)
```

---

## 四、Tailwind 映射(tailwind.config.js 扩展)

```javascript
// tailwind.config.js extend.colors 追加
module.exports = {
  // ...
  theme: {
    extend: {
      colors: {
        // ... 现有颜色保留 ...

        // TRAE Work Token 映射(新增)
        trae: {
          green: {
            DEFAULT: 'var(--trae-green)',
            dim: 'var(--trae-green-dim)',
            bright: 'var(--trae-green-bright)',
            glow: 'var(--trae-green-glow)',
            soft: 'var(--trae-green-soft)',
            tint: 'var(--trae-green-tint)',
            border: 'var(--trae-green-border)',
          },
          ink: {
            DEFAULT: 'var(--trae-ink)',
            2: 'var(--trae-ink-2)',
          },
          grey: {
            DEFAULT: 'var(--trae-grey)',
            2: 'var(--trae-grey-2)',
          },
          line: {
            DEFAULT: 'var(--trae-line)',
            strong: 'var(--trae-line-strong)',
          },
          card: 'var(--trae-card-bg)',
          nav: 'var(--trae-nav-bg)',
          surface: 'var(--trae-surface)',
        },
      },
      fontFamily: {
        // ... 现有保留 ...
        display: ['var(--trae-font-display)', ...fontFamily.sans],
        mono: ['var(--trae-font-mono)', ...fontFamily.mono],
      },
      fontSize: {
        'trae-xs': ['var(--trae-text-xs)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-sm': ['var(--trae-text-sm)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-sm-2': ['var(--trae-text-sm-2)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-base': ['var(--trae-text-base)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-md': ['var(--trae-text-md)', { lineHeight: 'var(--trae-leading-relaxed)' }],
        'trae-lg': ['var(--trae-text-lg)', { lineHeight: 'var(--trae-leading-2)' }],
        'trae-xl': ['var(--trae-text-xl)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-2xl': ['var(--trae-text-2xl)', { lineHeight: 'var(--trae-leading-snug)' }],
        'trae-3xl': ['var(--trae-text-3xl)', { lineHeight: 'var(--trae-leading-tight)' }],
        'trae-4xl': ['var(--trae-text-4xl)', { lineHeight: 'var(--trae-leading-tight)' }],
        'trae-5xl': ['var(--trae-text-5xl)', { lineHeight: 'var(--trae-leading-tight)' }],
      },
      borderRadius: {
        'trae-xs': 'var(--trae-radius-xs)',
        'trae-sm': 'var(--trae-radius-sm)',
        'trae-md': 'var(--trae-radius-md)',
        'trae-lg': 'var(--trae-radius-lg)',
        'trae-xl': 'var(--trae-radius-xl)',
        'trae-2xl': 'var(--trae-radius-2xl)',
        'trae-3xl': 'var(--trae-radius-3xl)',
        'trae-full': 'var(--trae-radius-full)',
      },
      boxShadow: {
        'trae-glow-sm': 'var(--trae-shadow-glow-sm)',
        'trae-glow-md': 'var(--trae-shadow-glow-md)',
        'trae-cta-hover': 'var(--trae-shadow-cta-hover)',
        'trae-elev-1': 'var(--trae-shadow-elev-1)',
        'trae-elev-2': 'var(--trae-shadow-elev-2)',
      },
      transitionDuration: {
        'trae-fast': 'var(--trae-transition-fast)',
        'trae-base': 'var(--trae-transition-base)',
        'trae-slow': 'var(--trae-transition-slow)',
        'trae-x-slow': 'var(--trae-transition-x-slow)',
      },
      backdropBlur: {
        'trae-nav': 'var(--trae-blur-nav)',
      },
      letterSpacing: {
        'trae-tight': 'var(--trae-tracking-tight)',
        'trae-wide': 'var(--trae-tracking-wide)',
        'trae-wider': 'var(--trae-tracking-wider)',
        'trae-widest': 'var(--trae-tracking-widest)',
      },
    },
  },
};
```

---

## 五、字体加载

需新增引入 `Outfit` 和 `JetBrains Mono` 字体(Inter 已有)。

### 5.1 字体文件

| 字体 | 来源 | 用途 |
|------|------|------|
| Inter | 已有 [src/assets/inter/](../../src/assets/inter/) | 正文 |
| Outfit | Google Fonts | 标题/Display |
| JetBrains Mono | Google Fonts | 代码/命令 |

### 5.2 引入方式

**推荐**: 通过 `@fontsource` 包引入(离线友好,无 CDN 依赖)

```bash
npm install @fontsource/outfit @fontsource/jetbrains-mono
```

在 [src/global.less](../../src/global.less) 顶部引入(与现有 `inter.less` 引入方式一致):

```less
@import '@fontsource/outfit/latin-400.css';
@import '@fontsource/outfit/latin-500.css';
@import '@fontsource/outfit/latin-600.css';
@import '@fontsource/outfit/latin-700.css';
@import '@fontsource/jetbrains-mono/latin-400.css';
@import '@fontsource/jetbrains-mono/latin-500.css';
@import '@fontsource/jetbrains-mono/latin-600.css';
@import '@fontsource/jetbrains-mono/latin-700.css';
```

> 注:使用 `latin-*` 子集包,避免加载完整字符集(按 design-tokens.md §3.1 仅需 latin 子集 + 4 个字重)。

### 5.3 字体 fallback

`--trae-font-display` 和 `--trae-font-mono` 已包含 fallback,字体未加载时降级到系统字体。

---

## 六、主题切换

### 6.1 现有主题机制

AgentUI 已有 `ThemeProvider`(见 [src/components/theme-provider.tsx](../../src/components/theme-provider.tsx)),通过 `class="dark"` 切换 Dark 主题。

### 6.2 Token 主题切换

TRAE Work Token 通过 `.dark` 选择器覆盖,与现有机制兼容:

```less
:root { /* Light 默认 */ }
.dark { /* Dark 覆盖 */ }
```

**无需新增 Provider**,现有 `ThemeProvider` 自动生效。

---

## 七、验收清单

- [ ] `variable.less` 含完整 TRAE Work Token(Light + Dark)
- [ ] 旧 Less 变量标记 `@deprecated` 但保留
- [ ] `tailwind.config.js` 映射新 Token 到工具类
- [ ] `Outfit` 和 `JetBrains Mono` 字体可加载
- [ ] Light/Dark 主题切换正常
- [ ] 现有页面视觉无破坏(手动验证)
