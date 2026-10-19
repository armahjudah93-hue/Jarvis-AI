/*
 * JARVIS desktop prototype
 * This client-side shell demonstrates the interaction model. Connect command execution
 * and inference to a trusted local companion service before granting OS automation.
 */

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const commandInput = $('#commandInput');
const commandBar = $('#commandBar');
const runCommand = $('#runCommand');
const clearCommand = $('#clearCommand');
const voiceButton = $('#voiceButton');
const wakeToggle = $('#wakeToggle');
const listeningStatus = $('#listeningStatus');
const queueList = $('#queueList');
const confirmationModal = $('#confirmationModal');
const settingsModal = $('#settingsModal');
const toastArea = $('#toastArea');
const activityList = $('#activityList');
const soundButton = $('#soundButton');

let pendingAction = null;
let queue = JSON.parse(localStorage.getItem('jarvis-command-queue') || '[]');
let voiceOutputEnabled = JSON.parse(localStorage.getItem('jarvis-voice-output') || 'true');
let recognition = null;
let isRecognizing = false;

const icon = {
  launch: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8"/><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
  analyze: '<svg viewBox="0 0 24 24"><path d="M4 19V5m0 7h5m-5 5h10m-5-5h11M9 7h11"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m18 16 .8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16Z"/></svg>'
};

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char]);
}

function saveQueue() {
  localStorage.setItem('jarvis-command-queue', JSON.stringify(queue));
}

function formatCommand(command) {
  return command.charAt(0).toUpperCase() + command.slice(1);
}

function parseCommand(raw) {
  const command = raw.trim();
  const lower = command.toLowerCase();
  const has = (...terms) => terms.some(term => lower.includes(term));

  if (has('delete', 'remove', 'trash', 'erase')) {
    return {
      kind: 'protected', icon: 'shield', title: 'Destructive action detected',
      detail: 'Jarvis will wait for your approval before removing anything.',
      preview: `Request: ${formatCommand(command)}\nScope: Files or records matching your instruction\nProtection: Confirmation required`,
      outcome: 'Deletion request approved and sent to the local companion.'
    };
  }
  if (has('send', 'email ', 'email.', 'message ', 'slack ', 'post ', 'purchase', 'buy', 'pay')) {
    if (has('open', 'pull up', 'show', 'read', 'check')) {
      return { kind: 'safe', icon: 'launch', title: 'Opening your workspace', detail: 'Preparing the requested app view.', outcome: 'Opened your email workspace in a secure browser session.' };
    }
    return {
      kind: 'protected', icon: 'shield', title: 'External action detected',
      detail: 'Jarvis never sends messages or purchases without you.',
      preview: `Request: ${formatCommand(command)}\nScope: External communication or transaction\nProtection: Confirmation required`,
      outcome: 'Approval recorded. The local companion can now complete this action.'
    };
  }
  if (has('shutdown', 'restart', 'sleep', 'lock', 'system setting', 'volume', 'wifi', 'bluetooth', 'focus mode', 'do not disturb')) {
    return {
      kind: 'protected', icon: 'shield', title: 'System change detected',
      detail: 'This will change a setting on your device.',
      preview: `Request: ${formatCommand(command)}\nScope: Device settings\nProtection: Confirmation required`,
      outcome: 'System change approved and dispatched to the local companion.'
    };
  }
  if (has('summarize', 'analyze', 'review', 'explain', 'find', 'compare')) {
    return { kind: 'analysis', icon: 'analyze', title: 'Analysis queued', detail: 'Jarvis is organizing the information you asked about.', outcome: 'Analysis complete. I found the key points and next actions.' };
  }
  if (has('open', 'launch', 'start', 'play')) {
    return { kind: 'safe', icon: 'launch', title: 'Workspace action queued', detail: 'Jarvis will hand this to your local launcher.', outcome: 'The requested workspace action is ready for your local companion.' };
  }
  return { kind: 'general', icon: 'spark', title: 'Intent understood', detail: 'Jarvis is preparing a safe plan for this request.', outcome: 'Done. I added this to your activity timeline.' };
}

function displayQueue() {
  if (!queue.length) {
    queueList.innerHTML = '<div class="queue-empty"><div class="queue-empty-icon">✦</div><p>Your command queue is clear.</p><span>Ask Jarvis to get something done.</span></div>';
    return;
  }

  queueList.innerHTML = queue.slice(0, 3).map(item => `
    <div class="queue-item" data-id="${item.id}">
      <span class="queue-icon">${icon[item.icon] || icon.spark}</span>
      <div><strong>${escapeHTML(item.command)}</strong><span>${escapeHTML(item.detail)}</span></div>
      <em class="queue-status">${escapeHTML(item.status)}</em>
    </div>`).join('');
}

