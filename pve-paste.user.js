// ==UserScript==
// @name         PVE Paste Input
// @namespace    https://github.com/cjpjxjx/pve-paste-input/
// @version      2.0
// @description  Improved PVE paste input tool with unsupported character detection, view-only mode syncing, and automatic Chinese/English UI switching
// @match        https://*:8006/*
// @include      /^.*novnc.*/
// @grant        none
// @run-at       document-start
// ==/UserScript==

// ============================================
// Config constants
// ============================================
const CONFIG = {
    CHAR_DELAY: 50, // Delay between characters (ms)
    COLORS: {
        WARNING: '#FFCC00',
        PRIMARY: '#2196F3',
        BG: '#4c4c4c',
        BG_DARK: '#3a3a3a',
        TEXT: '#e0e0e0',
        TEXT_LIGHT: '#b0d4f1',
        BORDER: '#666',
        GRAY: '#888'
    },
    DELAY: {
        DIALOG_CLOSE: 100,
        CANVAS_FOCUS: 100,
        VIEW_ONLY_CHECK: 100,
        INIT: 1000
    }
}

// ============================================
// Persisted settings (localStorage)
// ============================================
const STORAGE_KEY_CHAR_DELAY = 'pve-paste-char-delay'

// Restore the last saved typing speed, if any
;(function loadStoredCharDelay() {
    try {
        const stored = parseInt(localStorage.getItem(STORAGE_KEY_CHAR_DELAY), 10)
        // Accept any non-negative integer (no upper limit)
        if (!isNaN(stored) && stored >= 0) {
            CONFIG.CHAR_DELAY = stored
        }
    } catch (e) {
        // localStorage may be unavailable (e.g. private browsing) - fall back to the default
        console.warn('[PVE Paste Input] Failed to read saved typing speed:', e)
    }
})()

// Persist the current typing speed
function saveCharDelay(value) {
    try {
        localStorage.setItem(STORAGE_KEY_CHAR_DELAY, String(value))
    } catch (e) {
        console.warn('[PVE Paste Input] Failed to save typing speed:', e)
    }
}

// ============================================
// Language detection and text dictionary
// ============================================
function detectLanguage() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)PVELangCookie=([^;]+)/)
    const cookieLang = cookieMatch ? decodeURIComponent(cookieMatch[1]) : ''

    if (/^zh/i.test(cookieLang)) return 'zh'
    if (/^en/i.test(cookieLang)) return 'en'

    // Cookie missing or in another language, fall back to the browser language
    const browserLang = navigator.language || navigator.userLanguage || ''
    return /^zh/i.test(browserLang) ? 'zh' : 'en'
}

const I18N = {
    zh: {
        dialogTitle: '粘贴输入',
        notice: '仅支持大小写字母、数字及常见符号，不支持中文、Emoji 及特殊符号',
        placeholder: '在此粘贴要输入到虚拟机的文本...',
        charWarning: '⚠️ 检测到不支持的字符，可能无法正确输入',
        cancelBtn: '取消',
        confirmBtn: '确认输入',
        confirmDialogTitle: '⚠️ 字符警告',
        confirmDialogBody: '检测到不支持的字符（中文、Emoji 及特殊符号等）<br/><br/>这些字符可能无法正确输入到虚拟机中。<br/><br/>是否仍要继续发送？',
        confirmYesBtn: '继续发送',
        alertNoCanvas: '未找到 noVNC canvas 元素',
        alertNoCanvasSend: '未找到 noVNC canvas 元素，无法发送',
        alertEmptyText: '请输入要粘贴的内容',
        alertJQueryFail: '粘贴输入功能加载失败：无法加载 jQuery 库',
        buttonTitle: '粘贴输入',
        charCount: (len) => `已输入 ${len} 字符`,
        speedLabel: '字符间隔（毫秒）',
        speedHint: '字符间隔时间越小输入越快，但也越容易出错；如果输入出现错误，请适当增大字符间隔时间',
        progressTitle: '正在输入…',
        progressText: (current, total) => `已输入 ${current} / ${total} 字符`,
        progressWarning: '请勿关闭或刷新页面',
        progressCancelBtn: '取消输入',
        progressCompleteText: '✓ 输入完成',
        progressCancelledText: '已取消输入'
    },
    en: {
        dialogTitle: 'Paste Input',
        notice: 'Only letters, digits and common symbols are supported. Emoji and special symbols are not supported',
        placeholder: 'Paste the text to type into the VM here...',
        charWarning: '⚠️ Unsupported characters detected, may not input correctly',
        cancelBtn: 'Cancel',
        confirmBtn: 'Confirm',
        confirmDialogTitle: '⚠️ Character Warning',
        confirmDialogBody: 'Unsupported characters detected (emoji, special symbols, etc.)<br/><br/>These characters may not be entered correctly into the VM.<br/><br/>Continue sending anyway?',
        confirmYesBtn: 'Send Anyway',
        alertNoCanvas: 'noVNC canvas element not found',
        alertNoCanvasSend: 'noVNC canvas element not found, cannot send',
        alertEmptyText: 'Please enter the content to paste',
        alertJQueryFail: 'Failed to load paste input feature: could not load jQuery',
        buttonTitle: 'Paste Input',
        charCount: (len) => `${len} characters entered`,
        speedLabel: 'Char interval (ms)',
        speedHint: 'A smaller interval types faster but is more error-prone; if the input is incorrect, try increasing the interval',
        progressTitle: 'Typing…',
        progressText: (current, total) => `${current} / ${total} characters typed`,
        progressWarning: 'Do not close or refresh the page',
        progressCancelBtn: 'Cancel',
        progressCompleteText: '✓ Input complete',
        progressCancelledText: 'Input cancelled'
    }
}

