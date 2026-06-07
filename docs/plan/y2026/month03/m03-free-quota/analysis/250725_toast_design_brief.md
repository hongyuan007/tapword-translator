# Global Toast Notification System — Design Brief

> **Document Type:** Visual Design Requirements  
> **Target Audience:** UI Designer / AI Design Agent  
> **Date:** 2026-03-22  
> **Product:** TapWord Translator — Chrome Browser Extension  

---

## A. Context & Purpose

TapWord Translator is a Chrome browser extension that provides AI-powered, context-aware translations for selected text on web pages. This design brief describes a **global toast notification component** used across the extension to deliver brief, user-facing messages.

### Key Constraints

| Constraint | Detail |
|---|---|
| **Environment** | Content scripts injected into arbitrary third-party web pages |
| **Style Isolation** | Must use inline styles or Shadow DOM CSS — **cannot** rely on host page stylesheets |
| **Visual Safety** | Must look correct and readable on **any** website background (light, dark, colorful, image-heavy) |
| **z-index** | Must float above all page content; use `2147483647` range |
| **No Layout Impact** | Must not shift or reflow the host page's content |
| **i18n** | Must support internationalized strings (variable message lengths) |

### Primary Use Cases

- **Quota exhaustion alerts** — "Today's free translation quota has been used up"
- **Error messages** — "Translation failed, please try again"
- **Success confirmations** — "Translation complete"
- **Status updates** — "Translation started"
- **Caution warnings** — "Quota running low"

---

## B. Toast Types & Use Cases

| Type | Icon | Example Messages | Typical Duration |
|---|---|---|---|
| **Info** | ℹ️ (circle-i) | "Translation started", "Feature enabled" | 3–5 s |
| **Success** | ✅ (checkmark) | "Translation complete", "Copied to clipboard" | 3 s |
| **Warning** | ⚠️ (triangle) | "Quota running low (10% left)", "Slow network" | 5–7 s |
| **Error** | ❌ (cross) | "Translation failed", "Network error" | 5–7 s |
| **Quota Exhausted** | 🚫 (no-entry) | "Today's free quota is used up" | 7–10 s |

> **Quota Exhausted** is a special variant of Warning/Info. It should feel more prominent (slightly larger or with a CTA link) but not alarming like an error.

---

## C. Layout & Positioning Requirements

### Positioning

```
┌─────────────────────────────────────────────────────────┐
│  Browser Viewport                                       │
│                                                         │
│        ┌────────────────────────────────┐   ← 16–20px   │
│        │  ⚠️  Quota running low (10%)  │   from top     │
│        └────────────────────────────────┘                │
│                                                         │
│        ┌────────────────────────────────┐   ← stacked   │
│        │  ✅  Translation complete      │   below       │
│        └────────────────────────────────┘                │
│                                                         │
│                   (page content)                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Dimensions

| Property | Value |
|---|---|
| Position | `fixed`, top center of viewport |
| Top offset | `16–20px` from viewport top |
| Width | Auto-fit content; **min ~300px**, **max ~480px** |
| Padding | `12–16px` vertical, `16–24px` horizontal |
| Border radius | `12px` (matches extension card radius) |
| Horizontal centering | `left: 50%; transform: translateX(-50%)` |

### Stacking Behavior

When multiple toasts are active, they stack vertically with an `8px` gap between each. The newest toast appears at the top, pushing older ones down.

### Dismissal

- **Auto-dismiss** after a configurable duration (default: 5 seconds)
- **Manual dismiss** via a close button (×) on the right side
- Clicking the toast body itself does NOT dismiss (prevents accidental dismissal)

---

## D. Visual Style Requirements

### Overall Aesthetic

- **Clean, modern, minimal** — consistent with the extension's popup and options page
- A slight **frosted glass / glassmorphism** effect (semi-transparent background with backdrop-blur) OR a **solid opaque** background — both options are acceptable; the designer should choose which reads best on varied page backgrounds
- Subtle **drop shadow** for depth and separation from page content

### Anatomy

```
┌─────────────────────────────────────────────────────┐
│                                                   ✕ │
│   🔶   Title message goes here                      │
│        Optional secondary detail text               │
│                                                     │
└─────────────────────────────────────────────────────┘

  ↑       ↑                                         ↑
 Icon   Text area (title + subtitle)          Close btn
