# Project Review Checklist

Use this checklist on every TapWord review. It captures repository-specific risks that a generic Chrome extension review often misses.

## 1. Behavior First

- [ ] Confirm what user-visible behavior changed before judging implementation details.
- [ ] Check whether the diff aligns with the target module's README and local abstractions.
- [ ] Verify names still match behavior. Flag functions whose implementation no longer matches their declared intent.

## 2. Translation Flow Integrity

- [ ] Verify request building, context gathering, and response parsing still use typed contracts.
- [ ] Check fallback behavior when the backend returns malformed data, empty fields, or network failures.
- [ ] Review changes that could mix translation, speech, and generation responsibilities across modules.

## 3. Popup and Settings UX

- [ ] Check whether popup screens handle loading, empty, and error states rather than assuming data is immediately available.
- [ ] Verify settings changes propagate cleanly to background and content logic without stale cached state.
- [ ] Watch for long-running work on the popup thread that should live elsewhere.

## 4. Shared Infrastructure Boundaries

- [ ] Infrastructure remains business-agnostic. It should not import app state or feature-specific decisions.
- [ ] Shared utilities are reused instead of cloned into feature modules.
- [ ] New constants replace stable magic values when those values carry product meaning.

## 5. Regression Triggers Worth Simulating

- [ ] First run with empty storage
- [ ] Extension reload or update while content scripts are still present
- [ ] Network timeout or backend 500
- [ ] Rapid repeated clicks or selections
- [ ] SPA route change or DOM replacement during overlay display
- [ ] Scroll or resize while annotation UI is attached
