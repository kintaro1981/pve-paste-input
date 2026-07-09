# PVE Paste Input Tool

A text paste-and-type tool for the Proxmox VE noVNC console, letting you quickly type large blocks of text into a virtual machine.

After installing the script, open the PVE noVNC console page and click the paste button (clipboard icon) in the control bar to use it.

## Features

- Types large blocks of text into the VM one character at a time, with no character limit
- Adjustable inter-character delay (default 50 ms, no upper limit); the last-used value is remembered
- Supports newline, tab, and common symbols
- Shows a progress overlay while typing (characters typed / total); you can cancel at any time
- Detects unsupported non-ASCII characters (Chinese, emoji, etc.) in real time and shows a warning
- The paste button is automatically hidden when the VM is powered off or the console is in view-only mode
- The UI language automatically follows the PVE interface language (Chinese or English), no manual switch needed

## Usage

1. Install the Tampermonkey or Violentmonkey browser extension
2. Install this script
3. Open the PVE noVNC console page
4. Click the paste button (clipboard icon) in the control bar
5. Paste your text into the dialog, adjust the character interval, and click Send

## How It Works

The tool types text into the VM one character at a time, choosing between two paths:

1. Primary: send each character directly through the noVNC client's own key-sending interface, passing the keysym and physical key code
2. Fallback: when that interface is not reachable, dispatch synthesized keydown and keyup events to the console canvas element

Both paths hold the Shift key around uppercase letters and symbols that need it, and reset modifier key states before and after typing to avoid stuck keys.

### Interface Language

The tool's UI language automatically follows the language currently set in the PVE login interface, with no manual configuration needed:

1. It first reads the browser's PVELangCookie (the cookie PVE uses to record the user's selected interface language)
2. If that cookie doesn't exist, or its value is neither Chinese nor English, it falls back to the browser language (navigator.language)
3. The result is classified into only two interfaces: Chinese or English (any other language is treated as English)

## Customizing the PVE Address

Default matching rules:

- `https://*:8006/*` (the standard PVE port)
- `/^.*novnc.*/` (any path containing "novnc")

To match a specific domain (e.g. `https://pve.example.com/`), edit the `@match` rule in the script header:

```javascript
// ==UserScript==
// @match        https://pve.example.com/*
// @include      /^.*novnc.*/
// ==/UserScript==
```

You can also keep multiple match rules at once:

```javascript
// ==UserScript==
// @match        https://*:8006/*
// @match        https://pve.example.com/*
// @include      /^.*novnc.*/
// ==/UserScript==
```

To edit: open the installed script in your userscript manager, click Edit, update the `@match` line(s) in the header, and save.

## Supported Characters

- Supported: upper/lowercase letters, digits, common symbols, newline, tab
- Not supported: Chinese characters, emoji, extended Unicode characters

Character range: printable ASCII (32-126) + newline (10) + carriage return (13) + tab (9)

## Notes

1. Unsupported characters trigger a warning, letting you choose to continue sending or cancel
2. While typing is in progress, the mask blocks page interaction; click the cancel button on the progress overlay to abort
3. Do not close or refresh the page while typing is in progress, as this may interrupt the input (the browser will show a confirmation prompt)
4. If the console's CapsLock state gets out of sync, check and sync the CapsLock state inside the VM

## Compatibility

- Browsers: Chrome, Firefox, Edge (requires ES6 support)
- PVE versions: tested on 5.x, 7.x, 8.x, and 9.x

## License

Built on top of amunchet's noVNCCopyPasteProxmox.user.js.