const T = I18N[detectLanguage()]

// ============================================
// Plan A capture hook (must run at document-start, before noVNC loads)
//
// noVNC keeps its RFB instance module-scoped, so it is unreachable from the page
// (confirmed: nothing on `window` exposes it). However the RFB constructor calls
// `<method>.bind(this)` many times during setup, where `this` is the RFB instance.
// By wrapping Function.prototype.bind before noVNC's module executes, we capture
// that instance the first time it binds one of its own methods, then restore the
// original bind immediately (one-shot, negligible overhead).
// ============================================
;(function installRFBCaptureHook() {
    try {
        const origBind = Function.prototype.bind
        Function.prototype.bind = function (thisArg) {
            try {
                if (thisArg && typeof thisArg === 'object'
                    && typeof thisArg.sendKey === 'function'
                    && '_rfbConnectionState' in thisArg) {
                    window.__pveCapturedRFB = thisArg
                    Function.prototype.bind = origBind // one-shot: stop intercepting
                    console.log('[PVE Paste Input] Captured noVNC RFB instance at construction (Plan A ready)')
                }
            } catch (e) { /* ignore and fall through to the real bind */ }
            return origBind.apply(this, arguments)
        }
    } catch (e) {
        console.warn('[PVE Paste Input] Failed to install RFB capture hook:', e)
    }
})()

