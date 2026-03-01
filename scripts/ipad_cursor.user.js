// ==UserScript==
// @name         iPad Cursor Simulator
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Simulate iPad cursor style for recording
// @author       You
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    if (typeof document === 'undefined') return;

    const style = document.createElement('style');
    style.innerHTML = `
        html, body, * { cursor: none !important; }
        .__tapword_ipad_cursor_sim_v1 {
            position: fixed; top: 0; left: 0; width: 18px; height: 18px;
            background-color: rgba(100, 100, 100, 0.4); border-radius: 50%;
            pointer-events: none; z-index: 2147483647;
            transform: translate(-50%, -50%);
            transition: transform 0.1s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.1s, width 0.2s, height 0.2s;
            backdrop-filter: blur(2px); box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .__tapword_ipad_cursor_sim_v1.active { transform: translate(-50%, -50%) scale(0.8); background-color: rgba(60, 60, 60, 0.8); }
        .__tapword_ipad_cursor_sim_v1.hover { width: 28px; height: 28px; background-color: rgba(120, 120, 120, 0.2); }
    `;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.className = '__tapword_ipad_cursor_sim_v1';
    document.body.appendChild(cursor);

    document.addEventListener('mousemove', (e) => {
        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';
        const target = e.target;
        const isInteractive = ['A', 'BUTTON', 'INPUT', 'LABEL', 'SELECT', 'TEXTAREA'].includes(target.tagName) || 
                            target.closest('a') || target.closest('button') || 
                            window.getComputedStyle(target).cursor === 'pointer';
        if (isInteractive) cursor.classList.add('hover');
        else cursor.classList.remove('hover');
    });

    document.addEventListener('mousedown', () => cursor.classList.add('active'));
    document.addEventListener('mouseup', () => cursor.classList.remove('active'));
})();
