# Extension Security Checklist

## Message Passing

- **Sender Validation**:
  - [ ] **Check `sender.id`**: Verify the message comes from YOUR extension (compare with `chrome.runtime.id`).
  - [ ] **Check `sender.url`**: If expecting messages from content scripts, verify the URL origin is allowed.
  - [ ] **External Messages**: For `onMessageExternal`, STRICTLY validate the sender ID (allowed extensions/sites).
- **Data Validation**:
  - [ ] **Sanitize Input**: Treat message `request` payload as untrusted input.

## Content Scripts

- **Hostile Environment**:
  - [ ] **CSS Conflicts**: The host page style might break your UI.
    - *Fix*: Use Shadow DOM to encapsulate your UI styles.
  - [ ] **Prototype Pollution**: The host page might have monkey-patched `Array.prototype` or `Object.prototype`.
    - *Fix*: Be defensive, or use "clean" iframe contexts if critical logic is involved.
- **DOM Injection (XSS)**:
  - [ ] **No `innerHTML`**: Avoid `element.innerHTML = ...` with user/external data.
    - *Fix*: Use `textContent`, `innerText`, or DOM creation methods (`document.createElement`).
  - [ ] **Sanitization**: If HTML injection is necessary, use a sanitizer (e.g., `DOMPurify`).
- **Isolation**:
  - [ ] **Clean Global Scope**: Don't pollute the window object of the host page. Content scripts share the DOM but have isolated JS scope, but beware of DOM event leaks.

## Permissions

- **Least Privilege**:
  - [ ] **Specific Hosts**: Avoid `<all_urls>` or `*://*/*` if specific domains suffice.
  - [ ] **Optional Permissions**: Use `permissions` vs `optional_permissions` to reduce install-time warnings.
  - [ ] **Clipboard**: `clipboardRead` is sensitive.
  - [ ] **Tabs**: `tabs` permission gives access to sensitive URL/title data. Use `activeTab` if interaction is user-triggered.

## Storage

- **Sensitive Data**:
  - [ ] **No Secrets in Local Storage**: `chrome.storage.local` is not encrypted on disk.
  - [ ] **Clear on Sign-out**: Ensure tokens are removed when user logs out.

## External Connections

- **`externally_connectable`**:
  - [ ] **Restricted IDs**: Only list specific extension IDs or domain patterns. Never use `*` for IDs.