```

**Detailed ASCII mockup — Single-line toast:**

```
╭──────────────────────────────────────────────╮
│  ⚠️   Quota running low — 10% remaining   ✕ │
╰──────────────────────────────────────────────╯
```

**Detailed ASCII mockup — Two-line toast (Quota Exhausted):**

```
╭────────────────────────────────────────────────────╮
│  🚫  Today's free quota is used up               ✕ │
│       Upgrade your plan for unlimited access        │
╰────────────────────────────────────────────────────╯
```

### Component Breakdown

| Element | Description |
|---|---|
| **Container** | Rounded rectangle, shadow, optional blur background |
| **Type Icon** | Left-aligned, 20×20px, type-specific color |
| **Title Text** | Primary message, 14px, font-weight 500 |
| **Subtitle Text** | Optional secondary line, 12px, lighter color, font-weight 400 |
| **Close Button** | Right-aligned `×`, 14×14px hit area 28×28px, subtle on hover |
| **Accent Indicator** | Optional left border (3–4px) in type-specific color, OR icon color alone |

### Background Strategy (Must Read on ANY Page)

Two viable approaches — designer picks one:

1. **Solid white with high shadow** — `background: #ffffff`, `box-shadow: 0 8px 32px rgba(0,0,0,0.12)`, `border: 1px solid rgba(0,0,0,0.06)`. Works on dark pages; shadow lifts it.
2. **Frosted glass** — `background: rgba(255,255,255,0.88)`, `backdrop-filter: blur(16px)`, `border: 1px solid rgba(255,255,255,0.3)`. Looks premium but requires backdrop-filter support (Chrome ≥76, fully supported).

> **Recommendation:** Solid white (Option 1) for maximum compatibility and readability. Reserve glass effect for a potential dark-mode variant.

---

## E. Color Scheme

### Extension's Existing Color Palette

Extracted from the extension's CSS files (`popup.css`, `styles.css`, `modal.css`):

| Token | Value | Usage |
|---|---|---|
| **Primary Blue** | `#2484E0` / `#1F7FDB` | Links, active states, primary buttons |
| **Text Primary** | `#1f2937` / `rgba(30,30,30,1)` | Main body text |
| **Text Secondary** | `#6b7280` / `rgba(30,30,30,0.55)` | Helper text, labels |
| **Background** | `#f5f6f8` | Page background |
| **Card White** | `#ffffff` | Cards, panels |
| **Border** | `#e5e7eb` | Dividers, card borders |
| **Success Green** | `#34C759` | Success states, active badges |
| **Warning Orange** | `#FF9500` | Warning states |
| **Error Red** | `#FF3B30` / `#EF4444` | Error states, destructive actions |
| **Pink Accent** | `#f472b6` / `#f789c0` | Master toggle active state |

### Toast Type Accent Colors

| Toast Type | Accent Color | Background Tint (optional) | Icon Color |
|---|---|---|---|
| **Info** | `#2484E0` (Primary Blue) | `rgba(36, 132, 224, 0.06)` | `#2484E0` |
| **Success** | `#34C759` (Green) | `rgba(52, 199, 89, 0.06)` | `#34C759` |
| **Warning** | `#FF9500` (Orange) | `rgba(255, 149, 0, 0.06)` | `#E08600` |
| **Error** | `#FF3B30` (Red) | `rgba(255, 59, 48, 0.06)` | `#FF3B30` |
| **Quota Exhausted** | `#6b7280` (Gray) | `rgba(107, 114, 128, 0.06)` | `#6b7280` |

### Accent Application

The accent color can be applied as one or more of:

- A **left border strip** (3–4px solid, full height of toast)
- The **icon fill/stroke color**
- A **subtle background tint** mixed into the white base

---

## F. Typography

### Font Stack

```css
font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

This matches the extension's existing font stack used in popup, options page, and translation modal.

### Text Sizing

| Element | Size | Weight | Color | Line Height |
|---|---|---|---|---|
| **Title** | `14px` | `500` (medium) | `#1f2937` | `1.5` |
| **Subtitle** | `12px` | `400` (regular) | `#6b7280` | `1.4` |
| **Close Button** | `14px` | `300` (light) | `#9ca3af` → `#6b7280` on hover | — |

### Text Behavior

- Single-line titles should NOT wrap (use `text-overflow: ellipsis` at max-width)
- Subtitle text may wrap to 2 lines maximum
- All text must use `-webkit-font-smoothing: antialiased` for consistency

---

## G. Animations

### Entry Animation (Slide In)

```
State: Hidden                    State: Visible
─────────────                    ─────────────
opacity: 0                  →    opacity: 1
translateY(-20px)            →    translateY(0)
duration: 300ms
easing: cubic-bezier(0.34, 1.56, 0.64, 1)  ← slight overshoot/bounce
```

