# Bug Report: Text Duplication on Twitter "Show More" Expansion

## 1. Problem Description

### Symptoms
When a user translates a tweet on Twitter (X.com) that has been truncated with a "Show more" button:
1. The user translates the visible portion of the tweet.
2. The user clicks "Show more" to expand the full tweet.
3. **Result:** The original text appears twice.
    - The first instance is the old, truncated text with the translation styles (underline/tooltip) still applied.
    - The second instance is the new, full text appended immediately after the first instance.
    - The layout is broken, often with the old translation overlaying the new text or causing visual glitches.

### Reproduction Steps
1. Find a long tweet on Twitter that has a "Show more" button.
2. Select text within the visible part of the tweet and trigger a translation (or use double-click translation).
3. Click the "Show more" button.
4. Observe that the original text is duplicated.

---

## 2. Root Cause Analysis

### The Conflict: DOM Intrusion vs. React Reconciliation

Twitter is a Single Page Application (SPA) built with React (specifically `react-native-web`). The core issue stems from the conflict between how the extension modifies the DOM and how React expects the DOM to be.

1.  **Initial State (React's View)**:
    - React's Virtual DOM has a component with a simple text node: `"Alright interns..."`.
    - The real DOM matches this: `<div>Alright interns...</div>`.

2.  **Extension Intrusion**:
    - When the user translates, the extension modifies the **Real DOM** to add styles and tooltips.
    - The text node is split and wrapped: `<div><span class="tapword-anchor">Alright interns...</span></div>`.
    - **Crucial Point**: React's Virtual DOM is *unaware* of this change. The Real DOM and Virtual DOM are now desynchronized.

3.  **State Update (The Trigger)**:
    - User clicks "Show more".
    - Twitter's React application triggers a state update to show the full text.
    - React enters the **Reconciliation** phase. It expects to find the original text node `"Alright interns..."` to replace it with the full text.

4.  **Reconciliation Failure**:
    - React looks at the Real DOM and cannot find the text node it expects (because we replaced it with a `<span>`).
    - React's Diff algorithm detects a mismatch or "node missing" error.
    - **Fallback Behavior**: Instead of crashing, React often adopts a safe fallback strategy for text updates: if it can't cleanly update the existing node, it **appends the new text node** to the container.

5.  **The Result**:
    - The extension's modified DOM (the truncated text with translation) remains untouched (orphaned).
    - React appends the new, full text immediately after it.
    - The user sees both versions.

---

## 3. Proposed Solutions

### Solution D: Targeted Reactive Cleanup (Recommended)

Since we cannot prevent React from failing reconciliation if the DOM is dirty, we must **detect** when React attempts to update the text and clean up our modifications **synchronously**.

We can achieve this by leveraging `MutationObserver`.

#### Mechanism
1.  **Per-Translation Observer**: When creating a translation anchor (`<span>`), attach a `MutationObserver` to its **parent element**.
2.  **Detection Logic**: Watch for `{ childList: true, subtree: true }`.
3.  **Conflict Check**: When a mutation occurs, check if:
    - The anchor element was removed (React replaced the parent's content).
    - OR duplicate text appeared (React appended the new text node next to our anchor).
4.  **Reaction**: If a conflict is detected, **remove the anchor** (if it still exists) and clean up the tooltip immediately.

**Pros:**
- **Surgical**: Only removes the affected translation. Other translations on the page remain active.
- **Robust**: Works for any framework (React, Vue, etc.) that updates the DOM.
- **No False Positives**: Unlike Solution A (cleaning on *any* click), this only cleans up when the DOM actually changes. Clicking "Like" or "Retweet" won't kill the translation.

**Cons:**
- **Performance**: Adds one observer per active translation. Given the low number of concurrent translations (usually 1-5), this is negligible.

### Solution A: Pre-emptive Global Cleanup (Discarded)

*Originally proposed, but discarded in favor of Solution D.*

**Why discarded**: It was too aggressive. It would close all translations whenever the user clicked *any* interactive element (like a Like button), even if that action didn't update the text.

### Solution C: CSS Custom Highlight API (Long-term Vision)

The "Holy Grail" solution is to stop modifying the DOM structure entirely. This requires a significant architectural rewrite. See `SOLUTION_F_ANALYSIS.md` for a detailed feasibility study.

---

## 4. Implementation Plan (Solution D)

We will implement **Solution D** by modifying `src/1_content/ui/translationDisplay.ts`.

1.  **Create Observer Manager**:
    - Add a `Map<string, MutationObserver>` to track observers by anchor ID.

2.  **Attach Observer**:
    - In `showTranslationResult()`, find the `parentElement` of the newly created anchor.
    - Create a `MutationObserver` that watches this parent.
    - Start observing with `{ childList: true, subtree: true }`.

3.  **Implement Cleanup Logic**:
    - Inside the observer callback:
        - Check if the anchor is still in the DOM.
        - Check if the parent's `textContent` suggests duplication (heuristic: `textContent` contains the original text twice, or new text node siblings appear).
    - If confirmed, call `cleanupTranslationById(anchorId, null, "orphan")`.

4.  **Clean Up**:
    - Ensure the observer is disconnected in `cleanupTranslationById()`.

```typescript
// Conceptual Implementation in translationDisplay.ts

function setupMutationObserver(anchorId: string, anchor: HTMLElement) {
    const parent = anchor.parentElement;
    if (!parent) return;

    const observer = new MutationObserver((mutations) => {
        // 1. Check if anchor was removed by React
        if (!document.body.contains(anchor)) {
            cleanupTranslationById(anchorId, null, "orphan");
            return;
        }

        // 2. Check for duplication (React appended new text next to anchor)
        // Simple heuristic: if we see new text nodes added to the parent
        const hasTextNodeAddition = mutations.some(m => 
            Array.from(m.addedNodes).some(n => n.nodeType === Node.TEXT_NODE)
        );

        if (hasTextNodeAddition) {
             // React likely appended the new text. We should get out of the way.
             cleanupTranslationById(anchorId, anchor, "orphan"); // removes anchor & tooltip
        }
    });

    observer.observe(parent, { childList: true, subtree: true });
    anchorObservers.set(anchorId, observer); // Store for later disconnect
}
```