function addQueueItem(command, plan, status = 'QUEUED') {
  const item = { id: `${Date.now()}-${Math.random()}`, command, detail: plan.detail, icon: plan.icon, status };
  queue.unshift(item);
  queue = queue.slice(0, 8);
  saveQueue();
  displayQueue();
  return item;
}

function updateQueueItem(id, updates) {
  queue = queue.map(item => item.id === id ? { ...item, ...updates } : item);
  saveQueue();
  displayQueue();
}

function showToast(title, description = '', type = 'spark') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-mark">${type === 'shield' ? '✓' : type === 'analyze' ? '✦' : '›'}</span><p><strong>${escapeHTML(title)}</strong>${description ? `<small>${escapeHTML(description)}</small>` : ''}</p>`;
  toastArea.append(toast);
  window.setTimeout(() => {
    toast.classList.add('out');
    window.setTimeout(() => toast.remove(), 300);
  }, 4300);
}

function addActivity(title, detail, type = 'purple') {
  const symbols = {
    purple: '<svg viewBox="0 0 24 24"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/></svg>',
    blue: '<svg viewBox="0 0 24 24"><path d="M4 19V5m0 7h5m-5 5h10m-5-5h11M9 7h11"/></svg>',
    gold: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  const row = document.createElement('div');
  row.className = 'activity-item';
  row.innerHTML = `<span class="activity-icon ${type}">${symbols[type]}</span><div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(detail)}</span></div><time>Just now</time>`;
  activityList.prepend(row);
}

function speak(text) {
  if (!voiceOutputEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.06;
  utterance.pitch = .92;
  utterance.volume = .65;
  window.speechSynthesis.speak(utterance);
}

function executePlan(command, plan) {
  const item = addQueueItem(command, plan, 'RUNNING');
  showToast(plan.title, plan.detail, plan.icon);

  window.setTimeout(() => {
    updateQueueItem(item.id, { status: 'DONE', detail: plan.outcome });
    addActivity(plan.title, plan.outcome, plan.kind === 'analysis' ? 'blue' : plan.kind === 'protected' ? 'gold' : 'purple');
    showToast('Command complete', plan.outcome, plan.kind === 'analysis' ? 'analyze' : 'spark');
    speak(plan.outcome);
    window.setTimeout(() => {
      queue = queue.filter(queued => queued.id !== item.id);
      saveQueue();
      displayQueue();
    }, 5500);
  }, plan.kind === 'analysis' ? 1500 : 1000);
}

const conversationHistory = JSON.parse(localStorage.getItem('jarvis-conversation-history') || '[]').slice(-12);
const activeTimers = new Map();
let isSendingCommand = false;

function planForBackendAction(action) {
  const name = action?.name || 'conversation';
  if (name === 'create_timer') return { icon: 'focus', detail: 'Waiting for the local timer to start', kind: 'timer' };
  if (name === 'calculate') return { icon: 'spark', detail: 'Calculating with the protected math engine', kind: 'calculation' };
  if (name === 'get_time') return { icon: 'focus', detail: 'Reading the trusted system clock', kind: 'time' };
  if (name === 'search_web') return { icon: 'analyze', detail: 'Retrieving sourced web results', kind: 'search' };
  return { icon: 'spark', detail: 'Asking the configured JARVIS backend', kind: 'conversation' };
}

function saveHistory(userMessage, assistantMessage) {
  conversationHistory.push({ role: 'user', content: userMessage }, { role: 'assistant', content: assistantMessage });
  conversationHistory.splice(0, Math.max(0, conversationHistory.length - 12));
  localStorage.setItem('jarvis-conversation-history', JSON.stringify(conversationHistory));
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function startRealTimer(timer, commandItem) {
  const endsAt = Date.now() + timer.durationSeconds * 1000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (remaining <= 0) {
      window.clearInterval(interval);
      activeTimers.delete(commandItem.id);
      updateQueueItem(commandItem.id, { status: 'COMPLETE', detail: `${timer.label} finished.` });
      addActivity('Timer completed', `${timer.label} · ${formatTimer(timer.durationSeconds)}`, 'purple');
      showToast('Timer complete', `${timer.label} has finished.`, 'spark');
      speak(`${timer.label} is complete.`);
      return;
    }
    updateQueueItem(commandItem.id, { status: formatTimer(remaining), detail: `${timer.label} is running on this device` });
  };
  const interval = window.setInterval(update, 1000);
  activeTimers.set(commandItem.id, interval);
  update();
}

function resultDetail(action, message) {
  if (!action?.result) return message;
  if (action.name === 'calculate') return `${action.result.expression} = ${action.result.formatted}`;
  if (action.name === 'get_time') return action.result.formatted;
  if (action.name === 'search_web') {
    const sources = (action.result.results || []).slice(0, 2).map(result => result.title).filter(Boolean);
    return sources.length ? sources.join(' · ') : message;
  }
  return message;
}

function setCommandBusy(busy) {
  isSendingCommand = busy;
  runCommand.disabled = busy;
  runCommand.innerHTML = busy ? 'Working <span>···</span>' : 'Run <span>↵</span>';
  commandBar.classList.toggle('is-busy', busy);
}

async function submitCommand() {
  const command = commandInput.value.trim();
  if (!command || isSendingCommand) {
    if (!command) {
      commandBar.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 250 });
      commandInput.focus();
    }
    return;
  }
  if (!window.JarvisApi) {
    showToast('Backend client unavailable', 'Reload JARVIS or launch the Mac app again.', 'shield');
    return;
  }

  const item = addQueueItem(command, { icon: 'spark', detail: 'Sending a validated request to JARVIS', kind: 'conversation' }, 'THINKING');
  commandInput.value = '';
  clearCommand.classList.remove('visible');
  setCommandBusy(true);

  try {
    const response = await window.JarvisApi.sendCommand(command, conversationHistory);
    const actionPlan = planForBackendAction(response.action);
    updateQueueItem(item.id, { icon: actionPlan.icon, detail: actionPlan.detail });

    if (response.status === 'requires_client_action' && response.action?.name === 'create_timer') {
      startRealTimer(response.action.result, item);
      addActivity('Timer started', `${response.action.result.label} · ${formatTimer(response.action.result.durationSeconds)}`, 'purple');
      showToast('Timer started', `${formatTimer(response.action.result.durationSeconds)} is now running on this device.`, 'spark');
    } else {
      const detail = resultDetail(response.action, response.message);
      updateQueueItem(item.id, { status: 'DONE', detail });
      addActivity(response.action?.name === 'search_web' ? 'Web search completed' : 'JARVIS completed a request', detail, response.action?.name === 'search_web' ? 'blue' : 'purple');
      showToast(response.orchestrator === 'openai' ? 'JARVIS response' : 'Local tool result', response.message, response.action?.name === 'search_web' ? 'analyze' : 'spark');
      speak(response.message);
      window.setTimeout(() => {
        queue = queue.filter(queued => queued.id !== item.id);
        saveQueue();
        displayQueue();
      }, 6000);
    }
    saveHistory(command, response.message);
  } catch (error) {
    updateQueueItem(item.id, { status: 'ERROR', icon: 'shield', detail: error.message || 'No action was taken.' });
    addActivity('Command not completed', error.message || 'The backend rejected the request.', 'gold');
    showToast('No action was taken', error.message || 'JARVIS could not complete that request.', 'shield');
  } finally {
    setCommandBusy(false);
  }
}

