# JARVIS AI — MacBook Desktop Assistant

JARVIS is a **MacBook-only** desktop assistant with a secure local backend. The Electron app starts a loopback-only Node/Express service, sends commands through one validated API, and returns the result of an actual approved tool—not a simulated success message.

The public GitHub Pages site remains a UI preview. It has no API keys and cannot perform backend work. The downloadable Mac app starts the protected local service itself.

## What works in Version 2

| Tool | Real behavior | Risk policy |
| --- | --- | --- |
| `get_time` | Reads the server runtime clock with an optional IANA time zone. | Low — executes directly |
| `create_timer` | The backend validates duration; the visible client timer starts and counts down on the Mac. | Low — executes directly |
| `calculate` | Evaluates arithmetic with a bounded parser—never `eval` or generated code. | Low — executes directly |
| `search_web` | Uses DuckDuckGo Instant Answers and returns sourced result URLs when available. | Low — executes directly |
| `analyze_file` | Uploads a selected file to the local service for size/type validation, SHA-256 fingerprinting, and real text/CSV/JSON structure analysis. | Low — user-selected input only |

With `OPENAI_API_KEY` configured on the backend, OpenAI's Responses API decides whether an approved tool should run. The backend validates the model's structured function arguments before execution. If there is no model key, a deliberately limited local router handles only the approved timer, clock, calculator, and search patterns; the UI labels the result as a **local tool result** rather than claiming an AI model was used.

**Not implemented:** app launching, shell commands, filesystem mutation, messaging, purchases, system settings, and arbitrary desktop automation. JARVIS declines those requests; no action is taken.

## Download and install for macOS

1. Download the latest **universal `.dmg`** from [Releases](https://github.com/armahjudah93-hue/Jarvis-AI/releases/latest).
2. Open the DMG and drag **Jarvis AI** to **Applications**.
3. Launch it from Applications.

The DMG supports both Apple Silicon and Intel Macs. It is not currently signed or notarized. On first launch, macOS may require **Control-click → Open** in Finder. Code signing and notarization need an Apple Developer certificate and are intentionally not bypassed.

## Architecture

```text
Mac desktop UI (Electron / browser UI)
                  │ same-origin HTTPS-style API contract
                  ▼
       Loopback-only Express backend (127.0.0.1)
    validation → model tool choice → allowlisted tool
                  │
        ┌─────────┴──────────────────────────┐
        ▼                                    ▼
  server tools                         client-only action
  clock / math / web / file            visible timer starts locally
```

The app binds its API server to `127.0.0.1` on a random port, never the LAN. It uses a context-isolated preload bridge and does not expose Node.js APIs to page JavaScript.

## Local development

### Run the complete Mac desktop app

```bash
npm ci
npm run dev
```

### Run the backend and browser UI together

```bash
cp backend/.env.example backend/.env
npm run server
# Visit http://127.0.0.1:8787
```

### Configure AI routing

Place secrets in `backend/.env` locally or your backend host's secret manager when deploying the service. Do not commit keys or put them in `app.js`, `api.js`, GitHub Pages, or the DMG source.

```dotenv
OPENAI_API_KEY=your_server_side_key
OPENAI_MODEL=gpt-4.1-mini
JARVIS_ALLOWED_ORIGINS=http://127.0.0.1:8787,https://your-ui.example
JARVIS_ALLOW_LOCAL_FALLBACK=true
```

When building a packaged Mac app, supply the key through the app's launch environment or run a separately managed backend. A production release should store a user-provided credential in the macOS Keychain and obtain consent before it is used; that settings flow is not implemented in this build.

## API contract

### `POST /api/chat`

```json
{
  "message": "Set a timer for five minutes",
  "history": [{ "role": "user", "content": "Previous request" }]
}
```

The result is structured and only reports success after a tool has completed or a client action has been explicitly handed off:

```json
{
  "status": "requires_client_action",
  "orchestrator": "openai",
  "message": "I prepared a 5 minute timer. Starting it now.",
  "action": {
    "name": "create_timer",
    "risk": "low",
    "result": { "durationSeconds": 300, "label": "Jarvis timer", "startsOnClient": true }
  }
}
```

### `POST /api/files/analyze`

Accepts one user-selected `file` in multipart form data. Uploads are memory-bounded to 10 MB, not written to disk, and restricted to TXT, MD, CSV, JSON, PDF, PNG, JPG, JPEG, and WEBP. Text/CSV/JSON structure is analyzed locally; PDF/image content is acknowledged with accurate metadata-only limitations in this build.

## Security boundaries

- API credentials stay on the backend; browser JavaScript receives no secret.
- CORS uses an explicit origin allowlist. It is an extra browser boundary—not authentication.
- The backend accepts only the five allowlisted tool types. It never executes model-generated shell code.
- Inputs, file size, tool arguments, math tokens, timer duration, and request rate are validated.
- Request logs record tool/status metadata only; they do not log commands, file contents, or credentials.
- Desktop actions beyond the approved tools are denied until a separately permissioned macOS execution layer is built.

## Test and package

```bash
npm run verify
npm test
npm run dist:mac
```

`npm run dist:mac` must run on macOS and writes `release/Jarvis-AI-0.2.0-universal.dmg`. GitHub Actions uses a macOS runner to build and attach that DMG to the release.

## Project map

```text
├── index.html / styles.css / app.js   # UI and actual-result state handling
├── api.js                             # one browser-to-backend API client
├── electron/                          # Mac shell and secure preload bridge
├── backend/
│   ├── .env.example                   # secret-free configuration template
│   └── src/
│       ├── server.cjs                 # Express API, CORS, rate limits, upload handling
│       ├── orchestrator.cjs            # OpenAI function routing / bounded fallback
│       └── tools.cjs                  # safe implementations of the five approved tools
├── tests/tools.test.cjs               # parser and validation tests
└── .github/workflows/                 # Pages and universal macOS DMG build
```
