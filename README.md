# JARVIS AI — MacBook Desktop Assistant

A native macOS app shell for a private, Jarvis-style desktop assistant. It wraps the command center in Electron, uses native macOS menus and window controls, exposes a MacBook-only runtime, and is packaged as a universal `.dmg` for Apple Silicon and Intel Macs.

> **MacBook only.** The distributed app checks for macOS at launch; it is not packaged for Windows or Linux.
>
> This first release intentionally **does not execute operating-system commands**. The app demonstrates the guarded command and analysis experience while simulating dispatch to a future, permission-scoped local companion. Real automation must be implemented behind explicit macOS permissions and safety confirmations—not by passing free-form text to a shell.

## Install the Mac app

1. Download the latest **Jarvis AI universal `.dmg`** from the project [Releases page](https://github.com/armahjudah93-hue/Jarvis-AI/releases/latest).
2. Open the DMG and drag **Jarvis AI** into **Applications**.
3. Launch it from Applications. The first unsigned build may require **Control-click → Open** in Finder; that is expected until the app is signed and notarized with an Apple Developer certificate.

The DMG is built on a macOS GitHub Actions runner by `.github/workflows/build-macos-dmg.yml` and supports both Apple Silicon and Intel Macs.

## Run it locally on a Mac

```bash
cd Jarvis-AI
npm ci
npm run dev
```

To produce a local universal DMG on macOS:

```bash
npm run dist:mac
# Output: release/Jarvis-AI-0.1.0-universal.dmg
```

A browser-only preview remains available at [armahjudah93-hue.github.io/Jarvis-AI](https://armahjudah93-hue.github.io/Jarvis-AI/), but the downloadable desktop product is the macOS DMG.

## Try the prototype

- Type **“Open Chrome and pull up my email”** and press Enter.
- Type **“Set focus mode for 45 minutes”** to see a protected system-change approval.
- Type **“Send a status email to my team”** to see an external-action approval.
- Upload or drag in an image, PDF, text file, spreadsheet, or document to start a simulated private analysis flow.
- Select **Test wake word**, press `⌘/Ctrl + J`, or use **Speak** (where the browser supports Web Speech recognition).

The command queue and voice-output preference are stored only in browser `localStorage`.

## Product architecture

A production implementation should split into two trust boundaries:

```text
Microphone / hotkey / upload / screen capture
                  │
                  ▼
          Local desktop companion
   wake word → STT → intent classifier → policy engine
                  │                      │
                  │                approval required?
                  ▼                      ▼
     local tools + optional cloud LLM    desktop confirmation
                  │                      │
                  └──── OS automation / analysis ────┘
                               │
                               ▼
                      TTS + desktop UI updates
```

### Recommended implementation layers

1. **Wake word and STT (on device)** — use a low-power hotword detector (for example, Porcupine/openWakeWord) and local Whisper or whisper.cpp. Keep the microphone stream on-device until the user has invoked the assistant.
2. **Orchestrator** — turn transcribed speech into a typed intent and constrained action plan. The LLM can plan and explain; it should never receive unrestricted shell access.
3. **Policy engine** — classify every tool request as read-only, reversible, privileged, destructive, or external. Require an explicit confirmation for sending, buying, deleting, credential access, device settings, and broad file actions. Use allowlists, scoped capabilities, and audit logs.
4. **macOS tool adapter** — run AppleScript, Shortcuts, `NSWorkspace`, and other macOS-native plugins with the minimum rights. Keep simulated mouse/keyboard control as a last-resort, visibly announced capability, protected by macOS Accessibility permission and a just-in-time confirmation.
5. **Analysis router** — process file metadata, OCR, image understanding, PDF/table extraction, and code/data analysis. Choose local models by default; only send content to a cloud model after a clear, per-source disclosure and user policy check.
6. **Memory** — store preferences and approved facts locally, encrypt at rest, show an editable memory log, and never save sensitive material by default.
7. **Voice output** — produce concise local TTS feedback for status updates, blockers, and completed actions.

## Files

- `index.html` — semantic application shell and accessible modal controls.
- `styles.css` — responsive visual system, audio-style animation, desktop and mobile layouts.
- `app.js` — deterministic intent routing, command safety gates, queue/activity behavior, voice API support, file intake, persisted UI preferences, and native-shell awareness.
- `electron/main.cjs` — secure MacBook-only Electron main process, native menu, microphone policy, and window lifecycle.
- `electron/preload.cjs` — minimal, context-isolated bridge between the native shell and UI.
- `package.json` — universal macOS DMG configuration.
- `.github/workflows/build-macos-dmg.yml` — macOS CI build that outputs the downloadable DMG.

## Integration contract for a real local companion

Replace the simulated `executePlan` path in `app.js` with a secure relative API such as `POST /api/actions`. A local companion should validate the action again rather than trusting client-side policy.

```json
{
  "requestId": "uuid",
  "intent": "open_workspace",
  "arguments": { "app": "Chrome", "target": "email" },
  "risk": "read_only",
  "approval": { "granted": false, "scope": "single_action" }
}
```

The companion should return structured progress events, never raw shell input. For cloud reasoning, pass only the minimum redacted context needed to formulate a plan and retain an audit record of the disclosure decision.
