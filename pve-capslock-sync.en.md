# Fixing CapsLock/NumLock Desync in the PVE Console

[中文](pve-capslock-sync.md) | English

#### 1. Symptoms

- **State inversion**: the physical keyboard's CapsLock indicator is lit (uppercase), but input inside the VM shows as lowercase — or vice versa.
- **Paste corruption**: text pasted through the noVNC console comes out with the exact opposite letter case from the source text.
- **Deadlock loop**: repeatedly toggling CapsLock keeps the host and the VM in permanently opposite states ("one on, one off"), never converging.

#### 2. Root Cause

**The browser's VNC protocol transmits a "key press action", not a "lock state".**

When the user presses CapsLock, the browser sends the VM a **"toggle switch pressed"** instruction (a relative/inverting signal), not an absolute **"caps is currently on"** state signal.

**Reproduction scenario:**
Suppose the physical keyboard is currently **uppercase (indicator lit)**, while the VM defaults to **lowercase**.

1. The user presses CapsLock, intending to switch the input mode.
2. **Host**: responds to the key press and becomes **lowercase (indicator off)**.
3. **VM**: receives the "toggle" instruction, inverts its lowercase state, and becomes **uppercase**.
4. **Result**: the host and VM states are still out of sync, causing garbled input.

#### 3. Fix

Follow these steps exactly to reset both sides to a known, matching state:

- **Step 1: Reset the VM's state**
  Type any character in the console to test, and toggle CapsLock as needed until **the VM's output is confirmed to be lowercase** (ignore the physical keyboard's indicator for now).
- **Step 2: Disconnect**
  Close the current noVNC web console window entirely (click the `X` in the corner, or close the tab) to **fully terminate the session**.
- **Step 3: Reset the physical device's state**
  Check the physical keyboard on your local machine. If the CapsLock indicator is lit, press the key to turn it off, **ensuring the physical keyboard is in the lowercase (indicator off) state**.
- **Step 4: Reconnect**
  Reopen the PVE console.

**Result:**
At this point the VM is lowercase (confirmed in step 1) and the physical keyboard is also lowercase (confirmed in step 3). Both ends start from the same state, so subsequent case toggling will stay in sync.

#### 4. Note

The same logic and fix also apply to **NumLock** desync issues.