### Exit Animation (Slide Out)

```
State: Visible                   State: Hidden
─────────────                    ─────────────
opacity: 1                  →    opacity: 0
translateY(0)                →    translateY(-20px)
duration: 200ms
easing: ease-out
```

### Timing Summary

| Animation | Duration | Easing | Trigger |
|---|---|---|---|
| **Entry** | `300ms` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Toast created |
| **Exit** | `200ms` | `ease-out` | Auto-dismiss or close click |
| **Hover (close btn)** | `150ms` | `ease` | Mouse hover on × |

### Progress Bar (Optional)

A thin (2px) progress bar at the bottom of the toast that shrinks from 100% to 0% over the auto-dismiss duration. Provides visual feedback about remaining display time. Color matches the type's accent color with reduced opacity.

---

## H. Technical Constraints

| Constraint | Requirement |
|---|---|
| **Style Isolation** | All styles must be applied via inline `style` attributes OR within a Shadow DOM `<style>` tag. No external CSS class dependencies. |
| **z-index** | `2147483647` (maximum 32-bit integer) to guarantee visibility above all page content |
| **Container** | Appended to `document.body` directly, NOT inside any page element |
| **No Layout Shift** | `position: fixed` only; never `relative` or `absolute` on body |
| **Browser Support** | Chrome 88+ (Manifest V3 minimum) |
| **Shadow DOM** | Optional; inline styles are acceptable for simplicity |
| **i18n Support** | Text content is provided programmatically; layout must accommodate variable-length strings across languages (CJK, Latin, RTL future consideration) |
| **Multiple Instances** | Must support 1–3 simultaneous toasts stacked vertically |
| **Print** | Toasts should be hidden via `@media print { display: none }` |

---

## I. Reference Examples

### Similar Systems for Inspiration

| System | What to Borrow |
|---|---|
| **Vercel / Next.js Toasts** (`sonner` library) | Clean minimal design, stacking behavior, progress indicator |
| **macOS Notification Center** | Rounded cards, frosted glass, slide-in from top |
| **VS Code Notifications** | Bottom-right positioning (we use top-center instead), info/warning/error coloring |
| **Stripe Dashboard Toasts** | Left color accent bar, icon + text layout, auto-dismiss |
| **Linear App Toasts** | Minimal, solid background, subtle shadow, quick animations |
| **Apple HIG Alerts** | SF-style icons, system font, restrained color usage |

### Closest Match: Sonner (by Emil Kowalski)

Sonner is the closest reference to the desired aesthetic:
- Position: Top center
- Style: Clean white card, subtle shadow, icon on left
- Animation: Smooth slide-down with slight spring
- Stacking: Multiple toasts stack with gap
- Dismiss: Auto + click close

> **Reference URL:** https://sonner.emilkowal.ski/

---

## J. Existing Implementation Reference

The extension currently has two toast implementations that this new system will **replace and unify**:

### 1. Shadow DOM Toast (`showToast`)
- **File:** `src/1_content/ui/toastNotification.ts` + `src/1_content/resources/modal.css`
- **Style:** Dark pill-shaped capsule, gradient backgrounds, CSS class-based
- **Position:** Inside shadow root (relative to translation modal)
- **Duration:** 2.5s

### 2. Viewport Toast (`showViewportToast`)
- **File:** `src/1_content/ui/toastNotification.ts`
- **Style:** Gradient pill, inline styles, white text on colored background
- **Position:** Fixed viewport top center
- **Duration:** 5s

### 3. Popup Toast (`showToast` in popup)
- **File:** `src/3_popup/modules/toastManager.ts`
- **Style:** Gradient pill, inline styles, narrower (popup width)
- **Duration:** 3s

### What Changes

The new system should provide a **single, consistent toast visual** that works in all three contexts (content page, popup, options). The gradient-pill style will be replaced with the cleaner card-based design described in this brief.

---

## K. Deliverables Checklist

The designer should produce:

- [ ] **Visual mockups** for all 5 toast types (Info, Success, Warning, Error, Quota Exhausted)
- [ ] **Single-line** and **two-line** variants
- [ ] **Light background** page context mockup
- [ ] **Dark background** page context mockup
- [ ] **Stacked state** (2–3 toasts visible simultaneously)
- [ ] **Close button hover state**
- [ ] **Entry/exit animation storyboard** (3–4 keyframes)
- [ ] **Color and spacing spec** (annotated measurements)
- [ ] **Optional:** Progress bar variant

---

*End of Design Brief*