function openModal(modal) {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const focusable = modal.querySelector('button:not(.modal-close), input');
  window.setTimeout(() => focusable?.focus(), 50);
}

function closeModal(modal) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function initializeVoiceRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecognizing = true;
    voiceButton.classList.add('listening');
    voiceButton.querySelector('span').textContent = 'Listening';
    commandInput.placeholder = 'Listening for your command…';
  };
  recognition.onresult = event => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) transcript += event.results[i][0].transcript;
    commandInput.value = transcript.trim();
    clearCommand.classList.toggle('visible', Boolean(commandInput.value));
  };
  recognition.onerror = event => {
    if (event.error !== 'aborted') showToast('Voice input unavailable', 'Use the command field or check microphone permissions.', 'shield');
  };
  recognition.onend = () => {
    isRecognizing = false;
    voiceButton.classList.remove('listening');
    voiceButton.querySelector('span').textContent = 'Speak';
    commandInput.placeholder = 'Tell Jarvis what you need...';
    if (commandInput.value) submitCommand();
  };
}

function toggleVoiceInput() {
  if (!recognition) {
    showToast('Browser voice input is not available', 'Type a command instead — a local Whisper connection can power this in production.', 'shield');
    commandInput.focus();
    return;
  }
  if (isRecognizing) recognition.stop();
  else recognition.start();
}

