# Floating Button Icon Design Brief

## Product Context

**TapWord Translator** is a browser extension that provides AI-powered translation for web pages. Users can:
- Select text to get word/phrase translations
- Enable full-page translation with one click

The **floating button** is a persistent UI element docked to the right edge of the browser viewport. It serves as the main trigger for full-page translation — users click it to start/stop translating the current page.

## Design Scope

Design an **SVG icon** to serve as the visual identity of this floating button.

### Constraints

| Property | Value |
|----------|-------|
| Format | SVG |
| Viewbox | 28 × 28 |
| Shape | Circular (the icon IS the button — no border or background behind it) |
| Required element | The letter **"T"** (representing Translation / TapWord) |
| Brand color | Pink series — primary `#ED6D8F`, open to variations |
| Icon fill color | White for foreground elements against the pink background |
| Usage context | Sits at the right edge, partially hidden when idle, fully visible on hover |
| Button dimensions | Rendered at approximately 32 × 32 CSS pixels on screen |

### Design Goals

- **Recognizable at small size** — must read clearly at 32px
- **Distinctive** — should feel like a brand mark, not a generic translate icon
- **Friendly** — approachable, not corporate
- **Minimal** — avoid clutter; the icon should work with 2-3 visual elements maximum

### Deliverable

Provide **5 different design variations** as standalone HTML files. Each should render the icon at actual size (32px) with a 4× enlarged preview beside it for detail inspection.

Example HTML structure:
```html
<!DOCTYPE html>
<html>
<body style="padding: 40px; background: #f5f5f5; display: flex; gap: 40px; align-items: center;">
    <!-- Actual size -->
    <div style="width: 32px; height: 32px;">
        <svg viewBox="0 0 28 28" ...><!-- icon here --></svg>
    </div>
    <!-- 4× preview -->
    <div style="width: 128px; height: 128px;">
        <svg viewBox="0 0 28 28" ...><!-- same icon --></svg>
    </div>
</body>
</html>
```
