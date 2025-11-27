// ==UserScript==
// @name         PVE 粘贴输入
// @namespace    https://github.com/cjpjxjx/pve-paste-input/
// @version      1.0
// @description  优化后的 PVE 粘贴输入工具，支持字符检测、仅查看模式联动等功能
// @match        https://*:8006/*
// @include      /^.*novnc.*/
// @grant        none
// ==/UserScript==

// ============================================
// 配置常量
// ============================================
const CONFIG = {
    MAX_CHARS: 3000,
    CHAR_DELAY: 10, // 字符输入间隔（毫秒）
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

;(function () {
    'use strict'

    // ============================================
    // 冲突检测：检查页面是否已通过 Nginx 注入脚本
    // ============================================
    function checkForInjectedScript() {
        // 检查是否已经加载了 pve-paste-inject.js
        const scripts = document.querySelectorAll('script[src*="pve-paste-inject.js"]')
        if (scripts.length > 0) {
            console.log('[PVE 粘贴输入] 检测到 Nginx 已注入 pve-paste-inject.js，油猴脚本将不运行以避免冲突')
            return true
        }

        // 检查是否已经存在粘贴按钮（可能是注入脚本已创建的）
        const existingButton = document.getElementById('noVNC_paste_button')
        if (existingButton) {
            console.log('[PVE 粘贴输入] 检测到粘贴按钮已存在，油猴脚本将不运行以避免冲突')
            return true
        }

        // 检查是否存在注入脚本创建的对话框
        const existingDialog = document.getElementById('paste-dialog')
        if (existingDialog) {
            console.log('[PVE 粘贴输入] 检测到粘贴对话框已存在，油猴脚本将不运行以避免冲突')
            return true
        }

        return false
    }

    // 在脚本开始时检查冲突
    if (checkForInjectedScript()) {
        console.log('[PVE 粘贴输入] 油猴脚本已退出')
        return // 退出脚本，不执行后续代码
    }

    console.log('[PVE 粘贴输入] 未检测到注入脚本，油猴脚本将正常运行')
    // ============================================

    // ============================================
    // jQuery 动态加载（支持内网环境）
    // ============================================
    function loadjQuery(callback) {
        if (typeof jQuery !== 'undefined') {
            console.log('[PVE 粘贴输入] jQuery 已存在，直接使用')
            callback(jQuery);
            return;
        }

        console.log('[PVE 粘贴输入] 开始加载 jQuery...')
        const script = document.createElement('script');
        script.src = 'https://code.jquery.com/jquery-3.3.1.min.js';
        script.onload = function() {
            console.log('[PVE 粘贴输入] jQuery 加载成功')
            callback(jQuery.noConflict(true));
        };
        script.onerror = function() {
            console.error('[PVE 粘贴输入] jQuery 加载失败！请检查网络或文件路径');
            alert('粘贴输入功能加载失败：无法加载 jQuery 库\n\n请确保可以访问 https://code.jquery.com/jquery-3.3.1.min.js');
        };
        document.head.appendChild(script);
    }

    // 等待 jQuery 加载后再执行主逻辑
    loadjQuery(function($) {
        // 主逻辑开始
        // ============================================

    // 发送字符串到 noVNC
    window.sendString = function(text) {
        var el = document.getElementById("canvas-id")
        if (!el) {
            alert('未找到 noVNC canvas 元素')
            return
        }

        // 开始前先重置所有修饰键状态
        resetModifierKeys(el)

        // 逐字符发送，使用真实的延迟
        let index = 0
        const sendChar = () => {
            if (index >= text.length) {
                // 发送完成后再次确保修饰键释放
                resetModifierKeys(el)
                return
            }

            const x = text[index]
            let evt

            // 处理换行符
            if (x === '\n' || x === '\r') {
                // 发送 Enter 键
                evt = new KeyboardEvent("keydown", {key: 'Enter', keyCode: 13, code: 'Enter'})
                el.dispatchEvent(evt)
                evt = new KeyboardEvent("keyup", {key: 'Enter', keyCode: 13, code: 'Enter'})
                el.dispatchEvent(evt)
            } else if (x === '\t') {
                // 发送 Tab 键
                evt = new KeyboardEvent("keydown", {key: 'Tab', keyCode: 9, code: 'Tab'})
                el.dispatchEvent(evt)
                evt = new KeyboardEvent("keyup", {key: 'Tab', keyCode: 9, code: 'Tab'})
                el.dispatchEvent(evt)
            } else {
                // 发送普通字符
                sendCharWithKeyboard(el, x)
            }

            index++
            setTimeout(sendChar, CONFIG.CHAR_DELAY)
        }

        sendChar()
    }

    // 重置所有修饰键状态
    function resetModifierKeys(el) {
        const modifiers = [
            {keyCode: 16, code: 'ShiftLeft', key: 'Shift'},
            {keyCode: 16, code: 'ShiftRight', key: 'Shift'},
            {keyCode: 17, code: 'ControlLeft', key: 'Control'},
            {keyCode: 17, code: 'ControlRight', key: 'Control'},
            {keyCode: 18, code: 'AltLeft', key: 'Alt'},
            {keyCode: 18, code: 'AltRight', key: 'Alt'}
        ]

        // 发送多次 keyup 确保释放（以防状态残留）
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

    // 改进的 KeyboardEvent 发送（带状态清理和延迟确认）
    function sendCharWithKeyboard(el, char) {
        let evt

        // 判断是否需要 Shift
        const needsShift = char.match(/[A-Z!@#$%^&*()_+{}:\"<>?~|]/)

        if (needsShift) {
            // 特殊处理：先确保 Shift 完全释放
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftLeft', key: 'Shift'})
            el.dispatchEvent(evt)
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftRight', key: 'Shift'})
            el.dispatchEvent(evt)

            // 按下 Shift
            evt = new KeyboardEvent("keydown", {
                keyCode: 16,
                code: 'ShiftLeft',
                key: 'Shift',
                shiftKey: false,  // 明确标记状态转换前
                bubbles: true
            })
            el.dispatchEvent(evt)

            // 发送字符键（带 shiftKey 标记）
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

            // 释放 Shift（立即释放）
            evt = new KeyboardEvent("keyup", {
                keyCode: 16,
                code: 'ShiftLeft',
                key: 'Shift',
                shiftKey: false,  // 明确标记状态转换后
                bubbles: true
            })
            el.dispatchEvent(evt)

            // 二次确保释放（延迟一点点，以防异步问题）
            evt = new KeyboardEvent("keyup", {keyCode: 16, code: 'ShiftLeft', key: 'Shift'})
            el.dispatchEvent(evt)
        } else {
            // 不需要 Shift 的字符
            // 先确保 Shift 未按下
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

    // 获取字符的 keyCode
    function getKeyCode(char) {
        // 特殊符号映射到对应的数字键 keyCode
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

        // 字母和数字直接使用 charCodeAt
        return char.toUpperCase().charCodeAt(0)
    }

    // 获取字符的 code 属性
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

        // 字母
        if (char.match(/[a-zA-Z]/)) {
            return 'Key' + char.toUpperCase()
        }

        return 'Key' + char.toUpperCase()
    }

    // 创建模态对话框
    function createPasteDialog() {
        // 对话框容器 - 使用响应式尺寸
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
                <h3 style="margin: 0 0 15px 0; color: #fff; font-size: 16px;">粘贴输入</h3>
                <div style="margin-bottom: 10px; padding: 8px; background: rgba(33, 150, 243, 0.15); border-left: 3px solid #2196F3; font-size: 12px; color: #b0d4f1;">
                    <strong>仅支持大小写字母、数字及常见符号，不支持中文、Emoji 及特殊符号</strong>
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
                " placeholder="在此粘贴要输入到虚拟机的文本..."></textarea>
                <div id="paste-char-warning" style="
                    margin-top: 8px;
                    padding: 8px;
                    background: rgba(255, 204, 0, 0.2);
                    border-left: 3px solid #FFCC00;
                    font-size: 12px;
                    color: #FFCC00;
                    display: none;
                ">
                    ⚠️ 检测到不支持的字符，可能无法正确输入
                </div>
                <div id="paste-length-warning" style="
                    margin-top: 8px;
                    padding: 8px;
                    background: rgba(255, 204, 0, 0.2);
                    border-left: 3px solid #FFCC00;
                    font-size: 12px;
                    color: #FFCC00;
                    display: none;
                ">
                    ⚠️ 字符数超出限制（最多 ${CONFIG.MAX_CHARS} 字符），无法发送
                </div>
                <div id="paste-char-count" style="
                    margin-top: 8px;
                    text-align: right;
                    font-size: 12px;
                    color: ${CONFIG.COLORS.GRAY};
                    font-family: monospace;
                ">
                    0/${CONFIG.MAX_CHARS}
                </div>
                <div style="margin-top: 15px; text-align: right;">
                    <button id="paste-cancel-btn" style="
                        padding: 8px 20px;
                        margin-right: 10px;
                        border: 1px solid #666;
                        border-radius: 4px;
                        background: #3a3a3a;
                        color: #e0e0e0;
                        cursor: pointer;
                        font-size: 14px;
                    ">取消</button>
                    <button id="paste-confirm-btn" style="
                        padding: 8px 20px;
                        border: none;
                        border-radius: 4px;
                        background: #2196F3;
                        color: white;
                        cursor: pointer;
                        font-size: 14px;
                    ">确认输入</button>
                </div>
            </div>
        `)

        // 遮罩层
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

        // 自定义确认对话框
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
                    ⚠️ 字符警告
                </h3>
                <div style="color: #e0e0e0; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                    检测到不支持的字符（中文、Emoji 及特殊符号等）<br/><br/>
                    这些字符可能无法正确输入到虚拟机中。<br/><br/>
                    是否仍要继续发送？
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
                    ">取消</button>
                    <button id="paste-confirm-yes" style="
                        padding: 8px 20px;
                        border: none;
                        border-radius: 4px;
                        background: #FFCC00;
                        color: #000;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                    ">继续发送</button>
                </div>
            </div>
        `)

        $('body').append(overlay).append(dialog).append(confirmDialog)

        // 设置 placeholder 颜色
        const style = $('<style>#paste-textarea::placeholder { color: #888; opacity: 1; }</style>')
        $('head').append(style)

        // 检测非 ASCII 字符
        function checkUnsupportedChars(text) {
            // ASCII 可打印字符范围：32-126，加上换行符 (10) 和回车符 (13)
            const hasUnsupported = [...text].some(char => {
                const code = char.charCodeAt(0)
                return code > 126 || (code < 32 && code !== 10 && code !== 13 && code !== 9) // 允许换行、回车、Tab
            })
            return hasUnsupported
        }

        // 检测字符数是否超出限制
        function isTextTooLong(text) {
            return text.length > CONFIG.MAX_CHARS
        }

        // 实时检测文本框内容
        $('#paste-textarea').on('input', function() {
            const text = $(this).val()
            const length = text.length

            // 更新字符计数显示
            const $charCount = $('#paste-char-count')
            $charCount.text(length + '/' + CONFIG.MAX_CHARS)

            // 超出限制时变为黄色警告
            if (isTextTooLong(text)) {
                $charCount.css('color', CONFIG.COLORS.WARNING)
                $charCount.text('⚠️ ' + length + '/' + CONFIG.MAX_CHARS)
                $('#paste-length-warning').show()
            } else {
                $charCount.css('color', CONFIG.COLORS.GRAY)
                $('#paste-length-warning').hide()
            }

            // 检测不支持的字符
            if (text && checkUnsupportedChars(text)) {
                $('#paste-char-warning').show()
            } else {
                $('#paste-char-warning').hide()
            }
        })

        // 统一的按钮悬停效果
        function addButtonHoverEffect(...selectors) {
            selectors.forEach(selector => {
                $(selector).hover(
                    function() { $(this).css('filter', 'brightness(1.2)') },
                    function() { $(this).css('filter', 'none') }
                )
            })
        }

        // 应用悬停效果到所有按钮
        addButtonHoverEffect(
            '#paste-confirm-btn',
            '#paste-cancel-btn',
            '#paste-confirm-yes',
            '#paste-confirm-no'
        )

        // ESC 键处理函数
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeDialog()
            }
        }

        // 关闭对话框
        const closeDialog = () => {
            dialog.hide()
            overlay.hide()
            $('#paste-textarea').val('')
            $('#paste-char-warning').hide()
            $('#paste-length-warning').hide()
            // 重置字符计数
            $('#paste-char-count').text('0/' + CONFIG.MAX_CHARS).css('color', CONFIG.COLORS.GRAY)
            // 解绑 ESC 键监听
            $(document).off('keydown', handleEscKey)
        }

        // 显示对话框时绑定 ESC 键
        const showDialog = () => {
            $('#paste-overlay').show()
            $('#paste-dialog').show()
            $('#paste-textarea').focus()
            // 绑定 ESC 键监听
            $(document).on('keydown', handleEscKey)
        }

        // 执行发送的函数
        function sendTextToVNC() {
            const text = $('#paste-textarea').val()

            // 提前检查 canvas 是否存在
            const canvas = document.getElementById("canvas-id")
            if (!canvas) {
                alert('未找到 noVNC canvas 元素，无法发送')
                return
            }

            closeDialog()

            // 延迟执行，确保对话框已关闭
            setTimeout(() => {
                window.sendString(text)

                // 发送完成后，将焦点返回到 canvas（静默失败）
                setTimeout(() => {
                    try {
                        canvas.focus()
                        canvas.click() // 模拟点击以确保焦点
                    } catch (e) {
                        console.warn('[PVE 粘贴输入] 无法聚焦 canvas:', e)
                    }
                }, CONFIG.DELAY.CANVAS_FOCUS)
            }, CONFIG.DELAY.DIALOG_CLOSE)
        }

        // 确认按钮
        $('#paste-confirm-btn').click(function() {
            const text = $('#paste-textarea').val()
            if (!text) {
                alert('请输入要粘贴的内容')
                return
            }

            // 检查字符数限制
            if (isTextTooLong(text)) {
                alert('字符数超出限制！\n\n当前字符数：' + text.length + '\n最大限制：' + CONFIG.MAX_CHARS + '\n\n请删减内容后重试。')
                return
            }

            // 检测不支持的字符，显示自定义确认对话框
            if (checkUnsupportedChars(text)) {
                $('#paste-confirm-dialog').show()
            } else {
                // 没有不支持的字符，直接发送
                sendTextToVNC()
            }
        })

        // 自定义确认对话框 - 确认发送
        $('#paste-confirm-yes').click(function() {
            $('#paste-confirm-dialog').hide()
            sendTextToVNC()
        })

        // 自定义确认对话框 - 取消
        $('#paste-confirm-no').click(function() {
            $('#paste-confirm-dialog').hide()
        })

        // 取消按钮
        $('#paste-cancel-btn').click(closeDialog)
        overlay.click(closeDialog)

        return { dialog, overlay, showDialog }
    }

    // 在 noVNC 控制栏中添加按钮
    function addPasteButton() {
        const $controlBar = $('.noVNC_scroll')

        if ($controlBar.length === 0) {
            console.error('未找到 noVNC 控制栏')
            return
        }

        // 创建按钮
        const pasteButton = $(`
            <input type="image" alt="粘贴输入"
                   src="/novnc/app/images/clipboard.svg"
                   id="noVNC_paste_button"
                   class="noVNC_button"
                   title="粘贴输入" />
        `)

        // 将按钮插入到第一个位置
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

        // 监听"仅查看"复选框状态
        function setupViewOnlyListener(pasteButton) {
            const updateButtonVisibility = (checkbox) => {
                if (checkbox && checkbox.checked) {
                    // 仅查看模式：隐藏粘贴按钮
                    pasteButton.addClass('noVNC_hidden')
                } else {
                    // 正常模式：显示粘贴按钮
                    pasteButton.removeClass('noVNC_hidden')
                }
            }

            // 尝试直接获取复选框
            let viewOnlyCheckbox = document.getElementById('noVNC_setting_view_only')

            if (viewOnlyCheckbox) {
                // 复选框已存在，直接绑定
                viewOnlyCheckbox.addEventListener('change', () => updateButtonVisibility(viewOnlyCheckbox))
                updateButtonVisibility(viewOnlyCheckbox)
                console.log('[PVE 粘贴输入] 已绑定"仅查看"监听器')
            } else {
                // 复选框不存在，使用 MutationObserver 等待
                const observer = new MutationObserver(() => {
                    viewOnlyCheckbox = document.getElementById('noVNC_setting_view_only')
                    if (viewOnlyCheckbox && !viewOnlyCheckbox.hasAttribute('data-paste-listener')) {
                        viewOnlyCheckbox.setAttribute('data-paste-listener', 'true')
                        viewOnlyCheckbox.addEventListener('change', () => updateButtonVisibility(viewOnlyCheckbox))
                        updateButtonVisibility(viewOnlyCheckbox)

                        // 找到目标后断开 Observer
                        observer.disconnect()
                        console.log('[PVE 粘贴输入] 已绑定"仅查看"监听器（延迟加载）')
                    }
                })

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                })
            }
        }

        // 延迟初始化，确保 noVNC 已加载
        setTimeout(() => {
            setupViewOnlyListener(pasteButton)
        }, CONFIG.DELAY.VIEW_ONLY_CHECK)

        console.log('粘贴输入按钮已添加到 noVNC 控制栏')
        return pasteButton
    }

    $(document).ready(function() {
        setTimeout(()=>{
            console.log("Starting up noVNC Copy/Paste with UI (for Proxmox)")

            $("canvas").attr("id", "canvas-id")

            // 创建对话框和按钮
            const { showDialog } = createPasteDialog()
            const pasteButton = addPasteButton()

            // 按钮点击事件：显示对话框
            pasteButton.click(showDialog)
        }, CONFIG.DELAY.INIT);
    })

    }); // 结束 loadjQuery 回调

})()