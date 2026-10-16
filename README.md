# JARVIS — Desktop Intelligence Prototype

A polished, local-first browser prototype for a Jarvis-style desktop assistant. It turns the requested product model into an interactive command center with wake-word state, voice input, a guarded command pipeline, document intake, multimodal-analysis status, memory/safety cues, activity history, and text-to-speech feedback.

> This repository intentionally **does not execute operating-system commands**. The UI is a safe prototype that simulates dispatch to a trusted local companion. Real desktop automation must run in a separately installed, permission-scoped local service—not in a web page.

## Run it

No package install is required.

```bash
cd /home/user/Jarvis-AI
python3 -m http.server 4173 --bind 0.0.0.0
```

Then visit `http://localhost:4173`.

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
4. **Local tool adapter** — run OS-specific plugins with the minimum rights: AppleScript/Shortcuts on macOS, PowerShell/UI Automation on Windows, and xdg/DBus/desktop APIs on Linux. Keep simulated mouse/keyboard control as a last-resort, visibly announced capability.
5. **Analysis router** — process file metadata, OCR, image understanding, PDF/table extraction, and code/data analysis. Choose local models by default; only send content to a cloud model after a clear, per-source disclosure and user policy check.
6. **Memory** — store preferences and approved facts locally, encrypt at rest, show an editable memory log, and never save sensitive material by default.
7. **Voice output** — produce concise local TTS feedback for status updates, blockers, and completed actions.

## Files

- `index.html` — semantic application shell and accessible modal controls.
- `styles.css` — responsive visual system, audio-style animation, desktop and mobile layouts.
- `app.js` — deterministic intent routing, command safety gates, queue/activity behavior, browser voice API support, file intake, and persisted UI preferences.

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