function setWakeState(enabled, test = false) {
  wakeToggle.checked = enabled;
  if (enabled) {
    listeningStatus.textContent = test ? 'Wake word detected — how can I help?' : 'Listening for “Hey Jarvis”';
    $('.listening-panel').classList.remove('sleeping');
    if (test) {
      showToast('Wake word detected', 'Jarvis is ready for your next request.', 'spark');
      commandInput.focus();
      window.setTimeout(() => { if (wakeToggle.checked) listeningStatus.textContent = 'Listening for “Hey Jarvis”'; }, 3000);
    }
  } else {
    listeningStatus.textContent = 'Wake word paused — press ⌘ J to invoke';
    $('.listening-panel').classList.add('sleeping');
    showToast('Wake word paused', 'Jarvis will only respond when you invoke it.', 'shield');
  }
}

function bytesToSize(bytes) {
  if (!bytes) return 'Empty file';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${sizes[index]}`;
}

async function analyzeFile(file) {
  const dropzoneContent = $('#dropzoneContent');
  const isImage = file.type.startsWith('image/');
  const preview = isImage ? `<img alt="" src="${URL.createObjectURL(file)}">` : `<span>${file.name.split('.').pop().slice(0, 4).toUpperCase()}</span>`;
  dropzoneContent.innerHTML = `<div class="file-preview"><div class="file-preview-thumb">${preview}</div><div><strong>${escapeHTML(file.name)}</strong><span>${escapeHTML(file.type || 'Document')} · ${bytesToSize(file.size)}</span></div><button class="remove-file" aria-label="Remove file">×</button></div>`;
  $('.remove-file', dropzoneContent).addEventListener('click', event => {
    event.stopPropagation();
    resetFileDrop();
  });

  if (!window.JarvisApi) {
    showToast('Backend client unavailable', 'Launch the Mac app again before uploading a file.', 'shield');
    return;
  }

  const item = addQueueItem(`Analyze ${file.name}`, { icon: 'analyze', detail: 'Uploading to the protected local analysis service', kind: 'analysis' }, 'ANALYZING');
  showToast('Analysis started', 'JARVIS is reading this file through the local service.', 'analyze');

  try {
    const response = await window.JarvisApi.analyzeFile(file);
    const result = response.action.result;
    let detail = `${result.kind} · ${bytesToSize(result.bytes)}`;
    if (result.kind === 'text') detail = `${result.lines} lines · ${result.characters} characters`;
    if (result.kind === 'csv') detail = `${result.rows} rows · ${result.columns.length} columns`;
    updateQueueItem(item.id, { status: 'READY', detail });
    addActivity('File analyzed locally', `${result.fileName} · ${detail}`, 'blue');
    showToast('Analysis ready', response.message, 'analyze');
    speak(response.message);
  } catch (error) {
    updateQueueItem(item.id, { status: 'ERROR', icon: 'shield', detail: error.message || 'File analysis failed.' });
    showToast('File not analyzed', error.message || 'The local analysis service rejected the file.', 'shield');
  }
}

function resetFileDrop() {
  $('#dropzoneContent').innerHTML = '<span class="drop-icon"><svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></span><strong>Drop to analyze</strong><span>or <u>browse files</u></span>';
  $('#fileInput').value = '';
}

// Event bindings
commandInput.addEventListener('input', () => clearCommand.classList.toggle('visible', Boolean(commandInput.value)));
commandInput.addEventListener('keydown', event => { if (event.key === 'Enter') submitCommand(); });
runCommand.addEventListener('click', submitCommand);
clearCommand.addEventListener('click', () => { commandInput.value = ''; clearCommand.classList.remove('visible'); commandInput.focus(); });
voiceButton.addEventListener('click', toggleVoiceInput);

$$('.prompt-suggestions button').forEach(button => button.addEventListener('click', () => {
  commandInput.value = button.dataset.command;
  clearCommand.classList.add('visible');
  submitCommand();
}));

wakeToggle.addEventListener('change', event => setWakeState(event.target.checked));
$('#testWake').addEventListener('click', () => {
  if (!wakeToggle.checked) wakeToggle.checked = true;
  setWakeState(true, true);
});

$('#clearQueue').addEventListener('click', () => {
  if (!queue.length) return showToast('Nothing to clear', 'Your command queue is already empty.', 'spark');
  queue = [];
  saveQueue();
  displayQueue();
  showToast('Queue cleared', 'No pending commands remain.', 'spark');
});

$('#approveAction').addEventListener('click', () => {
  if (!pendingAction) return;
  const { command, plan } = pendingAction;
  closeModal(confirmationModal);
  pendingAction = null;
  executePlan(command, plan);
});
function declinePending() {
  if (pendingAction) showToast('Action cancelled', 'No external or system change was made.', 'shield');
  pendingAction = null;
  closeModal(confirmationModal);
}
$('#declineAction').addEventListener('click', declinePending);
$('#cancelModal').addEventListener('click', declinePending);

$('#settingsButton').addEventListener('click', () => openModal(settingsModal));
$('.settings-close').addEventListener('click', () => closeModal(settingsModal));
$('#speakToggle').checked = voiceOutputEnabled;
$('#speakToggle').addEventListener('change', event => {
  voiceOutputEnabled = event.target.checked;
  localStorage.setItem('jarvis-voice-output', JSON.stringify(voiceOutputEnabled));
  soundButton.classList.toggle('active', !voiceOutputEnabled);
  showToast(voiceOutputEnabled ? 'Voice responses enabled' : 'Voice responses muted', voiceOutputEnabled ? 'Jarvis will speak helpful status updates.' : 'You will see updates on screen only.', 'spark');
});
soundButton.classList.toggle('active', !voiceOutputEnabled);
soundButton.addEventListener('click', () => {
  voiceOutputEnabled = !voiceOutputEnabled;
  localStorage.setItem('jarvis-voice-output', JSON.stringify(voiceOutputEnabled));
  $('#speakToggle').checked = voiceOutputEnabled;
  soundButton.classList.toggle('active', !voiceOutputEnabled);
  showToast(voiceOutputEnabled ? 'Voice responses enabled' : 'Voice responses muted', voiceOutputEnabled ? 'Jarvis is ready to speak.' : 'Screen-only responses are enabled.', 'spark');
});

$$('.nav-item').forEach(item => item.addEventListener('click', () => {
  $$('.nav-item').forEach(nav => nav.classList.remove('active'));
  item.classList.add('active');
  const section = item.dataset.section;
  if (section === 'Analyze') $('#dropzone').scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (section === 'Command center') commandInput.focus();
  else showToast(`${section} workspace`, `${section} is connected to your local Jarvis profile.`, 'spark');
}));

$('#viewActivity').addEventListener('click', () => {
  showToast('Activity history', 'Your recent commands, approvals, and analyses are shown here.', 'spark');
  activityList.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('#privacyLink').addEventListener('click', () => openModal(settingsModal));
$('#memoryButton').addEventListener('click', () => showToast('Memory review', 'Only approved preferences are retained in this prototype.', 'shield'));
$('#profileButton').addEventListener('click', () => showToast('Personal workspace', 'You are using Alex Harper’s private local profile.', 'spark'));

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) analyzeFile(fileInput.files[0]); });
['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', event => { const [file] = event.dataTransfer.files; if (file) analyzeFile(file); });

[confirmationModal, settingsModal].forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) { if (modal === confirmationModal) declinePending(); else closeModal(modal); } }));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); commandInput.focus(); commandBar.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (event.key === 'Escape') { closeModal(settingsModal); if (confirmationModal.classList.contains('open')) declinePending(); }
});

async function initializeDesktopShell() {
  if (!window.jarvisDesktop) return;

  document.body.classList.add('native-mac-app');
  $('#downloadMacApp').style.display = 'none';

  try {
    const desktop = await window.jarvisDesktop.getInfo();
    $('.crumb').innerHTML = `<span class="status-dot"></span><span>MacBook companion</span><span class="divider">/</span><span>macOS ${escapeHTML(desktop.release)}</span>`;
    $('.privacy-card strong').textContent = 'MacBook native app';
    $('.privacy-card span').textContent = `macOS ${desktop.release} · local companion`;
  } catch {
    // The desktop shell can still render the local UI if version info is unavailable.
  }

  window.jarvisDesktop.onFocusCommand(() => {
    commandInput.focus();
    commandBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  window.jarvisDesktop.onOpenSettings(() => openModal(settingsModal));
}

async function initializeBackendStatus() {
  if (!window.JarvisApi) return;
  try {
    const health = await window.JarvisApi.health();
    const mode = health.aiConfigured ? 'AI routing ready' : health.localFallback ? 'Local tools ready' : 'AI key required';
    const platform = window.jarvisDesktop ? 'MacBook app' : 'Backend connected';
    $('.crumb').innerHTML = `<span class="status-dot"></span><span>${platform}</span><span class="divider">/</span><span>${mode}</span>`;
    $('.system-readout span:nth-child(2)').textContent = health.aiConfigured ? 'AI backend secured' : 'Approved local tools online';
  } catch {
    $('.crumb').innerHTML = '<span class="status-dot offline"></span><span>Backend unavailable</span><span class="divider">/</span><span>No command was sent</span>';
    $('.system-readout span:nth-child(2)').textContent = 'Backend connection required';
  }
}

initializeVoiceRecognition();
displayQueue();
initializeDesktopShell().finally(initializeBackendStatus);