;(function () {
    'use strict'

    // The capture hook above already ran at document-start. Startup (conflict
    // detection + UI) must wait for the DOM, otherwise an already-injected
    // script/button might not be present yet and would be missed.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true })
    } else {
        main()
    }
    return

    // ============================================
    // Conflict detection: check if the page already has the Nginx-injected script
    // ============================================
    function checkForInjectedScript() {
        // Check whether pve-paste-inject.js has already been loaded
        const scripts = document.querySelectorAll('script[src*="pve-paste-inject.js"]')
        if (scripts.length > 0) {
            console.log('[PVE Paste Input] Detected Nginx-injected pve-paste-inject.js, userscript will not run to avoid conflict')
            return true
        }

        // Check whether the paste button already exists (may have been created by the injected script)
        const existingButton = document.getElementById('noVNC_paste_button')
        if (existingButton) {
            console.log('[PVE Paste Input] Detected existing paste button, userscript will not run to avoid conflict')
            return true
        }

        // Check whether the dialog created by the injected script exists
        const existingDialog = document.getElementById('paste-dialog')
        if (existingDialog) {
            console.log('[PVE Paste Input] Detected existing paste dialog, userscript will not run to avoid conflict')
            return true
        }

        return false
    }

    // ============================================
    // Deferred startup (called at DOMContentLoaded from the top of the IIFE)
    // ============================================
    function main() {

    // Check for conflicts when the script starts
    if (checkForInjectedScript()) {
        console.log('[PVE Paste Input] Userscript exited')
        return // Exit the script, do not run the rest of the code
    }

    console.log('[PVE Paste Input] No injected script detected, userscript will run normally')
    // ============================================

    // ============================================
    // Dynamically load jQuery (supports intranet environments)
    // ============================================
    function loadjQuery(callback) {
        if (typeof jQuery !== 'undefined') {
            console.log('[PVE Paste Input] jQuery already exists, using it directly')
            callback(jQuery);
            return;
        }

        console.log('[PVE Paste Input] Loading jQuery...')
        const script = document.createElement('script');
        script.src = 'https://code.jquery.com/jquery-3.3.1.min.js';
        script.onload = function() {
            console.log('[PVE Paste Input] jQuery loaded successfully')
            callback(jQuery.noConflict(true));
        };
        script.onerror = function() {
            console.error('[PVE Paste Input] Failed to load jQuery! Check your network or file path');
            alert(T.alertJQueryFail);
        };
        document.head.appendChild(script);
    }

    // Wait for jQuery to load before running the main logic
    loadjQuery(function($) {
        // Main logic starts
        // ============================================

    // ============================================
    // Plan A: drive noVNC's own RFB.sendKey(keysym, code, down) directly.
    //
    // Why this is better than dispatching synthetic KeyboardEvents:
    //   noVNC turns a real key press into an RFB message via getKeysym()/getKeycode().
    //   Feeding it fake KeyboardEvents means we must reverse-engineer that translation
    //   (key/keyCode/code) and hope noVNC re-derives what we intended. Calling sendKey()
    //   hands noVNC the keysym + code directly, so there is no guessing round-trip.
    //
    // PVE runs QEMU, whose VNC server advertises the QEMU Extended Key Event encoding.
    // In that mode noVNC sends the *scancode* (mapped from `code`) and the guest applies
    // its own modifier state, so an explicit Shift press IS required for upper/shifted
    // characters - exactly mirroring a physical keyboard.
    // ============================================
    const XK_Shift_L = 0xffe1
    const XK_Return = 0xff0d
    const XK_Tab = 0xff09

    // Cached RFB instance once located
    let _rfbCache = null

    // Duck-typing check: a noVNC RFB instance exposes sendKey() plus internal fields
    function looksLikeRFB(o) {
        return o && typeof o === 'object'
            && typeof o.sendKey === 'function'
            && ('_rfbConnectionState' in o || '_sock' in o || '_fbName' in o)
    }

    // Try to locate the live RFB instance. Standard noVNC keeps it module-scoped
    // (UI.rfb), so we probe common globals and then duck-type scan window one level
    // deep. Returns the instance or null; result is cached.
    function findRFB() {
        if (looksLikeRFB(_rfbCache)) return _rfbCache
        _rfbCache = null

        // 0) Instance captured at construction time by the bind hook (preferred)
        if (looksLikeRFB(window.__pveCapturedRFB)) { _rfbCache = window.__pveCapturedRFB; return _rfbCache }

        // 1) Common explicit handles
        const direct = [
            window.rfb,
            window.UI && window.UI.rfb,
            window.RFB && window.RFB.rfb
        ]
        for (const c of direct) {
            if (looksLikeRFB(c)) { _rfbCache = c; return _rfbCache }
        }

        // 2) Duck-type scan of window's own properties (+ one level deep)
        const skip = new Set(['window', 'self', 'top', 'parent', 'frames',
            'document', 'location', 'navigator', 'history', 'localStorage',
            'sessionStorage', 'console', 'external'])
        let keys = []
        try { keys = Object.keys(window) } catch (e) { keys = [] }
        for (const k of keys) {
            if (skip.has(k)) continue
            let v
            try { v = window[k] } catch (e) { continue }
            if (!v || typeof v !== 'object') continue
            if (looksLikeRFB(v)) { _rfbCache = v; return _rfbCache }
            let subkeys = []
            try { subkeys = Object.keys(v) } catch (e) { continue }
            for (const k2 of subkeys) {
                let v2
                try { v2 = v[k2] } catch (e) { continue }
                if (looksLikeRFB(v2)) { _rfbCache = v2; return _rfbCache }
            }
        }
        return _rfbCache // null if not found
    }

    // Emit a single character through the RFB API
    function emitCharRFB(rfb, ch) {
        if (ch === '\n' || ch === '\r') { rfb.sendKey(XK_Return, 'Enter'); return }
        if (ch === '\t') { rfb.sendKey(XK_Tab, 'Tab'); return }

        // keysym for printable ASCII is just its code point; code drives the scancode
        const keysym = ch.charCodeAt(0)
        const code = getKeyName(ch)
        const needsShift = /[A-Z!@#$%^&*()_+{}:"<>?~|]/.test(ch)

        if (needsShift) {
            rfb.sendKey(XK_Shift_L, 'ShiftLeft', true)
            rfb.sendKey(keysym, code, true)
            rfb.sendKey(keysym, code, false)
            rfb.sendKey(XK_Shift_L, 'ShiftLeft', false)
        } else {
            rfb.sendKey(keysym, code, true)
            rfb.sendKey(keysym, code, false)
        }
    }

    // Send a string to noVNC
    window.sendString = function(text, callbacks) {
        callbacks = callbacks || {}

        // Prefer Plan A (direct RFB API); fall back to synthetic KeyboardEvents
        const rfb = findRFB()
        const el = document.getElementById("canvas-id")

        if (rfb) {
            console.log('[PVE Paste Input] Plan A: using noVNC RFB.sendKey() directly')
        } else {
            if (!el) {
                alert(T.alertNoCanvas)
                return null
            }
            console.log('[PVE Paste Input] Plan A unavailable (no RFB instance found), falling back to KeyboardEvent dispatch')
            // Reset all modifier key states before starting
            resetModifierKeys(el)
        }

        // Send character by character with a real delay
        let index = 0
        let cancelled = false
        const total = text.length
        const sendChar = () => {
            if (cancelled) {
                // Make sure modifier keys are released again after cancelling
                if (!rfb) resetModifierKeys(el)
                if (callbacks.onCancelled) callbacks.onCancelled(index, total)
                return
            }

            if (index >= text.length) {
                // Make sure modifier keys are released again after sending completes
                if (!rfb) resetModifierKeys(el)
                if (callbacks.onComplete) callbacks.onComplete(total)
                return
            }

            const x = text[index]

            if (rfb) {
                // Plan A: hand the keysym/code straight to noVNC
                emitCharRFB(rfb, x)
            } else {
                // Plan B: synthetic KeyboardEvents dispatched to the canvas
                let evt
                if (x === '\n' || x === '\r') {
                    evt = new KeyboardEvent("keydown", {key: 'Enter', keyCode: 13, code: 'Enter'})
                    el.dispatchEvent(evt)
                    evt = new KeyboardEvent("keyup", {key: 'Enter', keyCode: 13, code: 'Enter'})
                    el.dispatchEvent(evt)
                } else if (x === '\t') {
                    evt = new KeyboardEvent("keydown", {key: 'Tab', keyCode: 9, code: 'Tab'})
                    el.dispatchEvent(evt)
                    evt = new KeyboardEvent("keyup", {key: 'Tab', keyCode: 9, code: 'Tab'})
                    el.dispatchEvent(evt)
                } else {
                    sendCharWithKeyboard(el, x)
                }
            }

            index++
            if (callbacks.onProgress) callbacks.onProgress(index, total)
            setTimeout(sendChar, CONFIG.CHAR_DELAY)
        }

        sendChar()

        return {
            cancel: () => { cancelled = true }
        }
    }

    // Reset all modifier key states
    function resetModifierKeys(el) {
        const modifiers = [
            {keyCode: 16, code: 'ShiftLeft', key: 'Shift'},
            {keyCode: 16, code: 'ShiftRight', key: 'Shift'},
            {keyCode: 17, code: 'ControlLeft', key: 'Control'},
            {keyCode: 17, code: 'ControlRight', key: 'Control'},
            {keyCode: 18, code: 'AltLeft', key: 'Alt'},
            {keyCode: 18, code: 'AltRight', key: 'Alt'}
        ]

        // Send keyup multiple times to make sure it's released (in case state lingers)
        modifiers.forEach(mod => {
            const evt = new KeyboardEvent("keyup", {
                keyCode: mod.keyCode,
                code: mod.code,
                key: mod.key,
                bubbles: true
            })
            el.dispatchEvent(evt)
        })
    }

    // Improved KeyboardEvent dispatch (with state cleanup and delayed confirmation)
    function sendCharWithKeyboard(el, char) {
        let evt

        // Determine whether Shift is needed
        const needsShift = char.match(/[A-Z!@#$%^&*()_+{}:\"<>?~|]/)

        if (needsShift) {
            // Special handling: make sure Shift is fully released first
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftLeft', key: 'Shift'})
            el.dispatchEvent(evt)
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftRight', key: 'Shift'})
            el.dispatchEvent(evt)

            // Press Shift
            evt = new KeyboardEvent("keydown", {
                keyCode: 16,
                code: 'ShiftLeft',
                key: 'Shift',
                shiftKey: false,  // Explicitly mark the state before the transition
                bubbles: true
            })
            el.dispatchEvent(evt)

            // Send the character key (with the shiftKey flag)
            const keyCode = getKeyCode(char)
            evt = new KeyboardEvent("keydown", {
                key: char,
                keyCode: keyCode,
                code: getKeyName(char),
                shiftKey: true,
                bubbles: true
            })
            el.dispatchEvent(evt)

            evt = new KeyboardEvent("keyup", {
                key: char,
                keyCode: keyCode,
                code: getKeyName(char),
                shiftKey: true,
                bubbles: true
            })
            el.dispatchEvent(evt)

            // Release Shift (release immediately)
            evt = new KeyboardEvent("keyup", {
                keyCode: 16,
                code: 'ShiftLeft',
                key: 'Shift',
                shiftKey: false,  // Explicitly mark the state after the transition
                bubbles: true
            })
            el.dispatchEvent(evt)

            // Release again just in case (slight delay, to guard against async issues)
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftLeft', key: 'Shift'})
            el.dispatchEvent(evt)
        } else {
            // Character that doesn't need Shift
            // Make sure Shift isn't pressed first
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftLeft', key: 'Shift'})
            el.dispatchEvent(evt)

            const keyCode = getKeyCode(char)
            evt = new KeyboardEvent("keydown", {
                key: char,
                keyCode: keyCode,
                code: getKeyName(char),
                shiftKey: false,
                bubbles: true
            })
            el.dispatchEvent(evt)

            evt = new KeyboardEvent("keyup", {
                key: char,
                keyCode: keyCode,
                code: getKeyName(char),
                shiftKey: false,
                bubbles: true
            })
            el.dispatchEvent(evt)
        }
    }

    // Get the keyCode for a character
    function getKeyCode(char) {
        // Map special symbols to their corresponding digit-key keyCode
        const specialChars = {
            '!': 49, '@': 50, '#': 51, '$': 52, '%': 53,
            '^': 54, '&': 55, '*': 56, '(': 57, ')': 48,
            '_': 189, '+': 187, '{': 219, '}': 221, '|': 220,
            ':': 186, '"': 222, '<': 188, '>': 190, '?': 191,
            '~': 192
        }

        if (specialChars[char]) {
            return specialChars[char]
        }

        // Letters and digits use charCodeAt directly
        return char.toUpperCase().charCodeAt(0)
    }

    // Get the code property for a character
    function getKeyName(char) {
        const codeMap = {
            '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5',
            '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9', '0': 'Digit0',
            '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
            '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
            '-': 'Minus', '_': 'Minus', '=': 'Equal', '+': 'Equal',
            '[': 'BracketLeft', '{': 'BracketLeft', ']': 'BracketRight', '}': 'BracketRight',
            '\\': 'Backslash', '|': 'Backslash',
            ';': 'Semicolon', ':': 'Semicolon',
            "'": 'Quote', '"': 'Quote',
            ',': 'Comma', '<': 'Comma',
            '.': 'Period', '>': 'Period',
            '/': 'Slash', '?': 'Slash',
            '`': 'Backquote', '~': 'Backquote'
        }

        if (codeMap[char]) {
            return codeMap[char]
        }

        // Letter
        if (char.match(/[a-zA-Z]/)) {
            return 'Key' + char.toUpperCase()
        }

        return 'Key' + char.toUpperCase()
    }

    // Create the modal dialog
    function createPasteDialog() {
        // Dialog container - uses responsive sizing
        const dialog = $(`
            <div id="paste-dialog" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #4c4c4c;
                border: 1px solid #666;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                padding: 20px;
                z-index: 10000;
                width: 90vw;
                max-width: 800px;
                max-height: 80vh;
                display: none;
                box-sizing: border-box;
            ">
                <h3 style="margin: 0 0 15px 0; color: #fff; font-size: 16px;">${T.dialogTitle}</h3>
                <div style="margin-bottom: 10px; padding: 8px; background: rgba(33, 150, 243, 0.15); border-left: 3px solid #2196F3; font-size: 12px; color: #b0d4f1; line-height: 1.6;">
                    <div>· ${T.notice}</div>
                    <div>· ${T.speedHint}</div>
                </div>
                <textarea id="paste-textarea" style="
                    width: 100%;
                    height: 40vh;
                    max-height: 500px;
                    min-height: 200px;
                    padding: 10px;
                    border: 1px solid #666;
                    border-radius: 4px;
                    font-family: monospace;
                    font-size: 13px;
                    resize: none;
                    box-sizing: border-box;
                    background: #4c4c4c;
                    color: #e0e0e0;
                " placeholder="${T.placeholder}"></textarea>
                <div id="paste-char-warning" style="
                    margin-top: 8px;
                    padding: 8px;
                    background: rgba(255, 204, 0, 0.2);
                    border-left: 3px solid #FFCC00;
                    font-size: 12px;
                    color: #FFCC00;
                    display: none;
                ">
                    ${T.charWarning}
                </div>
                <div style="
                    margin-top: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 12px;
                ">
                    <label for="paste-speed-input" style="color: #b0d4f1; white-space: nowrap;">${T.speedLabel}</label>
                    <span id="paste-char-count" style="
                        color: ${CONFIG.COLORS.GRAY};
                        font-family: monospace;
                    ">${T.charCount(0)}</span>
                </div>
                <div style="margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div id="paste-speed-control" style="display: flex; align-items: center;">
                        <div style="display: inline-flex; align-items: stretch; border: 1px solid #666; border-radius: 4px; overflow: hidden; height: 35px;">
                            <button type="button" id="paste-speed-minus" style="
                                width: 30px;
                                border: none;
                                border-right: 1px solid #666;
                                background: #3a3a3a;
                                color: #e0e0e0;
                                cursor: pointer;
                                font-size: 18px;
                                line-height: 1;
                                user-select: none;
                                padding: 0;
                            ">&minus;</button>
                            <input type="text" inputmode="numeric" id="paste-speed-input" value="${CONFIG.CHAR_DELAY}" style="
                                width: 56px;
                                border: none;
                                background: #3a3a3a;
                                color: #e0e0e0;
                                font-size: 13px;
                                font-family: monospace;
                                text-align: center;
                                box-sizing: border-box;
                                padding: 0 4px;
                            " />
                            <button type="button" id="paste-speed-plus" style="
                                width: 30px;
                                border: none;
                                border-left: 1px solid #666;
                                background: #3a3a3a;
                                color: #e0e0e0;
                                cursor: pointer;
                                font-size: 18px;
                                line-height: 1;
                                user-select: none;
                                padding: 0;
                            ">+</button>
                        </div>
                    </div>
                    <div style="flex-shrink: 0; white-space: nowrap;">
                        <button id="paste-cancel-btn" style="
                            height: 35px;
                            padding: 0 20px;
                            margin-right: 10px;
                            border: 1px solid #666;
                            border-radius: 4px;
                            background: #3a3a3a;
                            color: #e0e0e0;
                            cursor: pointer;
                            font-size: 14px;
                            box-sizing: border-box;
                        ">${T.cancelBtn}</button>
                        <button id="paste-confirm-btn" style="
                            height: 35px;
                            padding: 0 20px;
                            border: none;
                            border-radius: 4px;
                            background: #2196F3;
                            color: white;
                            cursor: pointer;
                            font-size: 14px;
                            box-sizing: border-box;
                        ">${T.confirmBtn}</button>
                    </div>
                </div>
            </div>
        `)

        // Overlay
        const overlay = $(`
            <div id="paste-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
                display: none;
            "></div>
        `)

        // Custom confirmation dialog
        const confirmDialog = $(`
            <div id="paste-confirm-dialog" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #4c4c4c;
                border: 1px solid #FFCC00;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.7);
                padding: 25px;
                z-index: 10001;
                min-width: 400px;
                max-width: 500px;
                display: none;
                box-sizing: border-box;
            ">
                <h3 style="margin: 0 0 15px 0; color: #FFCC00; font-size: 18px;">
                    ${T.confirmDialogTitle}
                </h3>
                <div style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                    ${T.confirmDialogBody}
                </div>
                <div style="text-align: right;">
                    <button id="paste-confirm-no" style="
                        padding: 8px 20px;
                        margin-right: 10px;
                        border: 1px solid #666;
                        border-radius: 4px;
                        background: #3a3a3a;
                        color: #e0e0e0;
                        cursor: pointer;
                        font-size: 14px;
                    ">${T.cancelBtn}</button>
                    <button id="paste-confirm-yes" style="
                        padding: 8px 20px;
                        border: none;
                        border-radius: 4px;
                        background: #FFCC00;
                        color: #000;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                    ">${T.confirmYesBtn}</button>
                </div>
            </div>
        `)

        // Progress overlay (blocks page interaction while typing is in progress;
        // kept visually transparent so the console stays visible underneath)
        const progressOverlay = $(`
            <div id="paste-progress-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0);
                cursor: not-allowed;
                z-index: 10002;
                display: none;
            "></div>
        `)

        // Progress panel - pinned to the bottom-right corner so it doesn't cover
        // the console while the user watches the input happen
        const progressPanel = $(`
            <div id="paste-progress-panel" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #4c4c4c;
                border: 1px solid #666;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.7);
                padding: 16px 18px;
                z-index: 10003;
                width: 280px;
                max-width: calc(100vw - 40px);
                display: none;
                box-sizing: border-box;
                text-align: left;
            ">
                <h3 style="margin: 0 0 10px 0; color: #fff; font-size: 14px;">${T.progressTitle}</h3>
                <div style="background: #3a3a3a; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 8px;">
                    <div id="paste-progress-bar" style="height: 100%; width: 0%; background: #2196F3; transition: width 0.1s linear;"></div>
                </div>
                <div id="paste-progress-text" style="font-size: 12px; color: #e0e0e0; margin-bottom: 8px; font-family: monospace;"></div>
                <div style="font-size: 11px; color: #FFCC00; margin-bottom: 12px;">${T.progressWarning}</div>
                <button id="paste-progress-cancel-btn" style="
                    width: 100%;
                    padding: 6px 20px;
                    border: 1px solid #666;
                    border-radius: 4px;
                    background: #3a3a3a;
                    color: #e0e0e0;
                    cursor: pointer;
                    font-size: 13px;
                ">${T.progressCancelBtn}</button>
            </div>
        `)

        // Toast notification (non-blocking) - appears in the same bottom-right spot
        // as the progress panel, so completion/cancel feedback replaces it in place
        const toast = $(`
            <div id="paste-toast" style="
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #4c4c4c;
                border: 1px solid #666;
                border-radius: 8px;
                padding: 14px 18px;
                color: #e0e0e0;
                font-size: 14px;
                z-index: 10004;
                display: none;
                width: 280px;
                max-width: calc(100vw - 40px);
                box-sizing: border-box;
                text-align: center;
                box-shadow: 0 4px 20px rgba(0,0,0,0.7);
            "></div>
        `)

        $('body').append(overlay).append(dialog).append(confirmDialog).append(progressOverlay).append(progressPanel).append(toast)

        // Set the placeholder color and pin the stepper button/input sizes so PVE's
        // host CSS (which stretches <button> elements) can't blow them up
        const style = $(`<style>
            #paste-textarea::placeholder { color: #888; opacity: 1; }
            #paste-speed-minus, #paste-speed-plus {
                width: 36px !important;
                min-width: 36px !important;
                max-width: 36px !important;
                flex: 0 0 36px !important;
                box-sizing: border-box !important;
            }
            #paste-speed-input {
                width: 60px !important;
                min-width: 60px !important;
                max-width: 60px !important;
                flex: 0 0 60px !important;
                box-sizing: border-box !important;
            }
            #paste-cancel-btn, #paste-confirm-btn {
                height: 35px !important;
                box-sizing: border-box !important;
            }
        </style>`)
        $('head').append(style)

        // Detect non-ASCII characters
        function checkUnsupportedChars(text) {
            // ASCII printable range: 32-126, plus newline (10), carriage return (13) and tab (9)
            const hasUnsupported = [...text].some(char => {
                const code = char.charCodeAt(0)
                return code > 126 || (code < 32 && code !== 10 && code !== 13 && code !== 9) // Allow newline, carriage return, tab
            })
            return hasUnsupported
        }

        // Live-check the textarea content
        $('#paste-textarea').on('input', function() {
            const text = $(this).val()
            const length = text.length

            // Update the character count display
            $('#paste-char-count').text(T.charCount(length))

            // Detect unsupported characters
            if (text && checkUnsupportedChars(text)) {
                $('#paste-char-warning').show()
            } else {
                $('#paste-char-warning').hide()
            }
        })

        // Speed control: read/write the current typing delay (numeric only, no upper limit)
        const $speedInput = $('#paste-speed-input')

        function getSpeedValue() {
            const v = parseInt($speedInput.val(), 10)
            return (isNaN(v) || v < 0) ? CONFIG.CHAR_DELAY : v
        }

        function applySpeed(value, writeToInput) {
            value = Math.max(0, value)
            CONFIG.CHAR_DELAY = value
            if (writeToInput) $speedInput.val(value)
            saveCharDelay(value)
        }

        // Typing directly into the field (strip any non-digit characters)
        $speedInput.on('input', function() {
            const cleaned = this.value.replace(/[^0-9]/g, '')
            if (cleaned !== this.value) {
                this.value = cleaned
            }
            const value = parseInt(cleaned, 10)
            // Only apply a valid non-negative number; don't rewrite the field mid-typing
            if (!isNaN(value) && value >= 0) {
                applySpeed(value, false)
            }
        })

        // On blur, restore the current value if the field was left empty or invalid
        $speedInput.on('blur', function() {
            const value = parseInt(this.value, 10)
            if (isNaN(value) || value < 0) {
                this.value = CONFIG.CHAR_DELAY
            }
        })

        // Minus / plus stepper buttons
        $('#paste-speed-minus').click(function() {
            applySpeed(getSpeedValue() - 1, true)
        })
        $('#paste-speed-plus').click(function() {
            applySpeed(getSpeedValue() + 1, true)
        })

        // Shared button hover effect
        function addButtonHoverEffect(...selectors) {
            selectors.forEach(selector => {
                $(selector).hover(
                    function() { $(this).css('filter', 'brightness(1.2)') },
                    function() { $(this).css('filter', 'none') }
                )
            })
        }

        // Apply the hover effect to all buttons
        addButtonHoverEffect(
            '#paste-confirm-btn',
            '#paste-cancel-btn',
            '#paste-confirm-yes',
            '#paste-confirm-no',
            '#paste-progress-cancel-btn',
            '#paste-speed-minus',
            '#paste-speed-plus'
        )

        // ESC key handler
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeDialog()
            }
        }

        // Close the dialog
        const closeDialog = () => {
            dialog.hide()
            overlay.hide()
            $('#paste-textarea').val('')
            $('#paste-char-warning').hide()
            // Reset the character count
            $('#paste-char-count').text(T.charCount(0))
            // Unbind the ESC key listener
            $(document).off('keydown', handleEscKey)
        }

        // Bind the ESC key when showing the dialog
        const showDialog = () => {
            $('#paste-overlay').show()
            $('#paste-dialog').show()
            $('#paste-textarea').focus()
            // Bind the ESC key listener
            $(document).on('keydown', handleEscKey)
        }

        // Track the in-flight send so the cancel button can stop it
        let currentSendController = null

        // Show the progress panel and block page interaction
        function showProgressPanel(total) {
            $('#paste-progress-text').text(T.progressText(0, total))
            $('#paste-progress-bar').css('width', '0%')
            $('#paste-progress-cancel-btn').prop('disabled', false)
            $('#paste-progress-overlay, #paste-progress-panel').show()
            // Warn on refresh/close while typing is in progress
            window.onbeforeunload = function(e) {
                e.preventDefault()
                e.returnValue = ''
                return ''
            }
        }

        // Update the progress panel with the current typing position
        function updateProgress(current, total) {
            $('#paste-progress-text').text(T.progressText(current, total))
            $('#paste-progress-bar').css('width', (current / total * 100) + '%')
        }

        // Hide the progress panel and unblock the page
        function hideProgressPanel() {
            $('#paste-progress-overlay, #paste-progress-panel').hide()
            window.onbeforeunload = null
            currentSendController = null
        }

        // Show a brief non-blocking toast message
        function showToast(text) {
            $('#paste-toast').text(text).stop(true, true).fadeIn(150).delay(2500).fadeOut(400)
        }

        // Return focus to the canvas (fail silently)
        function focusCanvas(canvas) {
            setTimeout(() => {
                try {
                    canvas.focus()
                    canvas.click() // Simulate a click to make sure it's focused
                } catch (e) {
                    console.warn('[PVE Paste Input] Failed to focus canvas:', e)
                }
            }, CONFIG.DELAY.CANVAS_FOCUS)
        }

        // The function that actually sends the text
        function sendTextToVNC() {
            const text = $('#paste-textarea').val()

            // Check the canvas exists beforehand
            const canvas = document.getElementById("canvas-id")
            if (!canvas) {
                alert(T.alertNoCanvasSend)
                return
            }

            closeDialog()

            // Delay execution to make sure the dialog has closed
            setTimeout(() => {
                showProgressPanel(text.length)
                currentSendController = window.sendString(text, {
                    onProgress: updateProgress,
                    onComplete: () => {
                        hideProgressPanel()
                        showToast(T.progressCompleteText)
                        focusCanvas(canvas)
                    },
                    onCancelled: () => {
                        hideProgressPanel()
                        showToast(T.progressCancelledText)
                        focusCanvas(canvas)
                    }
                })
            }, CONFIG.DELAY.DIALOG_CLOSE)
        }

        // Cancel an in-flight send
        $('#paste-progress-cancel-btn').click(function() {
            if (currentSendController) {
                $(this).prop('disabled', true)
                currentSendController.cancel()
            }
        })

        // Confirm button
        $('#paste-confirm-btn').click(function() {
            const text = $('#paste-textarea').val()
            if (!text) {
                alert(T.alertEmptyText)
                return
            }

            // Detect unsupported characters, show the custom confirmation dialog
            if (checkUnsupportedChars(text)) {
                $('#paste-confirm-dialog').show()
            } else {
                // No unsupported characters, send directly
                sendTextToVNC()
            }
        })

        // Custom confirmation dialog - confirm send
        $('#paste-confirm-yes').click(function() {
            $('#paste-confirm-dialog').hide()
            sendTextToVNC()
        })

        // Custom confirmation dialog - cancel
        $('#paste-confirm-no').click(function() {
            $('#paste-confirm-dialog').hide()
        })

        // Cancel button
        $('#paste-cancel-btn').click(closeDialog)
        overlay.click(closeDialog)

        return { dialog, overlay, showDialog }
    }

    // Add the button to the noVNC control bar
    function addPasteButton() {
        const $controlBar = $('.noVNC_scroll')

        if ($controlBar.length === 0) {
            console.error('[PVE Paste Input] noVNC control bar not found')
            return
        }

        // Create the button (hidden by default, waiting for the sync logic to decide whether to show it)
        const pasteButton = $(`
            <input type="image" alt="${T.buttonTitle}"
                   src="/novnc/app/images/clipboard.svg"
                   id="noVNC_paste_button"
                   class="noVNC_button noVNC_hidden"
                   title="${T.buttonTitle}" />
        `)

        // Insert the button at the first position
        const $mobileButtons = $('#noVNC_mobile_buttons')

        if ($mobileButtons.length > 0) {
            $mobileButtons.before(pasteButton)
        } else {
            const $logo = $('.noVNC_logo')
            if ($logo.length > 0) {
                $logo.after(pasteButton)
            } else {
                $controlBar.prepend(pasteButton)
            }
        }

        // Sync the paste button's visibility with the "show extra keys" button
        function syncWithExtraKeysButton(pasteButton) {
            let lastVisibleState = null  // Cache the last visible state to avoid redundant updates
            let intersectionObserver = null  // IntersectionObserver instance

            // Update button visibility (with state caching)
            const updateButtonVisibility = (isVisible) => {
                // State unchanged, skip the update
                if (lastVisibleState === isVisible) return

                lastVisibleState = isVisible

                if (isVisible) {
                    pasteButton.removeClass('noVNC_hidden')
                    console.log('[PVE Paste Input] "Show extra keys" button visible -> showing paste button')
                } else {
                    pasteButton.addClass('noVNC_hidden')
                    console.log('[PVE Paste Input] "Show extra keys" button hidden -> hiding paste button')
                }
            }

            // Set up an IntersectionObserver for the button once found
            const setupIntersectionObserver = (extraKeysButton) => {
                // Disconnect any existing observer first
                if (intersectionObserver) {
                    intersectionObserver.disconnect()
                }

                // Use IntersectionObserver to watch the button's real visibility
                intersectionObserver = new IntersectionObserver((entries) => {
                    // entries[0].isIntersecting indicates whether the element is in the viewport
                    // but we also need to check whether it's actually visible (e.g. display:none)
                    const entry = entries[0]
                    const isVisible = entry.isIntersecting &&
                                      entry.target.offsetParent !== null &&
                                      entry.intersectionRatio > 0

                    updateButtonVisibility(isVisible)
                }, {
                    threshold: [0, 0.1]  // Watch for the element entering and leaving the viewport
                })

                intersectionObserver.observe(extraKeysButton)
                console.log('[PVE Paste Input] IntersectionObserver set up to watch "show extra keys" button')

                // Check the initial state immediately
                const isVisible = extraKeysButton.offsetParent !== null &&
                                  extraKeysButton.offsetWidth > 0 &&
                                  extraKeysButton.offsetHeight > 0
                updateButtonVisibility(isVisible)
            }

            // Try to get the "show extra keys" button directly
            let extraKeysButton = document.getElementById('noVNC_toggle_extra_keys_button')

            if (extraKeysButton) {
                // Button already exists, set up the listener directly
                console.log('[PVE Paste Input] Found "show extra keys" button')
                setupIntersectionObserver(extraKeysButton)
            } else {
                // Button doesn't exist yet, use a MutationObserver to wait for it
                console.log('[PVE Paste Input] Waiting for "show extra keys" button to load...')
                const domObserver = new MutationObserver(() => {
                    extraKeysButton = document.getElementById('noVNC_toggle_extra_keys_button')
                    if (extraKeysButton) {
                        console.log('[PVE Paste Input] Found "show extra keys" button (deferred load)')
                        setupIntersectionObserver(extraKeysButton)
                        // Note: don't disconnect domObserver, so button re-creation is handled too
                    }
                })

                domObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                })
            }
        }

        // Sync immediately (no delay) to make sure the initial button state is correct
        syncWithExtraKeysButton(pasteButton)

        console.log('[PVE Paste Input] Paste button added to noVNC control bar')
        return pasteButton
    }

    $(document).ready(function() {
        setTimeout(()=>{
            console.log("[PVE Paste Input] Starting up noVNC Copy/Paste with UI (for Proxmox)")

            $("canvas").attr("id", "canvas-id")

            // Create the dialog and the button
            const { showDialog } = createPasteDialog()
            const pasteButton = addPasteButton()

            // Button click event: show the dialog
            pasteButton.click(showDialog)
        }, CONFIG.DELAY.INIT);
    })

    }); // End of the loadjQuery callback

    } // End of main()

})()
