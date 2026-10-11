/**
 * ChatGPT Web Application - Client Logic
 */

(function () {
  'use strict';

  // --- State ---
  const STORAGE_KEYS = {
    CONVERSATIONS: 'chatgpt_conversations',
    SETTINGS: 'chatgpt_settings',
    THEME: 'nova_theme_v2',
    CURRENT_MODEL: 'chatgpt_current_model',
    ACCOUNT: 'kazai_user_account',
    PROJECTS: 'kazai_projects',
    ACTIVE_PROJECT: 'kazai_active_project'
  };

  let conversations = [];
  let activeConversationId = null;
  let currentModel = 'kazai';
  let modelsList = [];
  let isStreaming = false;
  let abortController = null;
  // Photos, videos and files waiting to be sent (up to MAX_ATTACHMENTS)
  let pendingAttachments = [];
  const MAX_ATTACHMENTS = 5;
  const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
  const TEXT_FILE_RE = /\.(txt|md|py|js|jsx|ts|tsx|html|css|json|csv|xml|yml|yaml|log|sh|bat|ini|toml|sql|java|c|h|cpp|cs|go|rs|rb|php|swift|kt)$/i;
  const videoUrls = new Map(); // attachment id -> blob URL (a video can only be replayed during the visit it was sent)
  let attachSeq = 0;
  let pendingAvatar = null;    // profile photo chosen but not saved yet
  let isWebSearchActive = false;
  let isPhotoGenerationActive = false;
  let workModeActive = false;
  let speechRecognition = null;
  let isRecordingVoice = false;
  let activeSpeechUtterance = null;

  let userAccount = {
    authenticated: false,
    isLoggedIn: false,
    id: null,
    name: '',
    username: '',
    avatar: '👤',
    isCreator: false
  };

  let projects = [];
  let activeProjectId = 'proj-default';
  let editingProjectId = null;

  let settings = {
    apiKey: '',
    geminiApiKey: '',
    claudeApiKey: '',
    baseUrl: '',
    temperature: 0.7,
    systemPrompt: '',
    theme: 'light',
    voicePreset: 'studio',
    voiceURI: '',
    voicePitch: 1.0,
    voiceRate: 1.0,
    voiceVolume: 100,
    autoSpeak: false,
    thinkingLevel: 'moderate',
    responseLength: 'balanced',
    tone: 'default',
    nickname: '',
    aiTitles: true,
    fontSize: 'medium',
    chatWidth: 'normal',
    fadeText: true,
    compact: false,
    enterToSend: true,
    autoScroll: true
  };

  // --- DOM Elements ---
  const appLayout = document.getElementById('appLayout');
  const sidebar = document.getElementById('sidebar');
  const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
  const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatSearchInput = document.getElementById('chatSearchInput');
  const chatHistoryContainer = document.getElementById('chatHistoryContainer');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const modelSelectorBtn = document.getElementById('modelSelectorBtn');
  const modelSelectorWrap = document.getElementById('modelSelectorWrap');
  const modelDropdownMenu = document.getElementById('modelDropdownMenu');
  const modelOptionsList = document.getElementById('modelOptionsList');
  const currentModelName = document.getElementById('currentModelName');
  const currentModelBadge = document.getElementById('currentModelBadge');
  const exportChatBtn = document.getElementById('exportChatBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const chatScrollFeed = document.getElementById('chatScrollFeed');
  const welcomeContainer = document.getElementById('welcomeContainer');
  const messagesContainer = document.getElementById('messagesContainer');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const attachFileBtn = document.getElementById('attachFileBtn');
  const fileInput = document.getElementById('fileInput');
  const attachmentPreview = document.getElementById('attachmentPreview');
  const attachStrip = document.getElementById('attachStrip');
  const dropOverlay = document.getElementById('dropOverlay');
  const modeSwitch = document.getElementById('modeSwitch');
  const modeNormalBtn = document.getElementById('modeNormalBtn');
  const modeWorkBtn = document.getElementById('modeWorkBtn');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const avatarUploadBtn = document.getElementById('avatarUploadBtn');
  const avatarRemoveBtn = document.getElementById('avatarRemoveBtn');
  const webSearchToggle = document.getElementById('webSearchToggle');
  const imageGenToggleBtn = document.getElementById('imageGenToggleBtn');
  const workToggleBtn = document.getElementById('workToggleBtn');
  const voiceInputBtn = document.getElementById('voiceInputBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const clearAllChatsBtn = document.getElementById('clearAllChatsBtn');
  const settingApiKey = document.getElementById('settingApiKey');
  const settingGeminiApiKey = document.getElementById('settingGeminiApiKey');
  const settingClaudeApiKey = document.getElementById('settingClaudeApiKey');
  const settingBaseUrl = document.getElementById('settingBaseUrl');
  const settingTemperature = document.getElementById('settingTemperature');
  const tempValue = document.getElementById('tempValue');
  const settingSystemPrompt = document.getElementById('settingSystemPrompt');
  const toast = document.getElementById('toast');
  const mobileModalBtn = document.getElementById('mobileModalBtn');
  const mobileModal = document.getElementById('mobileModal');
  const closeMobileModalBtn = document.getElementById('closeMobileModalBtn');
  const doneMobileModalBtn = document.getElementById('doneMobileModalBtn');
  const mobileQrContainer = document.getElementById('mobileQrContainer');
  const mobileUrlDisplay = document.getElementById('mobileUrlDisplay');
  const copyMobileUrlBtn = document.getElementById('copyMobileUrlBtn');
  const fullscreenToggleBtn = document.getElementById('fullscreenToggleBtn');

  // Account elements
  const userPill = document.getElementById('userPill');
  const sidebarUserName = document.getElementById('sidebarUserName');
  const sidebarUserInitial = document.getElementById('sidebarUserInitial');
  const sidebarUserRole = document.getElementById('sidebarUserRole');
  const accountModal = document.getElementById('accountModal');
  const closeAccountBtn = document.getElementById('closeAccountBtn');
  const saveAccountBtn = document.getElementById('saveAccountBtn');
  const accNameInput = document.getElementById('accNameInput');
  const accUsernameDisplay = document.getElementById('accUsernameDisplay');
  const accPasswordInput = document.getElementById('accPasswordInput');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const pwEyeIcon = document.getElementById('pwEyeIcon');
  const accountProfileDisplay = document.getElementById('accountProfileDisplay');
  const accountProfileBadge = document.getElementById('accountProfileBadge');
  const accountAvatarEmoji = document.getElementById('accountAvatarEmoji');
  const avatarPicker = document.getElementById('avatarPicker');
  const accountStatusMsg = document.getElementById('accountStatusMsg');
  const statChatsCount = document.getElementById('statChatsCount');
  const statProjectsCount = document.getElementById('statProjectsCount');
  const statPhotosCount = document.getElementById('statPhotosCount');

  // Multi-User Auth elements
  const accountLoggedInView = document.getElementById('accountLoggedInView');
  const accountGuestView = document.getElementById('accountGuestView');
  const accountModalHeading = document.getElementById('accountModalHeading');
  const accountSignOutBtn = document.getElementById('accountSignOutBtn');
  const tabBtnSignIn = document.getElementById('tabBtnSignIn');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const panelSignIn = document.getElementById('panelSignIn');
  const panelRegister = document.getElementById('panelRegister');
  const loginUsernameInput = document.getElementById('loginUsernameInput');
  const loginPasswordInput = document.getElementById('loginPasswordInput');
  const submitLoginBtn = document.getElementById('submitLoginBtn');
  const loginStatusMsg = document.getElementById('loginStatusMsg');
  const regNameInput = document.getElementById('regNameInput');
  const regUsernameInput = document.getElementById('regUsernameInput');
  const regPasswordInput = document.getElementById('regPasswordInput');
  const regAvatarPicker = document.getElementById('regAvatarPicker');
  const submitRegisterBtn = document.getElementById('submitRegisterBtn');
  const regStatusMsg = document.getElementById('regStatusMsg');

  // Project elements
  const projectSelectorBtn = document.getElementById('projectSelectorBtn');
  const projectDropdownMenu = document.getElementById('projectDropdownMenu');
  const currentProjectName = document.getElementById('currentProjectName');
  const projectListContainer = document.getElementById('projectListContainer');
  const addProjectBtn = document.getElementById('addProjectBtn');
  const manageProjectsBtn = document.getElementById('manageProjectsBtn');
  const topNavProjectBadge = document.getElementById('topNavProjectBadge');
  const topNavProjectName = document.getElementById('topNavProjectName');
  const projectModal = document.getElementById('projectModal');
  const projectModalTitle = document.getElementById('projectModalTitle');
  const closeProjectBtn = document.getElementById('closeProjectBtn');
  const cancelProjectBtn = document.getElementById('cancelProjectBtn');
  const saveProjectBtn = document.getElementById('saveProjectBtn');
  const deleteProjectBtn = document.getElementById('deleteProjectBtn');
  const projectNameInput = document.getElementById('projectNameInput');
  const projectDescInput = document.getElementById('projectDescInput');
  const projectInstructionsInput = document.getElementById('projectInstructionsInput');
  const projectFilesList = document.getElementById('projectFilesList');
  const projectNewFileName = document.getElementById('projectNewFileName');
  const projectNewFileContent = document.getElementById('projectNewFileContent');
  const addProjectDocBtn = document.getElementById('addProjectDocBtn');

  // Photo Lightbox elements
  const imageLightboxModal = document.getElementById('imageLightboxModal');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');

  // Voice Assistant Mode elements
  const voiceAssistantModeBtn = document.getElementById('voiceAssistantModeBtn');
  const voiceAssistantModal = document.getElementById('voiceAssistantModal');
  const closeVoiceAssistantBtn = document.getElementById('closeVoiceAssistantBtn');
  const voiceAssistantOrb = document.getElementById('voiceAssistantOrb');
  const voiceStatusText = document.getElementById('voiceStatusText');
  const voiceHintText = document.getElementById('voiceHintText');
  const voiceTranscriptContent = document.getElementById('voiceTranscriptContent');
  const voiceResponseCard = document.getElementById('voiceResponseCard');
  const voiceResponseContent = document.getElementById('voiceResponseContent');
  const voiceMicToggleBtn = document.getElementById('voiceMicToggleBtn');
  const voiceMicIcon = document.getElementById('voiceMicIcon');
  const voiceMicLabel = document.getElementById('voiceMicLabel');
  const voiceStopSpeakingBtn = document.getElementById('voiceStopSpeakingBtn');
  const voiceOpenSettingsBtn = document.getElementById('voiceOpenSettingsBtn');
  const voiceHttpsAlert = document.getElementById('voiceHttpsAlert');
  const voiceSwitchHttpsBtn = document.getElementById('voiceSwitchHttpsBtn');
  const voicePermissionAlert = document.getElementById('voicePermissionAlert');
  const voiceRetryMicBtn = document.getElementById('voiceRetryMicBtn');
  const voiceSendNowBtn = document.getElementById('voiceSendNowBtn');
  const voiceQuickInput = document.getElementById('voiceQuickInput');
  const voiceQuickSendBtn = document.getElementById('voiceQuickSendBtn');

  // Settings: Theme elements
  const settingsThemeDark = document.getElementById('settingsThemeDark');
  const settingsThemeLight = document.getElementById('settingsThemeLight');
  const settingsThemeSystem = document.getElementById('settingsThemeSystem');

  // Settings: Voice Changer elements
  const settingVoicePreset = document.getElementById('settingVoicePreset');
  const settingVoiceSelect = document.getElementById('settingVoiceSelect');
  const settingVoicePitch = document.getElementById('settingVoicePitch');
  const voicePitchVal = document.getElementById('voicePitchVal');
  const settingVoiceRate = document.getElementById('settingVoiceRate');
  const voiceRateVal = document.getElementById('voiceRateVal');
  const settingVoiceVolume = document.getElementById('settingVoiceVolume');
  const voiceVolumeVal = document.getElementById('voiceVolumeVal');
  const settingAutoSpeak = document.getElementById('settingAutoSpeak');
  const testVoiceBtn = document.getElementById('testVoiceBtn');

  // Short Video Lightbox elements
  const videoLightboxModal = document.getElementById('videoLightboxModal');
  const closeVideoLightboxBtn = document.getElementById('closeVideoLightboxBtn');
  const shortLightboxVideo = document.getElementById('shortLightboxVideo');
  const shortLightboxTitle = document.getElementById('shortLightboxTitle');
  const shortLightboxDownloadBtn = document.getElementById('shortLightboxDownloadBtn');

  // 24/7 Server & Connection Watchdog elements
  const connectionLostBanner = document.getElementById('connectionLostBanner');
  const connBannerText = document.getElementById('connBannerText');
  const connRetryBtn = document.getElementById('connRetryBtn');
  const server247Badge = document.getElementById('server247Badge');
  const statWatchdogText = document.getElementById('statWatchdogText');
  const statAutostartText = document.getElementById('statAutostartText');
  const settingLocalWifiUrl = document.getElementById('settingLocalWifiUrl');
  const copyLocalWifiBtn = document.getElementById('copyLocalWifiBtn');
  const settingPublicHttpsUrl = document.getElementById('settingPublicHttpsUrl');
  const copyPublicHttpsBtn = document.getElementById('copyPublicHttpsBtn');
  const forceReconnectTunnelBtn = document.getElementById('forceReconnectTunnelBtn');
  const tunnelReconnectMeta = document.getElementById('tunnelReconnectMeta');
  const settingCustomTunnelToken = document.getElementById('settingCustomTunnelToken');
  const settingCustomTunnelDomain = document.getElementById('settingCustomTunnelDomain');
  const saveTunnelConfigBtn = document.getElementById('saveTunnelConfigBtn');
  const toggleAutostartBtn = document.getElementById('toggleAutostartBtn');

  // --- Initializer ---
  function init() {
    try { initSplashScreen(); } catch (e) { console.error('initSplashScreen error', e); }
    try { loadSettings(); } catch (e) { console.error('loadSettings error', e); }
    try { applyDisplaySettings(); initThinkingUI(); } catch (e) { console.error('display settings error', e); }
    try { initComposerLayout(); } catch (e) { console.error('composer layout error', e); }
    try { loadTheme(); } catch (e) { console.error('loadTheme error', e); }
    try { setupMarkdownRenderer(); } catch (e) { console.error('setupMarkdownRenderer error', e); }
    try { setupSpeechRecognition(); } catch (e) { console.error('setupSpeechRecognition error', e); }
    try { attachEventListeners(); } catch (e) { console.error('attachEventListeners error', e); }
    try { fetchModels(); } catch (e) { console.error('fetchModels error', e); }
    try { fetchTunnelStatus(); } catch (e) { console.error('fetchTunnelStatus error', e); }
    try { initConnectionHealthHeartbeat(); } catch (e) { console.error('initConnectionHealthHeartbeat error', e); }

    try { startAuthFlow(); } catch (e) { console.error('startAuthFlow error', e); }
  }

  function initSplashScreen() {
    const splash = document.getElementById('appSplashScreen');
    if (!splash) return;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      splash.classList.add('splash-fading');
      setTimeout(() => {
        splash.classList.add('splash-hidden');
      }, 650);
    };

    // Auto-dismiss after 1.7s
    const timer = setTimeout(dismiss, 1700);

    // Fast skip on click or touch
    splash.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss();
    });
    splash.addEventListener('touchstart', () => {
      clearTimeout(timer);
      dismiss();
    }, { passive: true });
  }

  // --- Theme Management ---
  function loadTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    let effective = theme;
    if (theme === 'system') {
      effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    const isDark = effective === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', isDark ? '#07041a' : '#f5f1ff');

    const moon = themeToggleBtn ? themeToggleBtn.querySelector('.moon-icon') : null;
    const sun = themeToggleBtn ? themeToggleBtn.querySelector('.sun-icon') : null;
    if (moon && sun) {
      moon.style.display = isDark ? 'inline-block' : 'none';
      sun.style.display = isDark ? 'none' : 'inline-block';
    }

    const hljsTheme = document.getElementById('hljs-theme');
    if (hljsTheme) {
      hljsTheme.href = isDark 
        ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
        : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    }

    // Update settings theme card buttons
    if (settingsThemeDark && settingsThemeLight && settingsThemeSystem) {
      settingsThemeDark.classList.toggle('active', theme === 'dark');
      settingsThemeLight.classList.toggle('active', theme === 'light');
      settingsThemeSystem.classList.toggle('active', theme === 'system');
    }

    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    settings.theme = theme;
  }

  function toggleTheme() {
    const current = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // --- Settings & Voice Changer ---
  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) {
        settings = Object.assign(settings, JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to parse settings', e);
    }

    const storedModel = localStorage.getItem(STORAGE_KEYS.CURRENT_MODEL);
    if (storedModel && storedModel === 'kazai') {
      currentModel = storedModel;
    } else {
      currentModel = 'kazai';
      localStorage.setItem(STORAGE_KEYS.CURRENT_MODEL, 'kazai');
    }
  }

  function saveSettings() {
    if (settingApiKey) settings.apiKey = settingApiKey.value.trim();
    if (settingGeminiApiKey) settings.geminiApiKey = settingGeminiApiKey.value.trim();
    if (settingClaudeApiKey) settings.claudeApiKey = settingClaudeApiKey.value.trim();
    if (settingBaseUrl) settings.baseUrl = settingBaseUrl.value.trim();
    if (settingTemperature) settings.temperature = parseFloat(settingTemperature.value);
    if (settingSystemPrompt) settings.systemPrompt = settingSystemPrompt.value.trim();

    // Voice Changer settings
    if (settingVoicePreset) settings.voicePreset = settingVoicePreset.value;
    if (settingVoiceSelect) settings.voiceURI = settingVoiceSelect.value;
    if (settingVoicePitch) settings.voicePitch = parseFloat(settingVoicePitch.value);
    if (settingVoiceRate) settings.voiceRate = parseFloat(settingVoiceRate.value);
    if (settingVoiceVolume) settings.voiceVolume = parseInt(settingVoiceVolume.value, 10);
    if (settingAutoSpeak) settings.autoSpeak = settingAutoSpeak.checked;

    collectNewSettings();
    applyDisplaySettings();
    syncThinkUI();
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    closeSettings();
    showToast('Settings & Voice preferences saved successfully');
  }

  function openSettings() {
    if (settingApiKey) settingApiKey.value = settings.apiKey || '';
    if (settingGeminiApiKey) settingGeminiApiKey.value = settings.geminiApiKey || '';
    if (settingClaudeApiKey) settingClaudeApiKey.value = settings.claudeApiKey || '';
    if (settingBaseUrl) settingBaseUrl.value = settings.baseUrl || '';
    if (settingTemperature) settingTemperature.value = settings.temperature || 0.7;
    if (tempValue) tempValue.textContent = settings.temperature || '0.7';
    if (settingSystemPrompt) settingSystemPrompt.value = settings.systemPrompt || '';

    // Theme cards in settings
    const activeTheme = settings.theme || localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    if (settingsThemeDark && settingsThemeLight && settingsThemeSystem) {
      settingsThemeDark.classList.toggle('active', activeTheme === 'dark');
      settingsThemeLight.classList.toggle('active', activeTheme === 'light');
      settingsThemeSystem.classList.toggle('active', activeTheme === 'system');
    }

    // Voice Changer controls
    if (settingVoicePreset) settingVoicePreset.value = settings.voicePreset || 'studio';
    if (settingVoicePitch) {
      settingVoicePitch.value = settings.voicePitch !== undefined ? settings.voicePitch : 1.0;
      if (voicePitchVal) voicePitchVal.textContent = settingVoicePitch.value;
    }
    if (settingVoiceRate) {
      settingVoiceRate.value = settings.voiceRate !== undefined ? settings.voiceRate : 1.0;
      if (voiceRateVal) voiceRateVal.textContent = settingVoiceRate.value;
    }
    if (settingVoiceVolume) {
      settingVoiceVolume.value = settings.voiceVolume !== undefined ? settings.voiceVolume : 100;
      if (voiceVolumeVal) voiceVolumeVal.textContent = settingVoiceVolume.value;
    }
    if (settingAutoSpeak) settingAutoSpeak.checked = !!settings.autoSpeak;

    populateNewSettings();
    populateVoiceList();
    fetchTunnelStatus();
    settingsModal.style.display = 'flex';
  }

  // --- 24/7 Server, Watchdog & Persistent Tunnel Management ---
  let isCurrentlyDisconnected = false;

  async function fetchTunnelStatus() {
    try {
      const res = await fetch('/api/tunnel-status');
      if (!res.ok) return;
      const data = await res.json();

      if (settingLocalWifiUrl) settingLocalWifiUrl.value = data.local_url || `http://${data.ip}:8000`;
      if (settingPublicHttpsUrl) settingPublicHttpsUrl.value = data.url || 'Initializing tunnel connector...';
      
      if (statWatchdogText) {
        if (data.status === 'online') {
          statWatchdogText.textContent = `Active • 0 drops (Pinging every 15s)`;
          statWatchdogText.style.color = '#4ade80';
        } else if (data.status === 'recovering') {
          statWatchdogText.textContent = `Auto-healing connector now...`;
          statWatchdogText.style.color = '#f59e0b';
        } else {
          statWatchdogText.textContent = `Active (Auto-heals on drops)`;
          statWatchdogText.style.color = 'var(--text-secondary)';
        }
      }

      if (statAutostartText) {
        statAutostartText.textContent = data.autostart_enabled 
          ? 'Enabled (Starts on boot)' 
          : 'Disabled (Click toggle to enable)';
        statAutostartText.style.color = data.autostart_enabled ? '#4ade80' : 'var(--text-secondary)';
      }

      if (server247Badge) {
        server247Badge.textContent = data.status === 'online' ? '🟢 Online 24/7' : '🟡 Reconnecting';
      }

      if (tunnelReconnectMeta) {
        tunnelReconnectMeta.textContent = data.is_permanent 
          ? 'Permanent Custom Domain active (Fixed address forever).'
          : `Self-healing active: ${data.reconnect_count} drops automatically recovered.`;
      }

      if (settingCustomTunnelDomain && !settingCustomTunnelDomain.value) {
        settingCustomTunnelDomain.value = data.custom_domain || '';
      }
      if (settingCustomTunnelToken && data.custom_token_configured && !settingCustomTunnelToken.value) {
        settingCustomTunnelToken.placeholder = '•••••••••••••••• (Configured)';
      }

    } catch (e) {
      console.warn('fetchTunnelStatus error:', e);
    }
  }

  function initConnectionHealthHeartbeat() {
    setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          if (isCurrentlyDisconnected) {
            isCurrentlyDisconnected = false;
            if (connectionLostBanner) connectionLostBanner.classList.add('hidden');
            showToast('⚡ Reconnected to Nova Insight successfully!');
          }
        } else {
          handleConnectionLoss();
        }
      } catch (err) {
        handleConnectionLoss();
      }
    }, 15000);
  }

  function handleConnectionLoss() {
    if (!isCurrentlyDisconnected) {
      isCurrentlyDisconnected = true;
      if (connectionLostBanner) {
        connectionLostBanner.classList.remove('hidden');
        if (connBannerText) connBannerText.textContent = '📡 Connection interrupted. Auto-reconnecting to Nova Insight...';
      }
    }
  }

  function populateVoiceList() {
    if (!window.speechSynthesis || !settingVoiceSelect) return;
    const voices = window.speechSynthesis.getVoices();
    settingVoiceSelect.innerHTML = '<option value="">Default AI Voice</option>';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' [Default]' : ''}`;
      if (settings.voiceURI && v.voiceURI === settings.voiceURI) {
        opt.selected = true;
      }
      settingVoiceSelect.appendChild(opt);
    });
  }

  function applyVoicePreset(preset) {
    settings.voicePreset = preset;
    if (preset === 'robot') {
      settings.voicePitch = 0.6;
      settings.voiceRate = 0.9;
    } else if (preset === 'jarvis') {
      settings.voicePitch = 0.8;
      settings.voiceRate = 0.95;
    } else if (preset === 'friendly') {
      settings.voicePitch = 1.25;
      settings.voiceRate = 1.05;
    } else if (preset === 'speedy') {
      settings.voicePitch = 1.05;
      settings.voiceRate = 1.35;
    } else if (preset === 'studio') {
      settings.voicePitch = 1.0;
      settings.voiceRate = 1.0;
    }
    if (settingVoicePitch) {
      settingVoicePitch.value = settings.voicePitch;
      if (voicePitchVal) voicePitchVal.textContent = settings.voicePitch;
    }
    if (settingVoiceRate) {
      settingVoiceRate.value = settings.voiceRate;
      if (voiceRateVal) voiceRateVal.textContent = settings.voiceRate;
    }
  }

  function testVoiceSample() {
    const previewText = "Hello! I am Nova Insight, created and engineered by KaztryxAV. All voice systems are fully operational.";
    speakWithVoiceChanger(previewText);
  }

  function closeSettings() {
    settingsModal.style.display = 'none';
  }

  // --- Mobile Modal ---
  async function openMobileModal() {
    if (!mobileModal) return;
    mobileModal.style.display = 'flex';
    try {
      const res = await fetch('/api/mobile-info');
      if (res.ok) {
        const data = await res.json();
        if (mobileUrlDisplay && data.url) mobileUrlDisplay.textContent = data.url;
        if (mobileQrContainer && data.qr_svg) {
          mobileQrContainer.innerHTML = data.qr_svg;
        }
      }
    } catch (e) {
      console.warn('Could not fetch mobile info', e);
    }
  }

  function closeMobileModal() {
    if (mobileModal) mobileModal.style.display = 'none';
  }

  // --- Models ---
  async function fetchModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        modelsList = data.models || [];
        renderModelDropdown();
        updateModelUI(currentModel);
      }
    } catch (e) {
      console.warn('Could not fetch models from server, using fallback', e);
      modelsList = [
        { id: 'kazai', name: 'Nova Insight', badge: 'Unified AI', description: 'All-in-one unified intelligence: conversation, deep reasoning, coding, and photo generation combined' }
      ];
      renderModelDropdown();
      updateModelUI(currentModel);
    }
  }

  function renderModelDropdown() {
    if (!modelOptionsList) return;
    modelOptionsList.innerHTML = '';
    modelsList.forEach(m => {
      const item = document.createElement('div');
      item.className = `model-option-item ${m.id === currentModel ? 'selected' : ''}`;
      item.innerHTML = `
        <div class="model-opt-header">
          <span class="model-opt-name">${escapeHtml(m.name)}</span>
          <span class="model-badge">${escapeHtml(m.badge || '')}</span>
        </div>
        <div class="model-opt-desc">${escapeHtml(m.description || '')}</div>
      `;
      item.addEventListener('click', () => {
        selectModel(m.id);
        if (modelDropdownMenu) modelDropdownMenu.classList.remove('active');
      });
      modelOptionsList.appendChild(item);
    });
  }

  function selectModel(modelId) {
    currentModel = modelId;
    localStorage.setItem(STORAGE_KEYS.CURRENT_MODEL, modelId);
    updateModelUI(modelId);
    renderModelDropdown();
  }

  function updateModelUI(modelId) {
    const found = modelsList.find(m => m.id === modelId) || { name: 'Nova Insight', badge: 'Unified AI' };
    if (currentModelName) currentModelName.textContent = found.name;
    if (currentModelBadge) currentModelBadge.textContent = found.badge || '';
  }

  // --- Markdown Setup ---
  function setupMarkdownRenderer() {
    try {
      if (window.marked && typeof window.marked.setOptions === 'function') {
        window.marked.setOptions({
          breaks: true,
          gfm: true
        });
      }
    } catch (e) {
      console.warn('Could not set marked options', e);
    }
  }

  function renderMarkdownWithCodeBlocks(rawText) {
    if (!rawText) return '';
    try {
      // Check for <think> tags (Reasoning models)
      let processed = rawText;
      let thinkingHtml = '';

      const thinkMatch = processed.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        const thinkContent = escapeHtml(thinkMatch[1].trim());
        thinkingHtml = `
          <div class="thinking-block">
            <div class="thinking-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
              <div class="title-wrap">
                <span>🧠</span>
                <span>Reasoning Process (click to toggle)</span>
              </div>
              <span>▾</span>
            </div>
            <div class="thinking-content" style="display: none;">${thinkContent}</div>
          </div>
        `;
        processed = processed.replace(/<think>[\s\S]*?<\/think>/i, '');
      }

      let parsedHtml = '';
      if (window.marked) {
        try {
          if (typeof window.marked.parse === 'function') {
            parsedHtml = window.marked.parse(processed);
          } else if (typeof window.marked === 'function') {
            parsedHtml = window.marked(processed);
          }
        } catch (e) {
          console.warn('Marked parse error', e);
        }
      }

      if (!parsedHtml) {
        parsedHtml = escapeHtml(processed)
          .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
      }

      // Post-process pre/code blocks to add custom header and copy button
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = parsedHtml;

      const preElements = tempDiv.querySelectorAll('pre');
      preElements.forEach((pre) => {
        const codeEl = pre.querySelector('code');
        const langClass = codeEl ? codeEl.className : '';
        let lang = 'code';
        const match = langClass.match(/language-(\w+)/);
        if (match) lang = match[1];

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = `
          <span>${lang}</span>
          <button class="copy-code-btn" type="button" onclick="const code = this.closest('.code-block-wrapper').querySelector('code'); if(code) { navigator.clipboard.writeText(code.innerText); this.innerHTML='<span style=\\'color:#10a37f\\'>✓ Copied!</span>'; setTimeout(() => { this.innerHTML='Copy code'; }, 2000); }">
            <span>Copy code</span>
          </button>
        `;

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
      });

      // KaTeX auto rendering if loaded
      if (window.renderMathInElement) {
        try {
          renderMathInElement(tempDiv, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false }
            ],
            throwOnError: false
          });
        } catch (err) {
          console.warn('KaTeX rendering error', err);
        }
      }

      return thinkingHtml + tempDiv.innerHTML;
    } catch (err) {
      console.error('renderMarkdownWithCodeBlocks error', err);
      return escapeHtml(rawText).replace(/\n/g, '<br>');
    }
  }

  // --- Conversations Management ---
  function loadConversations() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
      if (stored) {
        conversations = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to parse conversations', e);
      conversations = [];
    }
    renderSidebarHistory();
  }

  function saveConversations() {
    // Transient fields (_v = frames for the vision model, loading) are never saved.
    const replacer = (k, v) => (k === '_v' || k === 'loading') ? undefined : v;
    let saved = false;
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations, replacer));
      saved = true;
    } catch (e) {
      // Browser storage is full (photos take space): drop the picture previews of the oldest messages first.
      const previews = [];
      conversations.slice().sort((x, y) => (x.updatedAt || 0) - (y.updatedAt || 0)).forEach(c => {
        c.messages.forEach(m => (m.attachments || []).forEach(at => { if (at.thumb) previews.push(at); }));
      });
      while (!saved && previews.length) {
        delete previews.shift().thumb;
        try {
          localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations, replacer));
          saved = true;
        } catch (e2) { /* keep trimming */ }
      }
      if (!saved) showToast('Your browser storage is full, so recent chats may not be saved');
    }
    renderSidebarHistory();
  }

  function getActiveConversation() {
    return conversations.find(c => c.id === activeConversationId);
  }

  function createNewConversation(projectId) {
    const newId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newConv = {
      id: newId,
      title: 'New chat',
      projectId: (typeof projectId === 'string' && projectId) ? projectId : 'proj-default',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    conversations.unshift(newConv);
    saveConversations();
    selectConversation(newId);
    if (typeof updateAccountStats === 'function') updateAccountStats();
  }

  function selectConversation(id) {
    // A reply that is still being written keeps going in the background when you switch chats.
    activeConversationId = id;
    syncActiveProject();
    // On phones the sidebar is a drawer: close it once a chat is chosen (and keep it closed when the app opens).
    if (window.innerWidth <= 768) appLayout.classList.add('sidebar-collapsed');
    renderSidebarHistory();
    renderChatFeed();
    playFeedSwitchAnim();
    messageInput.focus();
  }

  function deleteConversation(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat?')) return;

    conversations = conversations.filter(c => c.id !== id);
    saveConversations();

    if (activeConversationId === id) {
      if (conversations.length > 0) {
        selectConversation(conversations[0].id);
      } else {
        createNewConversation();
      }
    }
  }

  function renameConversation(id, event) {
    if (event) event.stopPropagation();
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    const newTitle = prompt('Enter a new title for this chat:', conv.title);
    if (newTitle && newTitle.trim()) {
      conv.title = newTitle.trim();
      conv.updatedAt = Date.now();
      saveConversations();
    }
  }

  function clearAllConversations() {
    if (!confirm('This will permanently delete all chat history. Are you sure?')) return;
    conversations = [];
    saveConversations();
    createNewConversation();
    closeSettings();
    showToast('All conversations deleted');
  }

  // --- Sidebar Render ---
  // One row in the chat list (used for normal chats and for chats inside a project).
  function makeChatItem(c, showProjectTag) {
    const item = document.createElement('div');
    item.className = `chat-history-item ${c.id === activeConversationId ? 'active' : ''}`;
    item.dataset.convId = c.id;
    const proj = showProjectTag ? projectOf(c) : null;
    item.innerHTML = `
      <span class="chat-title-text" title="${escapeHtml(c.title)}">${proj ? `<span class="chat-proj-tag" title="${escapeHtml(proj.name)}">📁</span> ` : ''}${escapeHtml(c.title)}</span>
      <div class="chat-item-actions">
        <button class="chat-item-action-btn move-btn" title="Move to project">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
        </button>
        <button class="chat-item-action-btn edit-btn" title="Rename chat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          </svg>
        </button>
        <button class="chat-item-action-btn delete-btn" title="Delete chat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
          </svg>
        </button>
      </div>
    `;
    item.addEventListener('click', () => selectConversation(c.id));
    item.querySelector('.move-btn').addEventListener('click', (e) => { e.stopPropagation(); openMoveMenu(e.currentTarget, c.id); });
    item.querySelector('.edit-btn').addEventListener('click', (e) => renameConversation(c.id, e));
    item.querySelector('.delete-btn').addEventListener('click', (e) => deleteConversation(c.id, e));
    return item;
  }

  function renderSidebarHistory(filterQuery = '') {
    chatHistoryContainer.innerHTML = '';
    renderProjectsSidebar(filterQuery);

    // Chats inside a project are listed under that project (like ChatGPT); the rest are listed here.
    // While searching, every chat is searched.
    let filtered = filterQuery ? conversations : conversations.filter(c => !projectOf(c));

    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.title.toLowerCase().includes(q) ||
        c.messages.some(m => m.content.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      chatHistoryContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          ${filterQuery ? 'No chats found' : 'No chats yet'}
        </div>
      `;
      return;
    }

    // Group chats into Today, Yesterday, Previous 7 Days, Older
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const pastWeek = today - (7 * 86400000);

    const groups = {
      today: { title: 'Today', items: [] },
      yesterday: { title: 'Yesterday', items: [] },
      pastWeek: { title: 'Previous 7 Days', items: [] },
      older: { title: 'Older', items: [] }
    };

    filtered.forEach(c => {
      const time = c.updatedAt || c.createdAt;
      if (time >= today) groups.today.items.push(c);
      else if (time >= yesterday) groups.yesterday.items.push(c);
      else if (time >= pastWeek) groups.pastWeek.items.push(c);
      else groups.older.items.push(c);
    });

    Object.values(groups).forEach(grp => {
      if (grp.items.length === 0) return;

      const titleEl = document.createElement('div');
      titleEl.className = 'history-section-title';
      titleEl.textContent = grp.title;
      chatHistoryContainer.appendChild(titleEl);

      grp.items.forEach(c => chatHistoryContainer.appendChild(makeChatItem(c, !!filterQuery)));
    });
  }

  // --- Render Chat Messages Feed ---
  function renderChatFeed() {
    const conv = getActiveConversation();
    if (!conv || conv.messages.length === 0) {
      welcomeContainer.style.display = 'flex';
      messagesContainer.innerHTML = '';
      return;
    }

    welcomeContainer.style.display = 'none';
    messagesContainer.innerHTML = '';

    conv.messages.forEach((msg, idx) => {
      appendMessageToDOM(msg, idx);
    });

    scrollToBottom();
  }

  function playFeedSwitchAnim() {
    const el = messagesContainer;
    if (!el) return;
    el.classList.remove('feed-switch');
    void el.offsetWidth;
    el.classList.add('feed-switch');
  }

  function appendMessageToDOM(msg, index, animate) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}${animate ? ' row-enter' : ''}`;
    row.id = `msg_${index}`;

    if (msg.role === 'user') {
      const attHtml = renderUserAttachmentsHtml(msg);
      row.innerHTML = `
        <div class="message-bubble user${attHtml ? ' has-media' : ''}">
          ${attHtml}
          ${msg.content ? `<div>${escapeHtml(msg.content)}</div>` : ''}
        </div>
      `;
      row.querySelectorAll('.msg-media-item').forEach(btn => {
        btn.addEventListener('click', () => openMediaPreview(getMsgAttachments(msg)[+btn.dataset.idx]));
      });
    } else {
      // Assistant
      const avatarSvg = `
        <div class="assistant-avatar"><img src="/static/icon-192.png" alt="Nova Insight"></div>
      `;

      const formattedHtml = renderMarkdownWithCodeBlocks(msg.content);

      row.innerHTML = `
        ${avatarSvg}
        <div class="message-bubble assistant">
          <div class="assistant-text-content">${formattedHtml}</div>
          <div class="message-actions-bar">
            <button class="msg-action-btn copy-msg-btn" title="Copy response">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
            </button>
            <button class="msg-action-btn speak-msg-btn" title="Read aloud">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            </button>
            <button class="msg-action-btn regen-msg-btn" title="Regenerate response">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            </button>
            <button class="msg-action-btn thumb-up-btn" title="Good response">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M7 10v12"/>
                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
              </svg>
            </button>
            <button class="msg-action-btn thumb-down-btn" title="Bad response">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 14V2"/>
                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Attach actions
      const copyBtn = row.querySelector('.copy-msg-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(msg.content);
        showToast('Response copied to clipboard');
      });

      const speakBtn = row.querySelector('.speak-msg-btn');
      speakBtn.addEventListener('click', () => toggleSpeech(msg.content, speakBtn));

      const regenBtn = row.querySelector('.regen-msg-btn');
      regenBtn.addEventListener('click', () => regenerateLastResponse());

      const thumbUp = row.querySelector('.thumb-up-btn');
      const thumbDown = row.querySelector('.thumb-down-btn');
      thumbUp.addEventListener('click', () => {
        thumbUp.classList.toggle('active');
        thumbDown.classList.remove('active');
      });
      thumbDown.addEventListener('click', () => {
        thumbDown.classList.toggle('active');
        thumbUp.classList.remove('active');
      });

      // Photo Lightbox click handler
      row.querySelectorAll('.assistant-text-content img').forEach(img => {
        img.addEventListener('click', () => openImageLightbox(img.src));
      });
    }

    messagesContainer.appendChild(row);
  }

  // --- Nova Insight: fade-in text while a reply streams in ---
  // Every re-render replaces the DOM, so words that were already on screen are shown instantly and
  // only the newly arrived words fade in (with a tiny stagger). Code blocks are left untouched.
  function fadeInNewWords(root, alreadyShown) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent && parent.closest('pre, code, script, style')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    let index = 0;
    let fresh = 0;
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          continue;
        }
        const span = document.createElement('span');
        span.className = 'nova-word';
        span.textContent = part;
        if (index >= alreadyShown) {
          span.classList.add('nova-fade');
          span.style.animationDelay = Math.min(fresh * 28, 420) + 'ms';
          fresh++;
        }
        frag.appendChild(span);
        index++;
      }
      node.parentNode.replaceChild(frag, node);
    }
    return index;
  }

  function renderStreamingReply(el, content, state) {
    el.innerHTML = renderMarkdownWithCodeBlocks(content);
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && settings.fadeText !== false && content.length < 15000) {
      state.revealed = fadeInNewWords(el, state.revealed);
    }
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    el.appendChild(cursor);
  }

  // --- Thinking level, AI chat titles, display options, export ---
  const THINK_LEVELS = {
    instant: { icon: '⚡', label: 'Instant' },
    moderate: { icon: '🧠', label: 'Moderate' },
    resourced: { icon: '🔬', label: 'Resourced' }
  };

  function persistSettings() {
    try { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); } catch (e) {}
  }

  function setThinkingStatus(el, text) {
    if (!el || !text) return;
    el.innerHTML = '<span class="think-status">' + escapeHtml(text) + '<span class="think-dots"><i></i><i></i><i></i></span></span>';
  }

  function syncThinkUI() {
    const level = THINK_LEVELS[settings.thinkingLevel] ? settings.thinkingLevel : 'moderate';
    const info = THINK_LEVELS[level];
    const icon = document.getElementById('thinkBtnIcon');
    const label = document.getElementById('thinkBtnLabel');
    if (icon) icon.textContent = info.icon;
    if (label) label.textContent = info.label;
    document.querySelectorAll('#thinkMenu .think-opt').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-level') === level);
    });
    const sel = document.getElementById('settingThinkingLevel');
    if (sel) sel.value = level;
  }

  function setThinkingLevel(level) {
    if (!THINK_LEVELS[level]) return;
    settings.thinkingLevel = level;
    persistSettings();
    syncThinkUI();
    showToast('Thinking level: ' + THINK_LEVELS[level].label);
  }

  function initThinkingUI() {
    const wrap = document.getElementById('thinkWrap');
    const btn = document.getElementById('thinkBtn');
    const menu = document.getElementById('thinkMenu');
    syncThinkUI();
    if (!wrap || !btn || !menu) return;
    const close = () => { menu.style.display = 'none'; wrap.classList.remove('open'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.style.display === 'none';
      menu.style.display = open ? 'block' : 'none';
      wrap.classList.toggle('open', open);
    });
    menu.querySelectorAll('.think-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        setThinkingLevel(opt.getAttribute('data-level'));
        close();
      });
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target) && !menu.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function applyDisplaySettings() {
    const b = document.body;
    ['small', 'medium', 'large', 'xlarge'].forEach(s => b.classList.remove('fs-' + s));
    b.classList.add('fs-' + (settings.fontSize || 'medium'));
    ['narrow', 'normal', 'wide'].forEach(s => b.classList.remove('cw-' + s));
    b.classList.add('cw-' + (settings.chatWidth || 'normal'));
    b.classList.toggle('compact-chat', !!settings.compact);
  }

  function populateNewSettings() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setVal('settingThinkingLevel', THINK_LEVELS[settings.thinkingLevel] ? settings.thinkingLevel : 'moderate');
    setVal('settingResponseLength', settings.responseLength || 'balanced');
    setVal('settingTone', settings.tone || 'default');
    setVal('settingNickname', settings.nickname || '');
    setVal('settingFontSize', settings.fontSize || 'medium');
    setVal('settingChatWidth', settings.chatWidth || 'normal');
    setChk('settingAiTitles', settings.aiTitles !== false);
    setChk('settingFadeText', settings.fadeText !== false);
    setChk('settingCompact', settings.compact);
    setChk('settingEnterToSend', settings.enterToSend !== false);
    setChk('settingAutoScroll', settings.autoScroll !== false);
  }

  function collectNewSettings() {
    const getVal = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };
    const getChk = (id, d) => { const el = document.getElementById(id); return el ? el.checked : d; };
    settings.thinkingLevel = getVal('settingThinkingLevel', settings.thinkingLevel);
    settings.responseLength = getVal('settingResponseLength', settings.responseLength);
    settings.tone = getVal('settingTone', settings.tone);
    settings.nickname = getVal('settingNickname', settings.nickname).trim().slice(0, 40);
    settings.fontSize = getVal('settingFontSize', settings.fontSize);
    settings.chatWidth = getVal('settingChatWidth', settings.chatWidth);
    settings.aiTitles = getChk('settingAiTitles', settings.aiTitles);
    settings.fadeText = getChk('settingFadeText', settings.fadeText);
    settings.compact = getChk('settingCompact', settings.compact);
    settings.enterToSend = getChk('settingEnterToSend', settings.enterToSend);
    settings.autoScroll = getChk('settingAutoScroll', settings.autoScroll);
  }

  // After the first reply finishes, ask the AI for a short title for the chat (like ChatGPT).
  // The engine is free and sometimes busy, so we retry a few times before giving up for now;
  // the next reply in the same chat tries again.
  const _titleBusy = new Set();
  function _titleSource(conv) {
    const u = conv.messages.find(m => m.role === 'user' && ((m.content && m.content.trim()) || getMsgAttachments(m).length));
    if (!u) return null;
    const a = conv.messages.find(m => m.role === 'assistant' && m.content && m.content.trim() &&
      !/^\s*(\u26a0|error|connection|sorry, something)/i.test(m.content) && !/\(Generation stopped\)/.test(m.content));
    if (!a) return null;
    let plain = a.content.replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/```[\s\S]*?```/g, ' code ').replace(/\s+/g, ' ').trim();
    if (!plain && /!\[|<img|<video|\.mp4/i.test(a.content)) plain = '(generated an image or video for the user)';
    const ua = getMsgAttachments(u)[0];
    let userText = (u.content || '').trim();
    if (ua && (ua.kind === 'image' || ua.kind === 'video')) {
      const what = ua.kind === 'video' ? 'video' : 'photo';
      userText = (userText ? userText + ' ' : 'Shared a ' + what + '. ') + '[' + what + (ua.caption ? ': ' + ua.caption.slice(0, 160) : '') + ']';
    } else if (!userText && ua) {
      userText = 'Shared a file: ' + ua.name;
    }
    return { user: userText.slice(0, 600), assistant: plain.slice(0, 600) };
  }

  // Types the new title out letter by letter in the sidebar (skipped if reduced motion is on).
  function typeTitleInSidebar(convId, title) {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      document.querySelectorAll('.chat-history-item[data-conv-id="' + convId + '"] .chat-title-text').forEach(span => {
        let node = span.lastChild;
        if (!node || node.nodeType !== 3) return;
        node.nodeValue = '';
        let i = 0;
        const step = Math.max(1, Math.ceil(title.length / 28));
        const timer = setInterval(() => {
          i = Math.min(title.length, i + step);
          if (!node.parentNode) { clearInterval(timer); return; }
          node.nodeValue = title.slice(0, i);
          if (i >= title.length) clearInterval(timer);
        }, 28);
      });
    } catch (e) { /* the title is already saved; animation is optional */ }
  }

  async function maybeGenerateTitle(conv) {
    try {
      if (!conv || settings.aiTitles === false || conv.aiTitled || _titleBusy.has(conv.id)) return;
      if ((conv.titleTries || 0) >= 4) return;
      const src = _titleSource(conv);
      if (!src) return;
      _titleBusy.add(conv.id);
      conv.titleTries = (conv.titleTries || 0) + 1;
      const autoTitle = conv.title;
      let title = '';
      for (let attempt = 0; attempt < 3 && !title; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, attempt * 3000));
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 32000);
        try {
          const res = await fetch('/api/title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(src),
            signal: ctl.signal
          });
          if (res.ok) title = ((await res.json()).title || '').trim();
        } catch (e) { /* retry */ }
        clearTimeout(t);
      }
      _titleBusy.delete(conv.id);
      if (!title) { saveConversations(); return; }
      conv.aiTitled = true;
      // If you renamed the chat while the title was being written, keep your name.
      if (conv.title !== autoTitle) { saveConversations(); return; }
      conv.title = title;
      saveConversations();
      renderSidebarHistory(chatSearchInput ? chatSearchInput.value : '');
      typeTitleInSidebar(conv.id, title);
    } catch (e) {
      _titleBusy.delete(conv && conv.id);
      console.warn('Title generation skipped', e);
    }
  }

  function exportChats() {
    try {
      const payload = {
        app: 'Nova Insight',
        exportedAt: new Date().toISOString(),
        account: userAccount && userAccount.username ? userAccount.username : '',
        conversations: conversations
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nova-insight-chats-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Chats exported');
    } catch (e) {
      showToast('Could not export chats');
    }
  }

  // --- Send Message & Streaming ---
  async function sendMessage(textOverride = null) {
    if (isStreaming) {
      showToast('Nova is still replying. Tap the stop button to cancel it.');
      return;
    }

    const text = (textOverride || messageInput.value).trim();
    if (!text && !pendingAttachments.length) return;
    if (pendingAttachments.some(at => at.loading)) {
      showToast('Still preparing your attachment...');
      return;
    }

    let conv = getActiveConversation();
    if (!conv) {
      createNewConversation();
      conv = getActiveConversation();
    }

    // Hide welcome state
    welcomeContainer.style.display = 'none';

    // Build user message
    const userMsg = {
      role: 'user',
      content: text,
      timestamp: Date.now()
    };
    if (pendingAttachments.length) {
      userMsg.attachments = pendingAttachments.slice();
      clearAttachment();
    }

    conv.messages.push(userMsg);

    // Auto rename conversation from first message
    if (conv.messages.length === 1 && conv.title === 'New chat') {
      let _t = text.replace(/\s+/g, ' ').trim();
      if (_t.length > 34) { _t = _t.slice(0, 34); const sp = _t.lastIndexOf(' '); if (sp > 14) _t = _t.slice(0, sp); }
      const _ua = getMsgAttachments(userMsg)[0];
      conv.title = _t || (_ua ? (_ua.kind === 'video' ? 'Shared video' : _ua.kind === 'image' ? 'Shared photo' : String(_ua.name || 'Shared file').slice(0, 30)) : 'New chat');
    }
    conv.updatedAt = Date.now();
    saveConversations();

    // Reset input
    messageInput.value = '';
    adjustTextareaHeight();
    updateSendButtonState();

    // Render user message to DOM
    appendMessageToDOM(userMsg, conv.messages.length - 1, true);
    scrollToBottom(true);

    // Prepare Assistant placeholder
    const assistantMsg = {
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };
    conv.messages.push(assistantMsg);
    const assistantIdx = conv.messages.length - 1;

    // Create Assistant DOM element
    const assistantRow = document.createElement('div');
    assistantRow.className = 'message-row assistant row-enter';
    assistantRow.id = `msg_${assistantIdx}`;
    assistantRow.innerHTML = `
      <div class="assistant-avatar"><img src="/static/icon-192.png" alt="Nova Insight"></div>
      <div class="message-bubble assistant">
        <div class="assistant-text-content"><span class="typing-cursor"></span></div>
      </div>
    `;
    messagesContainer.appendChild(assistantRow);
    scrollToBottom();

    const assistantContentEl = assistantRow.querySelector('.assistant-text-content');
    const streamState = { revealed: 0 };
    const thinkLevelNow = voiceBriefMode ? 'instant' : (settings.thinkingLevel || 'moderate');
    if (thinkLevelNow === 'resourced') setThinkingStatus(assistantContentEl, 'Thinking deeply');
    else if (thinkLevelNow === 'moderate') setThinkingStatus(assistantContentEl, 'Thinking');
    assistantRow.classList.add('streaming');

    // Photos & videos: a free vision model describes them first so Nova can talk about them
    const sentAtts = getMsgAttachments(userMsg);
    if (sentAtts.some(at => (at.kind === 'image' || at.kind === 'video') && at.caption === undefined)) {
      isStreaming = true;
      toggleStreamingUI(true);
      abortController = new AbortController();
      let stoppedLooking = false;
      try {
        await describeAttachments(sentAtts, text, assistantContentEl, abortController.signal);
      } catch (e) {
        stoppedLooking = true;
      }
      isStreaming = false;
      abortController = null;
      toggleStreamingUI(false);
      if (stoppedLooking) {
        assistantMsg.content = '*(Generation stopped)*';
        assistantContentEl.innerHTML = renderMarkdownWithCodeBlocks(assistantMsg.content);
        assistantRow.classList.remove('streaming');
        saveConversations();
        renderChatFeed();
        return;
      }
      if (thinkLevelNow === 'resourced') setThinkingStatus(assistantContentEl, 'Thinking deeply');
      else setThinkingStatus(assistantContentEl, 'Thinking');
    }

    // Work mode: Nova plans, writes files, runs code and reports back (own agent loop)
    if (workModeActive && window.NovaWork) {
      await runWorkAgent(conv, assistantMsg, assistantRow, assistantContentEl, userMsg, text);
      maybeGenerateTitle(conv);
      return;
    }

    // Streaming setup
    isStreaming = true;
    toggleStreamingUI(true);
    abortController = new AbortController();

    // Smooth streaming: batch incoming words into ~18 renders/second (aligned to the screen refresh)
    // instead of rebuilding the reply on every tiny chunk, and only follow along if the reader is at the bottom.
    let streamRenderTimer = null;
    let streamLive = true;
    let lastStreamRender = 0;
    const flushStreamRender = () => {
      streamRenderTimer = null;
      if (!streamLive) return;
      lastStreamRender = performance.now();
      const feed = chatScrollFeed;
      const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
      renderStreamingReply(assistantContentEl, assistantMsg.content, streamState);
      if (stick && activeConversationId === conv.id && settings.autoScroll !== false) scrollToBottom();
    };
    const scheduleStreamRender = () => {
      if (streamRenderTimer !== null) return;
      const wait = Math.max(0, 55 - (performance.now() - lastStreamRender));
      streamRenderTimer = setTimeout(() => requestAnimationFrame(flushStreamRender), wait);
    };
    const cancelStreamRender = () => {
      streamLive = false;
      if (streamRenderTimer !== null) { clearTimeout(streamRenderTimer); streamRenderTimer = null; }
    };


    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [1500, 4000, 8000, 15000, 25000];
    let bestPartial = '';
    try {
      for (let attempt = 0; ; attempt++) {
      try {
      let sawDone = false;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          messages: conv.messages.slice(0, -1).slice(-6).map(m => ({
            role: m.role,
            content: messageWithAttachments(m, 12000, window.NovaWork ? window.NovaWork.stripCard(m.content) : m.content)
          })),
          model: currentModel,
          temperature: settings.temperature,
          apiKey: settings.apiKey,
          geminiApiKey: settings.geminiApiKey,
          claudeApiKey: settings.claudeApiKey,
          baseUrl: settings.baseUrl,
          systemPrompt: (settings.systemPrompt || '') + (voiceBriefMode ? '\n\nVOICE MODE: You are speaking aloud. Reply in 1-2 short, plain sentences (under 40 words). No markdown, lists, or code.' : ''),
          webSearch: isWebSearchActive,
          isImageMode: isPhotoGenerationActive,
          projectId: (conv.projectId && conv.projectId !== 'proj-default') ? conv.projectId : null,
          thinking: voiceBriefMode ? 'instant' : (settings.thinkingLevel || 'moderate'),
          responseLength: settings.responseLength || 'balanced',
          tone: settings.tone || 'default',
          nickname: (settings.nickname || (userAccount && userAccount.name) || '')
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const httpErr = new Error(`HTTP error! status: ${response.status}`);
        // Client errors (bad request etc.) will not fix themselves; server hiccups / waking up will.
        httpErr.noRetry = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        throw httpErr;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partialChunk = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        partialChunk += decoder.decode(value, { stream: true });
        // Normalize CRLF to LF so Windows line endings don't break JSON parsing
        const normalized = partialChunk.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n\n');
        partialChunk = lines.pop(); // keep last incomplete buffer

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line.startsWith('data:')) {
            const jsonStr = line.replace(/^data:\s*/, '').trim();
            if (jsonStr) {
              try {
                const data = JSON.parse(jsonStr);
                if (data.status && !assistantMsg.content) {
                  setThinkingStatus(assistantContentEl, data.status);
                }
                if (data.delta) {
                  assistantMsg.content += data.delta;
                  scheduleStreamRender();
                }
                if (data.done) {
                  sawDone = true;
                  break;
                }
              } catch (err) {
                console.warn('Error parsing SSE data', err, jsonStr);
              }
            }
          }
        }
      }

      if (partialChunk && partialChunk.trim()) {
        const line = partialChunk.trim();
        if (line.startsWith('data:')) {
          const jsonStr = line.replace(/^data:\s*/, '').trim();
          if (jsonStr) {
            try {
              const data = JSON.parse(jsonStr);
              if (data.delta) {
                assistantMsg.content += data.delta;
              }
              if (data.done) sawDone = true;
            } catch (err) {}
          }
        }
      }

      // The connection closed before the server said "done": treat as an interruption and reconnect.
      if (!sawDone && !(abortController && abortController.signal.aborted)) {
        throw new Error('stream-dropped');
      }
      break; // finished successfully
      } catch (innerErr) {
        if (innerErr.name === 'AbortError' || innerErr.noRetry || attempt >= MAX_RETRIES) throw innerErr;
        if (assistantMsg.content.length > bestPartial.length) bestPartial = assistantMsg.content;
        cancelStreamRender();
        assistantMsg.content = '';
        streamState.revealed = 0;
        setThinkingStatus(assistantContentEl, attempt === 0 ? 'Connection lost - reconnecting' : `Reconnecting (try ${attempt + 1} of ${MAX_RETRIES})`);
        await waitForConnection(RETRY_DELAYS[attempt] || 25000, abortController ? abortController.signal : null);
        streamLive = true;
      }
      } // end retry loop
      cancelStreamRender();

      // Finish streaming cleanly
      assistantContentEl.innerHTML = renderMarkdownWithCodeBlocks(assistantMsg.content);
      assistantContentEl.querySelectorAll('img').forEach(img => {
        img.addEventListener('click', () => openImageLightbox(img.src));
      });
      saveConversations();
      if (typeof updateAccountStats === 'function') updateAccountStats();
      // Re-render message row to attach full action toolbar
      renderChatFeed();
      maybeGenerateTitle(conv);

    } catch (err) {
      cancelStreamRender();
      if (err.name === 'AbortError') {
        assistantContentEl.innerHTML = renderMarkdownWithCodeBlocks(assistantMsg.content + ' *(Generation stopped)*');
      } else {
        if (!(assistantMsg.content && assistantMsg.content.trim()) && bestPartial) assistantMsg.content = bestPartial;
        if (assistantMsg.content && assistantMsg.content.trim()) {
          assistantContentEl.innerHTML = renderMarkdownWithCodeBlocks(assistantMsg.content);
        } else {
          assistantContentEl.innerHTML = `<span style="color:#ef4444;">⚠️ Connection interrupted. </span><button class="btn-subtle" id="retryMsgBtn_${assistantIdx}" style="display:inline-flex; border:1px solid rgba(239,68,68,0.4); border-radius:4px; padding:2px 8px; margin-left:6px; font-size:12px; color:var(--text-primary); cursor:pointer;">🔄 Tap to Retry</button>`;
          setTimeout(() => {
            const rBtn = document.getElementById(`retryMsgBtn_${assistantIdx}`);
            if (rBtn) rBtn.addEventListener('click', () => regenerateLastResponse());
          }, 50);
        }
      }
      saveConversations();
    } finally {
      assistantRow.classList.remove('streaming');
      isStreaming = false;
      toggleStreamingUI(false);
      abortController = null;
    }
  }

  // Wait before a reconnect attempt. If the phone is offline, wait for it to come back; Stop cancels the wait.
  function waitForConnection(delayMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('online', onOnline);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve();
      };
      const onOnline = () => finish();
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; finish(e); };
      if (signal && signal.aborted) return onAbort();
      window.addEventListener('online', onOnline);
      if (signal) signal.addEventListener('abort', onAbort);
      timer = setTimeout(() => finish(), navigator.onLine === false ? 90000 : delayMs);
    });
  }

  // Keep the (free) server awake and wake it as soon as the app is opened or the network returns.
  function pingServer() {
    try { fetch('/api/health', { cache: 'no-store' }).catch(() => {}); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingServer(); });
  window.addEventListener('online', pingServer);
  setInterval(() => { if (!document.hidden) pingServer(); }, 4 * 60 * 1000);

  function stopStreaming() {
    if (abortController) {
      abortController.abort();
    }
    isStreaming = false;
    toggleStreamingUI(false);
  }

  function toggleStreamingUI(active) {
    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');
    if (active) {
      sendBtn.classList.add('streaming');
      sendBtn.disabled = false;
      sendIcon.style.display = 'none';
      stopIcon.style.display = 'inline-block';
      sendBtn.title = 'Stop generating';
    } else {
      sendBtn.classList.remove('streaming');
      sendIcon.style.display = 'inline-block';
      stopIcon.style.display = 'none';
      sendBtn.title = 'Send message';
      updateSendButtonState();
    }
  }

  function regenerateLastResponse() {
    const conv = getActiveConversation();
    if (!conv || conv.messages.length === 0) return;

    if (conv.messages[conv.messages.length - 1].role === 'assistant') {
      conv.messages.pop(); // Remove assistant response
    }

    if (conv.messages.length > 0 && conv.messages[conv.messages.length - 1].role === 'user') {
      const lastUser = conv.messages.pop();
      saveConversations();
      renderChatFeed();
      messageInput.value = lastUser.content;
      // Re-attach the photos / videos; ones Nova could not look at the first time get another try.
      pendingAttachments = getMsgAttachments(lastUser).map(at => {
        const copy = Object.assign({}, at);
        if (copy.caption === '') delete copy.caption;
        return copy;
      });
      renderAttachStrip();
      sendMessage(lastUser.content);
    }
  }

  // --- Attachments: photos, videos and files ---
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Old chats stored one attachment in msg.attachment; new ones keep a list in msg.attachments.
  function getMsgAttachments(m) {
    if (!m) return [];
    if (Array.isArray(m.attachments)) return m.attachments;
    if (m.attachment) {
      const o = m.attachment;
      return [{ id: 'legacy', kind: o.dataUrl ? 'image' : 'text', name: o.name, content: o.content || '', thumb: o.dataUrl || undefined, caption: o.dataUrl ? '' : undefined }];
    }
    return [];
  }

  // What the chat model reads for one attachment (it can't see, so photos and videos arrive as descriptions).
  function attachmentContext(at, textLimit) {
    if (at.kind === 'image') {
      if (at.caption) {
        return `\n[Photo attached: "${at.name}". What the photo shows: ${at.caption}\n(Nova sees this photo through the description above. Answer naturally as if you looked at it, and never claim to see anything that is not described.)]`;
      }
      return `\n[Photo attached: "${at.name}", but Nova could not look at it right now. Say so honestly, do not guess what it shows, and offer to help if the user describes it or tries again.]`;
    }
    if (at.kind === 'video') {
      const len = at.duration ? ` (${fmtDur(at.duration)} long)` : '';
      if (at.caption) {
        return `\n[Video attached: "${at.name}"${len}. Nova watched it by looking at frames sampled across the video:\n${at.caption}\n(Answer naturally as if you watched it. You only saw these frames, not the sound or the motion in between.)]`;
      }
      return `\n[Video attached: "${at.name}"${len}, but Nova could not watch it right now. Say so honestly, do not guess what happens in it, and offer to help if the user describes it or tries again.]`;
    }
    return `\n[Attached file: ${at.name}]\n${(at.content || '').slice(0, textLimit || 12000)}`;
  }

  function messageWithAttachments(m, textLimit, baseOverride) {
    const base = baseOverride !== undefined ? baseOverride : (m.content || '');
    const atts = getMsgAttachments(m);
    if (!atts.length) return base;
    const lead = (base || '').trim() ? base : 'Please take a look at what I attached.';
    return lead + atts.map(at => attachmentContext(at, textLimit)).join('');
  }

  function renderUserAttachmentsHtml(msg) {
    const atts = getMsgAttachments(msg);
    if (!atts.length) return '';
    const isMedia = at => (at.kind === 'image' || at.kind === 'video') && at.thumb;
    const media = atts.filter(isMedia);
    let html = '';
    if (media.length) {
      html += `<div class="msg-media n${Math.min(media.length, 4)}">` + media.map(at => {
        const extra = at.kind === 'video'
          ? `<span class="msg-play">&#9654;</span><span class="msg-dur">${fmtDur(at.duration)}</span>` : '';
        return `<button type="button" class="msg-media-item ${at.kind}" data-idx="${atts.indexOf(at)}" title="${escapeHtml(at.name)}"><img src="${at.thumb}" alt="${escapeHtml(at.name)}" loading="lazy">${extra}</button>`;
      }).join('') + '</div>';
    }
    atts.filter(at => !isMedia(at)).forEach(at => {
      const ico = at.kind === 'video' ? '🎞️' : at.kind === 'image' ? '🖼️' : '📄';
      html += `<div class="user-msg-attachment-badge"><span>${ico}</span><span>${escapeHtml(at.name)}</span></div>`;
    });
    return html;
  }

  function openMediaPreview(at) {
    if (!at) return;
    if (at.kind === 'video') {
      const url = videoUrls.get(at.id);
      if (url) { openVideoLightbox(url, at.name); return; }
      if (at.thumb) openImageLightbox(at.thumb);
      showToast('The video file is only kept for the visit you sent it in');
    } else if (at.thumb) {
      openImageLightbox(at.thumb);
    }
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function drawScaled(source, w, h, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(source, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function buildImageAttachment(file) {
    const { img, url } = await loadImageFromFile(file);
    try {
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      return { kind: 'image', width: w, height: h, thumb: drawScaled(img, w, h, 1024, 0.8), _v: [drawScaled(img, w, h, 768, 0.72)] };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function seekVideo(v, t) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        setTimeout(resolve, 40);
      };
      v.addEventListener('seeked', finish);
      setTimeout(finish, 4000);
      try { v.currentTime = t; } catch (e) { finish(); }
    });
  }

  // Grabs a poster plus a few frames spread across the video (these are what Nova "watches").
  function buildVideoAttachment(file, id) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      let settled = false;
      const fail = (why) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('timeout'), 25000);
      v.onerror = () => fail('decode');
      v.onloadedmetadata = async () => {
        try {
          const dur = isFinite(v.duration) ? v.duration : 0;
          const w = v.videoWidth || 640;
          const h = v.videoHeight || 360;
          const count = dur && dur < 4 ? 2 : 4;
          const times = [];
          for (let i = 0; i < count; i++) {
            times.push(dur ? Math.min(Math.max(dur - 0.08, 0.05), Math.max(0.05, dur * (i + 0.5) / count)) : 0);
          }
          const frames = [];
          let thumb = '';
          for (let i = 0; i < times.length; i++) {
            await seekVideo(v, times[i]);
            frames.push(drawScaled(v, w, h, 640, 0.7));
            if (i === 0) thumb = drawScaled(v, w, h, 800, 0.78);
          }
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          videoUrls.set(id, url);
          resolve({ kind: 'video', duration: dur, thumb, frameTimes: times, _v: frames });
        } catch (e) {
          fail('frames');
        }
      };
      v.src = url;
    });
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ kind: 'text', content: String(reader.result || '').slice(0, 30000) });
      reader.onerror = () => reject(new Error('read'));
      reader.readAsText(file);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (pendingAttachments.length >= MAX_ATTACHMENTS) {
        showToast('You can attach up to ' + MAX_ATTACHMENTS + ' files at a time');
        break;
      }
      const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name || '');
      const isImage = !isVideo && file.type.startsWith('image/');
      const isText = !isVideo && !isImage && (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_FILE_RE.test(file.name || ''));
      const label = file.name || (isImage ? 'photo' : isVideo ? 'video' : 'file');
      if (!isImage && !isVideo && !isText) {
        showToast(label + ' is not supported. Use photos, videos or text/code files.');
        continue;
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) { showToast(label + ' is too big (max 600 MB)'); continue; }
      if (isImage && file.size > 40 * 1024 * 1024) { showToast(label + ' is too big (max 40 MB)'); continue; }
      if (isText && file.size > 400 * 1024) { showToast(label + ' is too big (max 400 KB for text files)'); continue; }

      const id = 'att_' + Date.now().toString(36) + '_' + (++attachSeq);
      const slot = { id, kind: isImage ? 'image' : isVideo ? 'video' : 'text', name: label, type: file.type, size: file.size, loading: true };
      pendingAttachments.push(slot);
      renderAttachStrip();
      updateSendButtonState();
      try {
        const built = isImage ? await buildImageAttachment(file) : isVideo ? await buildVideoAttachment(file, id) : await readTextFile(file);
        Object.assign(slot, built);
        slot.loading = false;
      } catch (e) {
        const i = pendingAttachments.indexOf(slot);
        if (i >= 0) pendingAttachments.splice(i, 1);
        showToast("Couldn't open " + label + (isVideo ? ' (your browser may not support this video format)' : isImage ? ' (unsupported picture format)' : ''));
      }
      renderAttachStrip();
      updateSendButtonState();
    }
  }

  function renderAttachStrip() {
    if (!attachStrip || !attachmentPreview) return;
    attachStrip.innerHTML = '';
    pendingAttachments.forEach(at => {
      const chip = document.createElement('div');
      chip.className = 'attach-chip ' + at.kind + (at.loading ? ' loading' : '');
      let inner;
      if (at.loading) inner = '<span class="attach-spin"></span>';
      else if (at.thumb) inner = `<img src="${at.thumb}" alt="">` + (at.kind === 'video' ? `<span class="attach-play">&#9654;</span><span class="attach-dur">${fmtDur(at.duration)}</span>` : '');
      else inner = '<span class="attach-file-ico">📄</span>';
      chip.innerHTML = `<div class="attach-thumb">${inner}</div>` +
        (at.kind === 'text' ? `<span class="attach-name">${escapeHtml(at.name)}</span>` : '') +
        '<button type="button" class="attach-remove" aria-label="Remove attachment" title="Remove">&times;</button>';
      chip.querySelector('.attach-remove').addEventListener('click', () => removeAttachment(at.id));
      attachStrip.appendChild(chip);
    });
    attachmentPreview.style.display = pendingAttachments.length ? 'flex' : 'none';
  }

  function removeAttachment(id) {
    const i = pendingAttachments.findIndex(at => at.id === id);
    if (i < 0) return;
    pendingAttachments.splice(i, 1);
    const url = videoUrls.get(id);
    if (url) { URL.revokeObjectURL(url); videoUrls.delete(id); }
    renderAttachStrip();
    updateSendButtonState();
  }

  // After sending: the message now owns the attachments, so just empty the composer strip.
  function clearAttachment() {
    pendingAttachments = [];
    renderAttachStrip();
    if (fileInput) fileInput.value = '';
    updateSendButtonState();
  }

  // Ask the vision service to describe each photo / video (it sends the frames, the server returns text).
  async function describeAttachments(atts, hint, statusEl, signal) {
    const todo = atts.filter(at => (at.kind === 'image' || at.kind === 'video') && at.caption === undefined);
    if (!todo.length) return;
    const hasVideo = todo.some(at => at.kind === 'video');
    setThinkingStatus(statusEl, hasVideo ? 'Watching your video' : (todo.length > 1 ? 'Looking at your photos' : 'Looking at your photo'));
    await Promise.all(todo.map(async (at) => {
      let caption = '';
      const frames = (at._v && at._v.length) ? at._v : (at.thumb ? [at.thumb] : []);
      for (let attempt = 0; attempt < 2 && !caption && frames.length; attempt++) {
        try {
          const res = await fetch('/api/vision', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ images: frames, kind: at.kind, hint: (hint || '').slice(0, 300) }),
            signal
          });
          if (res.ok) {
            const caps = ((await res.json()).captions) || [];
            if (at.kind === 'video') {
              caption = caps.map((c, i) => c ? `Frame ${i + 1} (at ${fmtDur((at.frameTimes || [])[i] || 0)}): ${c}` : '').filter(Boolean).join('\n');
            } else {
              caption = (caps[0] || '').trim();
            }
          } else if (res.status === 401 || res.status === 429 || res.status === 413) {
            break;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
        }
      }
      at.caption = caption; // '' means Nova could not look at it
    }));
    if (todo.some(at => !at.caption)) showToast("Nova couldn't look at every picture right now");
    saveConversations();
  }

  // --- Speech Dictation & Audio Synthesis ---
  let activeDictationRec = null;
  let activeSpeechUtterances = [];
  let speechKeepAliveTimer = null;
  let isVoiceAssistantActive = false;
  let voiceAssistantRec = null;
  let voiceSilenceTimer = null;
  let currentVoiceTranscript = '';
  let voiceBriefMode = false;

  function setupSpeechRecognition() {
    // Listen for dynamically loaded browser voices (Chrome/Android)
    if (window.speechSynthesis) {
      if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = () => {
          populateVoiceList();
        };
      }
    }
  }

  function toggleVoiceInput() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('Voice dictation is not supported in this browser or requires HTTPS');
      return;
    }

    if (isRecordingVoice && activeDictationRec) {
      try { activeDictationRec.stop(); } catch (e) {}
      activeDictationRec = null;
      isRecordingVoice = false;
      voiceInputBtn.classList.remove('recording');
      showToast('Dictation stopped');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        isRecordingVoice = true;
        voiceInputBtn.classList.add('recording');
        showToast('🎙️ Dictating... speak now');
      };

      rec.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          messageInput.value = transcript;
          adjustTextareaHeight();
          updateSendButtonState();
        }
      };

      rec.onend = () => {
        isRecordingVoice = false;
        voiceInputBtn.classList.remove('recording');
        activeDictationRec = null;
      };

      rec.onerror = (e) => {
        console.warn('Speech recognition dictation event:', e);
        isRecordingVoice = false;
        voiceInputBtn.classList.remove('recording');
        activeDictationRec = null;
        if (e.error === 'not-allowed') {
          showToast('🚫 Microphone blocked. Please allow mic in browser settings');
        }
      };

      activeDictationRec = rec;
      rec.start();
    } catch (err) {
      console.warn('Failed to start dictation:', err);
      showToast('Could not start microphone dictation');
      isRecordingVoice = false;
      voiceInputBtn.classList.remove('recording');
    }
  }

  function stopSpeechSynthesis() {
    if (speechKeepAliveTimer) {
      clearInterval(speechKeepAliveTimer);
      speechKeepAliveTimer = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    activeSpeechUtterances = [];
  }

  function speakWithVoiceChanger(text, onEnd) {
    if (!window.speechSynthesis) {
      if (onEnd) onEnd();
      return;
    }

    stopSpeechSynthesis();

    // Clean text: strip code blocks, thinking tags, HTML, links, and markdown syntax
    const cleanText = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<div[\s\S]*?<\/div>/gi, '')
      .replace(/```[\s\S]*?```/gi, 'code block omitted.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[#*_~\[\]|\\`>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      if (onEnd) onEnd();
      return;
    }

    // Split text into natural sentence chunks to prevent Chrome's 15s freeze bug
    const rawSentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
    const sentenceChunks = [];
    for (let s of rawSentences) {
      s = s.trim();
      if (!s) continue;
      while (s.length > 175) {
        let cut = s.lastIndexOf(' ', 175);
        if (cut <= 0) cut = 175;
        sentenceChunks.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (s) sentenceChunks.push(s);
    }

    if (sentenceChunks.length === 0) {
      if (onEnd) onEnd();
      return;
    }

    // Select voice if customized
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;
    if (settings.voiceURI && voices && voices.length > 0) {
      selectedVoice = voices.find(v => v.voiceURI === settings.voiceURI) || null;
    }

    let chunkIndex = 0;

    // Periodically resume audio synthesis to keep mobile/Chromium background audio alive
    speechKeepAliveTimer = setInterval(() => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 4500);

    function playNextChunk() {
      if (chunkIndex >= sentenceChunks.length) {
        stopSpeechSynthesis();
        if (onEnd) onEnd();
        return;
      }

      const chunk = sentenceChunks[chunkIndex++];
      const utterance = new SpeechSynthesisUtterance(chunk);

      utterance.pitch = settings.voicePitch !== undefined ? settings.voicePitch : 1.0;
      utterance.rate = settings.voiceRate !== undefined ? settings.voiceRate : 1.0;
      utterance.volume = (settings.voiceVolume !== undefined ? settings.voiceVolume : 100) / 100;

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onend = () => {
        playNextChunk();
      };

      utterance.onerror = (e) => {
        console.warn("Speech synthesis chunk event:", e);
        playNextChunk();
      };

      activeSpeechUtterances.push(utterance);
      try {
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Speech synthesis speak error:", err);
        playNextChunk();
      }
    }

    playNextChunk();
  }

  function toggleSpeech(text, btnElement) {
    if (!window.speechSynthesis) {
      showToast('Text-to-speech not supported in this browser');
      return;
    }

    if (window.speechSynthesis.speaking) {
      stopSpeechSynthesis();
      if (btnElement) btnElement.classList.remove('active');
      return;
    }

    if (btnElement) btnElement.classList.add('active');
    speakWithVoiceChanger(text, () => {
      if (btnElement) btnElement.classList.remove('active');
    });
  }

  // --- Built-in Interactive Voice Assistant (Hands-Free Mode) ---
  function checkVoiceSecurity() {
    const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure && voiceHttpsAlert) {
      voiceHttpsAlert.style.display = 'flex';
      fetch('/api/tunnel-status')
        .then(r => r.json())
        .then(data => {
          if (data && data.url && data.url.startsWith('https://')) {
            window.latestSecureTunnelUrl = data.url;
          }
        })
        .catch(() => {});
    } else if (voiceHttpsAlert) {
      voiceHttpsAlert.style.display = 'none';
    }
  }

  function openVoiceAssistantModal() {
    if (!voiceAssistantModal) return;
    isVoiceAssistantActive = true;
    voiceAssistantModal.style.display = 'flex';
    voiceAssistantModal.classList.add('listening');
    voiceAssistantModal.classList.remove('speaking');

    // Prime/unlock audio context on user gesture for mobile browsers
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.resume();
      } catch (e) {}
    }

    if (voiceStatusText) voiceStatusText.textContent = "Listening to you...";
    if (voiceHintText) voiceHintText.textContent = "Speak naturally — Nova Insight will answer aloud";
    if (voiceTranscriptContent) voiceTranscriptContent.textContent = 'Speak your question or prompt now...';
    if (voiceResponseCard) voiceResponseCard.style.display = 'none';
    if (voiceSendNowBtn) voiceSendNowBtn.style.display = 'none';
    if (voicePermissionAlert) voicePermissionAlert.style.display = 'none';
    if (voiceQuickInput) voiceQuickInput.value = '';

    checkVoiceSecurity();
    startVoiceAssistantListening();
  }

  function closeVoiceAssistantModal() {
    isVoiceAssistantActive = false;
    if (voiceAssistantModal) voiceAssistantModal.style.display = 'none';
    stopVoiceAssistantListening();
    stopSpeechSynthesis();
  }

  function stopVoiceAssistantListening() {
    if (voiceSilenceTimer) {
      clearTimeout(voiceSilenceTimer);
      voiceSilenceTimer = null;
    }
    if (voiceAssistantRec) {
      try {
        voiceAssistantRec.onstart = null;
        voiceAssistantRec.onresult = null;
        voiceAssistantRec.onerror = null;
        voiceAssistantRec.onend = null;
        voiceAssistantRec.abort();
      } catch (e) {}
      voiceAssistantRec = null;
    }
  }

  async function startVoiceAssistantListening() {
    if (!isVoiceAssistantActive) return;

    stopVoiceAssistantListening();

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      if (voiceStatusText) voiceStatusText.textContent = "Voice speech not supported in this browser";
      if (voiceHintText) voiceHintText.textContent = "You can type below or switch to the secure HTTPS link";
      checkVoiceSecurity();
      return;
    }

    // Request native microphone access cleanly to prompt system permissions if needed
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        if (voicePermissionAlert) voicePermissionAlert.style.display = 'none';
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          console.warn("Microphone permission denied:", err);
          if (voicePermissionAlert) voicePermissionAlert.style.display = 'flex';
          if (voiceStatusText) voiceStatusText.textContent = "Microphone access blocked";
          if (voiceHintText) voiceHintText.textContent = "Allow microphone in browser settings or use type bar below";
          return;
        }
      }
    }

    try {
      voiceAssistantRec = new SpeechRec();
      voiceAssistantRec.continuous = true;
      voiceAssistantRec.interimResults = true;
      voiceAssistantRec.lang = 'en-US';

      voiceAssistantRec.onstart = () => {
        if (!isVoiceAssistantActive) return;
        if (voiceAssistantModal) {
          voiceAssistantModal.classList.add('listening');
          voiceAssistantModal.classList.remove('speaking');
        }
        if (voiceStatusText) voiceStatusText.textContent = "Listening to you...";
        if (voiceHintText) voiceHintText.textContent = "Speak clearly — Nova Insight will answer aloud";
        if (voiceMicLabel) voiceMicLabel.textContent = "Mic On";
        if (voiceMicIcon) voiceMicIcon.textContent = "🎙️";
      };

      currentVoiceTranscript = '';

      voiceAssistantRec.onresult = (e) => {
        if (!isVoiceAssistantActive) return;
        let interim = '';
        let final = '';

        for (let i = 0; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
            final += e.results[i][0].transcript + ' ';
          } else {
            interim += e.results[i][0].transcript;
          }
        }

        const fullText = (final + interim).trim();
        if (fullText) {
          currentVoiceTranscript = fullText;
          if (voiceTranscriptContent) voiceTranscriptContent.textContent = `"${fullText}"`;
          if (voiceSendNowBtn) voiceSendNowBtn.style.display = 'inline-flex';

          // Reset silence debounce timer: auto-send after 2 seconds of silence
          if (voiceSilenceTimer) clearTimeout(voiceSilenceTimer);
          voiceSilenceTimer = setTimeout(() => {
            if (isVoiceAssistantActive && currentVoiceTranscript.trim()) {
              const query = currentVoiceTranscript.trim();
              currentVoiceTranscript = '';
              processVoiceAssistantQuery(query);
            }
          }, 2000);
        }
      };

      voiceAssistantRec.onerror = (e) => {
        console.warn("Voice assistant recognition event:", e);
        if (!isVoiceAssistantActive) return;

        if (e.error === 'not-allowed') {
          if (voicePermissionAlert) voicePermissionAlert.style.display = 'flex';
          if (voiceStatusText) voiceStatusText.textContent = "Microphone blocked";
          return;
        }

        if (e.error === 'no-speech') {
          setTimeout(() => {
            if (isVoiceAssistantActive && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
              startVoiceAssistantListening();
            }
          }, 400);
          return;
        }

        if (e.error !== 'aborted') {
          setTimeout(() => {
            if (isVoiceAssistantActive && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
              startVoiceAssistantListening();
            }
          }, 800);
        }
      };

      voiceAssistantRec.onend = () => {
        if (!isVoiceAssistantActive) return;
        if (currentVoiceTranscript && currentVoiceTranscript.trim()) {
          const query = currentVoiceTranscript.trim();
          currentVoiceTranscript = '';
          processVoiceAssistantQuery(query);
        } else {
          setTimeout(() => {
            if (isVoiceAssistantActive && (!window.speechSynthesis || !window.speechSynthesis.speaking)) {
              startVoiceAssistantListening();
            }
          }, 350);
        }
      };

      voiceAssistantRec.start();
    } catch (err) {
      console.warn("Could not start SpeechRecognition:", err);
      if (voiceStatusText) voiceStatusText.textContent = "Mic could not start";
      if (voiceHintText) voiceHintText.textContent = "You can type below or retry microphone";
    }
  }

  async function processVoiceAssistantQuery(query) {
    if (!query || !query.trim()) return;
    stopVoiceAssistantListening();
    if (voiceSendNowBtn) voiceSendNowBtn.style.display = 'none';
    if (voiceTranscriptContent) voiceTranscriptContent.textContent = `"${query.trim()}"`;
    if (voiceStatusText) voiceStatusText.textContent = "Nova Insight is thinking...";
    if (voiceHintText) voiceHintText.textContent = "Generating voice answer...";
    if (voiceAssistantModal) {
      voiceAssistantModal.classList.remove('listening');
      voiceAssistantModal.classList.remove('speaking');
    }

    try {
      voiceBriefMode = true;
      await sendMessage(query.trim());
    } catch (e) {
      console.warn("Voice assistant send error:", e);
    } finally {
      voiceBriefMode = false;
    }

    const conv = getActiveConversation();
    if (conv && conv.messages.length > 0) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.content) {
        if (voiceResponseCard) voiceResponseCard.style.display = 'block';
        if (voiceResponseContent) {
          voiceResponseContent.textContent = lastMsg.content.slice(0, 180) + (lastMsg.content.length > 180 ? '...' : '');
        }
        if (voiceStatusText) voiceStatusText.textContent = "Nova Insight is speaking...";
        if (voiceHintText) voiceHintText.textContent = "Tap orb or 'Stop Audio' to interrupt";
        if (voiceAssistantModal) {
          voiceAssistantModal.classList.add('speaking');
        }

        speakWithVoiceChanger(lastMsg.content, () => {
          if (voiceAssistantModal) {
            voiceAssistantModal.classList.remove('speaking');
          }
          if (isVoiceAssistantActive) {
            if (voiceStatusText) voiceStatusText.textContent = "Listening to you...";
            if (voiceHintText) voiceHintText.textContent = "Speak next question...";
            setTimeout(startVoiceAssistantListening, 500);
          }
        });
      } else {
        if (isVoiceAssistantActive) {
          startVoiceAssistantListening();
        }
      }
    } else {
      if (isVoiceAssistantActive) {
        startVoiceAssistantListening();
      }
    }
  }

  // --- 30-Second Short Video Lightbox ---
  function openVideoLightbox(videoUrl, title) {
    if (!videoLightboxModal || !shortLightboxVideo) return;
    shortLightboxVideo.src = videoUrl;
    if (shortLightboxTitle) shortLightboxTitle.textContent = title || "30-Second AI Short";
    if (shortLightboxDownloadBtn) {
      shortLightboxDownloadBtn.href = videoUrl;
      shortLightboxDownloadBtn.setAttribute('download', `${(title || 'kazai_short').replace(/[^a-z0-9_-]/gi, '_')}.mp4`);
    }
    videoLightboxModal.style.display = 'flex';
    shortLightboxVideo.play().catch(e => console.log('Autoplay notice:', e));
  }

  function closeVideoLightbox() {
    if (!videoLightboxModal || !shortLightboxVideo) return;
    shortLightboxVideo.pause();
    shortLightboxVideo.src = '';
    videoLightboxModal.style.display = 'none';
  }

  // --- Export Chat ---
  function exportCurrentChat() {
    const conv = getActiveConversation();
    if (!conv || conv.messages.length === 0) {
      showToast('No messages to export');
      return;
    }

    let md = `# ${conv.title}\n\n*Date: ${new Date(conv.createdAt).toLocaleString()}*\n\n---\n\n`;
    conv.messages.forEach(m => {
      const sender = m.role === 'user' ? '### 👤 User' : '### 🤖 Assistant';
      md += `${sender}\n\n${m.content}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Conversation exported as Markdown');
  }

  // --- Utilities ---
  function adjustTextareaHeight() {
    // Cap the box to a share of the visible screen so it can never swallow the page (e.g. with the phone keyboard open).
    const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) || 700;
    const cap = Math.max(96, Math.min(200, Math.floor(vh * 0.28)));
    messageInput.style.maxHeight = cap + 'px';
    messageInput.style.height = 'auto';
    const needed = messageInput.scrollHeight;
    messageInput.style.height = Math.min(needed, cap) + 'px';
    messageInput.style.overflowY = needed > cap ? 'auto' : 'hidden';
  }

  // Keeps the message box sensible when the keyboard opens, the phone rotates, or the tool strip scrolls.
  function initComposerLayout() {
    const tools = document.getElementById('inputTools');
    const updateFade = () => {
      if (!tools) return;
      const overflow = tools.scrollWidth > tools.clientWidth + 2;
      tools.classList.toggle('fade-right', overflow && tools.scrollLeft + tools.clientWidth < tools.scrollWidth - 4);
      tools.classList.toggle('fade-left', overflow && tools.scrollLeft > 4);
    };
    if (tools) tools.addEventListener('scroll', updateFade, { passive: true });
    const onResize = () => { adjustTextareaHeight(); updateFade(); };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    messageInput.addEventListener('focus', () => setTimeout(onResize, 250));
    messageInput.addEventListener('blur', () => setTimeout(onResize, 100));
    setTimeout(onResize, 300);
  }

  function updateSendButtonState() {
    if (isStreaming) return;
    const hasText = messageInput.value.trim().length > 0;
    const hasAttachment = pendingAttachments.some(at => !at.loading);
    const preparing = pendingAttachments.some(at => at.loading);
    sendBtn.disabled = preparing || (!hasText && !hasAttachment);
  }

  function scrollToBottom(smooth) {
    const feed = chatScrollFeed;
    if (smooth === true) {
      try { feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }); return; } catch (e) {}
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Start screen: name first, then password (no guest mode) ---
  let sessionStarted = false;
  let authMode = 'name'; // 'name' | 'login' | 'create'
  let authName = '';
  let authBusy = false;

  // Chats are kept per account on this device (the original device chats belong to the creator).
  function scopeStorageToUser(acc) {
    if (!acc || !acc.id) return;
    const base = 'chatgpt_conversations';
    const key = base + ':' + acc.id;
    try {
      if (!localStorage.getItem(key) && acc.isCreator && localStorage.getItem(base)) {
        localStorage.setItem(key, localStorage.getItem(base));
      }
    } catch (e) {}
    STORAGE_KEYS.CONVERSATIONS = key;
  }

  function startSession() {
    if (sessionStarted) return;
    sessionStarted = true;
    scopeStorageToUser(userAccount);
    try { loadProjects(); } catch (e) { console.error('loadProjects error', e); }
    try { loadConversations(); } catch (e) { console.error('loadConversations error', e); }
    try {
      if (conversations.length > 0) {
        selectConversation(conversations[0].id);
      } else {
        createNewConversation();
      }
    } catch (e) {
      console.error('Initial conversation error', e);
    }
    updateUserAccountUI();
  }

  function authEls() {
    return {
      gate: document.getElementById('authGate'),
      form: document.getElementById('authForm'),
      sub: document.getElementById('authSub'),
      stepName: document.getElementById('authStepName'),
      stepPass: document.getElementById('authStepPass'),
      nameInput: document.getElementById('authNameInput'),
      passInput: document.getElementById('authPassInput'),
      chip: document.getElementById('authNameChip'),
      msg: document.getElementById('authMsg'),
      btn: document.getElementById('authSubmitBtn'),
      back: document.getElementById('authBackBtn'),
      eye: document.getElementById('authPassToggle')
    };
  }

  function authMessage(text, info) {
    const el = authEls();
    if (!el.msg) return;
    el.msg.textContent = text || '';
    el.msg.classList.toggle('info', !!info);
  }

  function setAuthMode(mode, displayName) {
    const el = authEls();
    authMode = mode;
    authMessage('');
    if (mode === 'name') {
      el.stepName.style.display = 'block';
      el.stepPass.style.display = 'none';
      el.back.style.display = 'none';
      el.sub.textContent = 'Enter your name to get started';
      el.btn.textContent = 'Continue';
      el.passInput.value = '';
      setTimeout(() => el.nameInput.focus(), 30);
      return;
    }
    el.stepName.style.display = 'none';
    el.stepPass.style.display = 'block';
    el.back.style.display = 'inline-block';
    el.chip.textContent = displayName || authName;
    el.passInput.type = 'password';
    el.eye.textContent = 'Show';
    el.passInput.value = '';
    if (mode === 'login') {
      el.sub.textContent = 'Welcome back! Enter your password';
      el.btn.textContent = 'Sign in';
      el.passInput.setAttribute('autocomplete', 'current-password');
      el.passInput.placeholder = 'Password';
    } else {
      el.sub.textContent = 'Nice to meet you! Create a password for your account';
      el.btn.textContent = 'Create account';
      el.passInput.setAttribute('autocomplete', 'new-password');
      el.passInput.placeholder = 'Create a password (4+ characters)';
    }
    setTimeout(() => el.passInput.focus(), 30);
  }

  function showAuthGate() {
    const el = authEls();
    if (!el.gate) return;
    el.gate.style.display = 'flex';
    setAuthMode('name');
  }

  function hideAuthGate() {
    const el = authEls();
    if (el.gate) el.gate.style.display = 'none';
  }

  async function authSubmit(ev) {
    if (ev) ev.preventDefault();
    if (authBusy) return;
    const el = authEls();

    if (authMode === 'name') {
      const name = el.nameInput.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) { authMessage('Please enter at least 2 characters.'); return; }
      authBusy = true; el.btn.disabled = true; authMessage('Checking...', true);
      try {
        const res = await fetch('/api/account/exists?username=' + encodeURIComponent(name.toLowerCase()));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { authMessage(data.detail || 'Could not reach the server. Please try again.'); return; }
        authName = data.exists && data.name ? data.name : name;
        setAuthMode(data.exists ? 'login' : 'create', authName);
      } catch (e) {
        authMessage('Connection error. Please try again.');
      } finally {
        authBusy = false; el.btn.disabled = false;
      }
      return;
    }

    const password = el.passInput.value;
    if (!password) { authMessage('Please enter your password.'); return; }
    if (authMode === 'create' && password.length < 4) { authMessage('Password must be at least 4 characters.'); return; }

    authBusy = true; el.btn.disabled = true;
    authMessage(authMode === 'login' ? 'Signing in...' : 'Creating your account...', true);
    try {
      const username = authName.toLowerCase();
      const res = await fetch(authMode === 'login' ? '/api/account/login' : '/api/account/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authMode === 'login' ? { username, password } : { name: authName, username, password, avatar: '⚡' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSessionToken(data.token);
        userAccount = Object.assign({}, data.account, { isLoggedIn: true });
        el.passInput.value = '';
        hideAuthGate();
        startSession();
        showToast(authMode === 'login' ? `Welcome back, ${userAccount.name}!` : `Welcome to Nova Insight, ${userAccount.name}!`);
      } else if (res.status === 401) {
        authMessage('Wrong password. Please try again.');
        el.passInput.select();
      } else if (authMode === 'create' && /already taken/i.test(data.detail || '')) {
        setAuthMode('name');
        authMessage('That name was just taken. Try another one.');
      } else {
        authMessage(data.detail || 'Something went wrong. Please try again.');
      }
    } catch (e) {
      authMessage('Connection error. Please try again.');
    } finally {
      authBusy = false; el.btn.disabled = false;
    }
  }

  async function startAuthFlow() {
    const el = authEls();
    if (el.form) el.form.addEventListener('submit', authSubmit);
    if (el.back) el.back.addEventListener('click', () => setAuthMode('name'));
    if (el.eye) {
      el.eye.addEventListener('click', () => {
        const show = el.passInput.type === 'password';
        el.passInput.type = show ? 'text' : 'password';
        el.eye.textContent = show ? 'Hide' : 'Show';
        el.passInput.focus();
      });
    }
    await loadUserAccount();
    if (userAccount.isLoggedIn) {
      hideAuthGate();
      startSession();
    } else {
      showAuthGate();
    }
  }

  // --- Account & Profile Management ---
  const SESSION_TOKEN_KEY = 'kazai_session_token';

  function getSessionToken() {
    return localStorage.getItem(SESSION_TOKEN_KEY) || '';
  }

  function setSessionToken(token) {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  }

  function getAuthHeaders() {
    const token = getSessionToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async function loadUserAccount() {
    try {
      const res = await fetch('/api/account', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          userAccount = Object.assign({}, data, { isLoggedIn: true });
        } else {
          userAccount = {
            authenticated: false,
            isLoggedIn: false,
            id: null,
            name: 'Guest User',
            username: 'guest',
            avatar: '👤',
            isCreator: false
          };
        }
      }
    } catch (e) {
      console.warn('Notice loading user account:', e);
    }
    updateUserAccountUI();
  }

  function isPhotoAvatar(v) {
    return typeof v === 'string' && v.indexOf('data:image/') === 0;
  }

  function paintAvatar(el, avatar, fallback) {
    if (!el) return;
    if (isPhotoAvatar(avatar)) {
      el.classList.add('avatar-photo');
      el.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '';
      img.src = avatar;
      el.appendChild(img);
    } else {
      el.classList.remove('avatar-photo');
      el.textContent = avatar || fallback || '';
    }
  }

  // Crop the picked picture to a centred square, shrink it and save it as the profile picture.
  async function chooseAvatarPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose a picture'); return; }
    try {
      const { img, url } = await loadImageFromFile(file);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, 192, 192);
      URL.revokeObjectURL(url);
      pendingAvatar = canvas.toDataURL('image/jpeg', 0.86);
      paintAvatar(accountAvatarEmoji, pendingAvatar, '⚡');
      if (avatarPicker) avatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('active'));
      await saveUserAccount();
    } catch (e) {
      showToast("Couldn't read that picture");
    }
  }

  function updateUserAccountUI() {
    const isLogged = !!userAccount.isLoggedIn;
    const isCreator = !!userAccount.isCreator;

    // Sidebar User Pill
    if (sidebarUserName) {
      sidebarUserName.textContent = isLogged ? (userAccount.name || 'User') : 'Guest User';
    }
    if (sidebarUserInitial) {
      paintAvatar(sidebarUserInitial, isLogged ? (userAccount.avatar || '⚡') : '👤', '⚡');
    }
    if (sidebarUserRole) {
      if (isCreator) {
        sidebarUserRole.textContent = '👑 Creator & Architect';
        sidebarUserRole.style.color = '#fde047';
      } else if (isLogged) {
        sidebarUserRole.textContent = 'Nova Insight Member';
        sidebarUserRole.style.color = 'var(--text-secondary)';
      } else {
        sidebarUserRole.textContent = 'Sign In / Register';
        sidebarUserRole.style.color = 'var(--accent)';
      }
    }

    // Modal Views (Logged In vs Guest)
    if (accountLoggedInView && accountGuestView) {
      if (isLogged) {
        accountLoggedInView.style.display = 'block';
        accountGuestView.style.display = 'none';

        if (accountProfileDisplay) accountProfileDisplay.textContent = userAccount.name || 'User';
        if (accountAvatarEmoji) paintAvatar(accountAvatarEmoji, pendingAvatar || userAccount.avatar, '⚡');
        if (avatarRemoveBtn) avatarRemoveBtn.style.display = isPhotoAvatar(userAccount.avatar) ? '' : 'none';
        if (accNameInput) accNameInput.value = userAccount.name || '';
        if (accUsernameDisplay) accUsernameDisplay.value = userAccount.username || '';
        if (accPasswordInput) accPasswordInput.value = '';

        if (accountProfileBadge) {
          accountProfileBadge.textContent = isCreator ? '👑 Creator & Architect' : 'Nova Insight Member';
        }

        if (avatarPicker) {
          avatarPicker.querySelectorAll('.avatar-opt').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-avatar') === userAccount.avatar);
          });
        }
        updateAccountStats();

      } else {
        accountLoggedInView.style.display = 'none';
        accountGuestView.style.display = 'block';
      }
    }
  }

  function updateAccountStats() {
    if (statChatsCount) statChatsCount.textContent = conversations.length;
    if (statProjectsCount) statProjectsCount.textContent = projects.length;
    let photosCount = 0;
    conversations.forEach(c => {
      c.messages.forEach(m => {
        if (m.content && (m.content.includes('pollinations.ai') || m.content.includes('Photo Generated'))) {
          photosCount++;
        }
      });
    });
    if (statPhotosCount) statPhotosCount.textContent = photosCount;
  }

  function openAccountModal() {
    pendingAvatar = null;
    updateUserAccountUI();
    if (accountStatusMsg) accountStatusMsg.textContent = '';
    if (loginStatusMsg) loginStatusMsg.textContent = '';
    if (regStatusMsg) regStatusMsg.textContent = '';
    if (accountModal) accountModal.style.display = 'flex';
  }

  async function handleLogin() {
    const username = loginUsernameInput ? loginUsernameInput.value.trim() : '';
    const password = loginPasswordInput ? loginPasswordInput.value : '';
    if (!username || !password) {
      if (loginStatusMsg) {
        loginStatusMsg.textContent = 'Please enter both username and password';
        loginStatusMsg.style.color = '#ef4444';
      }
      return;
    }

    if (loginStatusMsg) {
      loginStatusMsg.textContent = 'Verifying credentials...';
      loginStatusMsg.style.color = 'var(--text-secondary)';
    }

    try {
      const res = await fetch('/api/account/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSessionToken(data.token);
        userAccount = Object.assign({}, data.account, { isLoggedIn: true });
        updateUserAccountUI();
        if (accountModal) accountModal.style.display = 'none';
        showToast(`Welcome back, ${userAccount.name}! Logged in successfully.`);
      } else {
        if (loginStatusMsg) {
          loginStatusMsg.textContent = data.detail || 'Invalid username or password';
          loginStatusMsg.style.color = '#ef4444';
        }
      }
    } catch (e) {
      if (loginStatusMsg) {
        loginStatusMsg.textContent = 'Login connection error';
        loginStatusMsg.style.color = '#ef4444';
      }
    }
  }

  async function handleRegister() {
    const name = regNameInput ? regNameInput.value.trim() : '';
    const username = regUsernameInput ? regUsernameInput.value.trim().toLowerCase() : '';
    const password = regPasswordInput ? regPasswordInput.value : '';
    const activeAvatarBtn = regAvatarPicker ? regAvatarPicker.querySelector('.avatar-opt.active') : null;
    const avatar = activeAvatarBtn ? activeAvatarBtn.getAttribute('data-avatar') : '⚡';

    if (!name) {
      if (regStatusMsg) { regStatusMsg.textContent = 'Please enter your name'; regStatusMsg.style.color = '#ef4444'; }
      return;
    }
    if (!username || username.length < 2) {
      if (regStatusMsg) { regStatusMsg.textContent = 'Username must be at least 2 characters'; regStatusMsg.style.color = '#ef4444'; }
      return;
    }
    if (!password || password.length < 4) {
      if (regStatusMsg) { regStatusMsg.textContent = 'Password must be at least 4 characters'; regStatusMsg.style.color = '#ef4444'; }
      return;
    }

    if (regStatusMsg) {
      regStatusMsg.textContent = 'Creating account...';
      regStatusMsg.style.color = 'var(--text-secondary)';
    }

    try {
      const res = await fetch('/api/account/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password, avatar })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSessionToken(data.token);
        userAccount = Object.assign({}, data.account, { isLoggedIn: true });
        updateUserAccountUI();
        if (accountModal) accountModal.style.display = 'none';
        showToast(`Account created! Welcome to Nova Insight, ${userAccount.name}.`);
      } else {
        if (regStatusMsg) {
          regStatusMsg.textContent = data.detail || 'Could not create account';
          regStatusMsg.style.color = '#ef4444';
        }
      }
    } catch (e) {
      if (regStatusMsg) {
        regStatusMsg.textContent = 'Registration connection error';
        regStatusMsg.style.color = '#ef4444';
      }
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/account/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch (e) {}

    setSessionToken('');
    userAccount = {
      authenticated: false,
      isLoggedIn: false,
      id: null,
      name: 'Guest User',
      username: 'guest',
      avatar: '👤',
      isCreator: false
    };
    updateUserAccountUI();
    window.location.reload();
  }

  async function saveUserAccount() {
    if (!userAccount.isLoggedIn) return;

    const name = accNameInput ? accNameInput.value.trim() : userAccount.name;
    const password = accPasswordInput ? accPasswordInput.value : '';
    const activeAvatarBtn = avatarPicker ? avatarPicker.querySelector('.avatar-opt.active') : null;
    const avatar = pendingAvatar || (activeAvatarBtn ? activeAvatarBtn.getAttribute('data-avatar') : (userAccount.avatar || '⚡'));

    if (accountStatusMsg) {
      accountStatusMsg.textContent = 'Saving...';
      accountStatusMsg.style.color = 'var(--text-secondary)';
    }

    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: name,
          password: password || undefined,
          avatar: avatar
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        userAccount.name = data.account.name;
        userAccount.avatar = data.account.avatar;
        pendingAvatar = null;
        updateUserAccountUI();
        if (accountStatusMsg) {
          accountStatusMsg.textContent = '✓ Saved!';
          accountStatusMsg.style.color = '#10a37f';
          setTimeout(() => { if (accountStatusMsg) accountStatusMsg.textContent = ''; }, 3000);
        }
        showToast('Profile updated successfully!');
      } else {
        if (accountStatusMsg) {
          accountStatusMsg.textContent = data.detail || 'Error saving';
          accountStatusMsg.style.color = '#ef4444';
        }
      }
    } catch (e) {
      if (accountStatusMsg) {
        accountStatusMsg.textContent = 'Error connecting to server';
        accountStatusMsg.style.color = '#ef4444';
      }
    }
  }

  // --- Projects (ChatGPT-style): folders in the sidebar that group chats, rules and reference files ---
  const PROJ_NONE = 'proj-default';
  let expandedProjects = {};
  let projectsSectionOpen = true;

  function projUiKey(suffix) {
    return 'nova_projui:' + ((userAccount && userAccount.id) || 'anon') + ':' + suffix;
  }

  function loadProjectUiState() {
    try {
      expandedProjects = JSON.parse(localStorage.getItem(projUiKey('open')) || '{}') || {};
      projectsSectionOpen = localStorage.getItem(projUiKey('section')) !== '0';
    } catch (e) { expandedProjects = {}; projectsSectionOpen = true; }
  }

  function saveProjectUiState() {
    try {
      localStorage.setItem(projUiKey('open'), JSON.stringify(expandedProjects));
      localStorage.setItem(projUiKey('section'), projectsSectionOpen ? '1' : '0');
    } catch (e) {}
  }

  function projectOf(conv) {
    if (!conv || !conv.projectId || conv.projectId === PROJ_NONE) return null;
    return projects.find(p => p.id === conv.projectId) || null;
  }

  function projectsCacheKey() {
    return 'nova_projects:' + ((userAccount && userAccount.id) || 'anon');
  }

  async function loadProjects() {
    // Projects belong to the signed-in account (stored on the server); a copy is cached per account on this device.
    try { localStorage.removeItem('kazai_projects'); localStorage.removeItem('kazai_active_project'); } catch (e) {}
    projects = [];
    try {
      const cached = localStorage.getItem(projectsCacheKey());
      if (cached) projects = (JSON.parse(cached) || []).filter(p => p && p.id !== PROJ_NONE);
    } catch (e) { projects = []; }
    loadProjectUiState();
    renderSidebarHistory(chatSearchInput ? chatSearchInput.value : '');
    updateActiveProjectUI();
    try {
      const res = await fetch('/api/projects', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        projects = (data.projects || []).filter(p => p && p.id !== PROJ_NONE);
        localStorage.setItem(projectsCacheKey(), JSON.stringify(projects));
      }
    } catch (e) {
      console.warn('Notice loading projects:', e);
    }
    renderSidebarHistory(chatSearchInput ? chatSearchInput.value : '');
    syncActiveProject();
    if (typeof updateAccountStats === 'function') updateAccountStats();
  }

  function cacheProjects() {
    try { localStorage.setItem(projectsCacheKey(), JSON.stringify(projects)); } catch (e) {}
  }

  function syncActiveProject() {
    const p = projectOf(getActiveConversation());
    activeProjectId = p ? p.id : PROJ_NONE;
    if (p && !expandedProjects[p.id]) {
      expandedProjects[p.id] = true;
      saveProjectUiState();
    }
    updateActiveProjectUI();
  }

  function updateActiveProjectUI() {
    const p = projects.find(x => x.id === activeProjectId);
    if (topNavProjectBadge) topNavProjectBadge.style.display = p ? '' : 'none';
    if (topNavProjectName && p) topNavProjectName.textContent = p.name;
  }

  const FOLDER_SVG = '<svg class="icon sp-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
  const CHEV_SVG = '<svg class="icon sp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  function renderProjectsSidebar(filterQuery) {
    const wrap = document.getElementById('sidebarProjects');
    if (!wrap || !projectListContainer) return;
    wrap.classList.toggle('sp-hidden', !!filterQuery);
    wrap.classList.toggle('sp-collapsed', !projectsSectionOpen);
    const toggle = document.getElementById('spToggle');
    if (toggle) toggle.setAttribute('aria-expanded', projectsSectionOpen ? 'true' : 'false');
    projectListContainer.innerHTML = '';

    if (!projects.length) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'sp-empty';
      empty.innerHTML = '<span>＋ New project</span><small>Keep chats, instructions and files together</small>';
      empty.addEventListener('click', () => openProjectModal('new'));
      projectListContainer.appendChild(empty);
      return;
    }

    projects.forEach(p => {
      const chats = conversations
        .filter(c => c.projectId === p.id)
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const open = !!expandedProjects[p.id];
      const holdsActive = chats.some(c => c.id === activeConversationId);
      const box = document.createElement('div');
      box.className = 'sp-proj' + (open ? ' open' : '') + (holdsActive ? ' has-active' : '');

      const head = document.createElement('div');
      head.className = 'sp-proj-head';
      head.innerHTML = `<button type="button" class="sp-row" title="${escapeHtml(p.name)}">${CHEV_SVG}${FOLDER_SVG}<span class="sp-name">${escapeHtml(p.name)}</span><span class="sp-count">${chats.length || ''}</span></button>` +
        `<button type="button" class="sp-more" title="Project options" aria-label="Project options"><svg class="icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>`;
      head.querySelector('.sp-row').addEventListener('click', () => {
        expandedProjects[p.id] = !open;
        saveProjectUiState();
        renderProjectsSidebar(filterQuery);
      });
      head.querySelector('.sp-more').addEventListener('click', (e) => {
        e.stopPropagation();
        showPopupMenu(e.currentTarget, [
          { label: 'New chat in project', onClick: () => newChatInProject(p.id) },
          { label: 'Project rules & files', onClick: () => openProjectModal(p.id) },
          { label: 'Delete project', danger: true, onClick: () => deleteProject(p.id) }
        ]);
      });
      box.appendChild(head);

      if (open) {
        const body = document.createElement('div');
        body.className = 'sp-chats';
        chats.forEach(c => body.appendChild(makeChatItem(c, false)));
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'sp-newchat';
        add.textContent = '＋ New chat in project';
        add.addEventListener('click', () => newChatInProject(p.id));
        body.appendChild(add);
        box.appendChild(body);
      }
      projectListContainer.appendChild(box);
    });
  }

  function newChatInProject(projectId) {
    expandedProjects[projectId] = true;
    saveProjectUiState();
    createNewConversation(projectId);
  }

  // Small floating menu (project options, "move chat to project")
  let popupMenuEl = null;
  function closePopupMenu() {
    if (popupMenuEl) { popupMenuEl.remove(); popupMenuEl = null; }
  }

  function showPopupMenu(anchor, items) {
    closePopupMenu();
    const menu = document.createElement('div');
    menu.className = 'sp-popup';
    items.forEach(it => {
      if (it.header) {
        const hd = document.createElement('div');
        hd.className = 'sp-popup-head';
        hd.textContent = it.header;
        menu.appendChild(hd);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sp-popup-item' + (it.danger ? ' danger' : '') + (it.active ? ' active' : '');
      b.innerHTML = `<span>${escapeHtml(it.label)}</span>${it.active ? '<span class="sp-check">✓</span>' : ''}`;
      b.addEventListener('click', (e) => { e.stopPropagation(); closePopupMenu(); it.onClick(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    popupMenuEl = menu;
    setTimeout(() => {
      document.addEventListener('click', closePopupMenu, { once: true });
    }, 0);
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopupMenu(); });
  window.addEventListener('resize', closePopupMenu);

  function openMoveMenu(anchor, convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const items = [{ header: 'Move to project' }];
    projects.forEach(p => {
      items.push({
        label: p.name,
        active: conv.projectId === p.id,
        onClick: () => moveConversationToProject(convId, p.id)
      });
    });
    if (projectOf(conv)) {
      items.push({ label: 'Remove from project', onClick: () => moveConversationToProject(convId, PROJ_NONE) });
    }
    items.push({ label: '＋ New project…', onClick: () => { pendingMoveConvId = convId; openProjectModal('new'); } });
    showPopupMenu(anchor, items);
  }

  let pendingMoveConvId = null;

  function moveConversationToProject(convId, projectId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    conv.projectId = projectId;
    if (projectId !== PROJ_NONE) expandedProjects[projectId] = true;
    saveProjectUiState();
    saveConversations();
    if (convId === activeConversationId) syncActiveProject();
    const p = projects.find(x => x.id === projectId);
    showToast(p ? `Moved to ${p.name}` : 'Removed from project');
  }

  function openProjectModal(projectId = null) {
    editingProjectId = projectId || activeProjectId;
    const isNew = editingProjectId === 'new';
    const proj = !isNew ? (projects.find(p => p.id === editingProjectId) || {}) : {
      name: '',
      description: '',
      instructions: '',
      files: []
    };
    if (!isNew && !proj.id) { showToast('Project not found'); return; }

    if (projectModalTitle) {
      projectModalTitle.textContent = isNew ? 'New project' : `Project: ${proj.name || 'Edit'}`;
    }
    if (projectNameInput) projectNameInput.value = proj.name || '';
    if (projectDescInput) projectDescInput.value = proj.description || '';
    if (projectInstructionsInput) projectInstructionsInput.value = proj.instructions || '';

    if (deleteProjectBtn) {
      deleteProjectBtn.style.display = !isNew ? 'block' : 'none';
    }

    if (projectNewFileContent) {
      projectNewFileContent.style.display = 'none';
      projectNewFileContent.value = '';
    }
    if (projectNewFileName) projectNewFileName.value = '';

    renderProjectFilesList(proj.files || []);
    if (projectModal) projectModal.style.display = 'flex';
    if (isNew && projectNameInput) setTimeout(() => projectNameInput.focus(), 50);
  }

  function renderProjectFilesList(files) {
    if (!projectFilesList) return;
    projectFilesList.innerHTML = '';
    if (!files || files.length === 0) {
      projectFilesList.innerHTML = '<span style="font-size: 12px; color: var(--text-secondary);">No reference files attached yet.</span>';
      return;
    }
    files.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'project-file-item';
      item.innerHTML = `
        <span>📄 <strong>${escapeHtml(f.name)}</strong> (${(f.content || '').length} chars)</span>
        <button type="button" class="btn-subtle remove-doc-btn" style="padding: 2px 6px; font-size: 11px; color:#ef4444;">Remove</button>
      `;
      item.querySelector('.remove-doc-btn').addEventListener('click', () => {
        files.splice(idx, 1);
        renderProjectFilesList(files);
      });
      projectFilesList.appendChild(item);
    });
  }

  async function saveProjectFromModal() {
    const name = projectNameInput.value.trim();
    if (!name) {
      showToast('Please enter a project name');
      return;
    }

    const desc = projectDescInput.value.trim();
    const instructions = projectInstructionsInput.value.trim();
    const wasNew = !editingProjectId || editingProjectId === 'new';

    let existing = projects.find(p => p.id === editingProjectId);
    let files = existing ? (existing.files || []) : [];

    if (projectNewFileName && projectNewFileName.value.trim() && projectNewFileContent && projectNewFileContent.value.trim()) {
      files.push({
        name: projectNewFileName.value.trim(),
        content: projectNewFileContent.value.trim()
      });
    }

    const projPayload = {
      id: wasNew ? null : editingProjectId,
      name: name,
      description: desc,
      instructions: instructions,
      files: files
    };

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(projPayload)
      });
      if (res.status === 401) { showToast('Please sign in again to save projects'); return; }
      if (res.ok) {
        const data = await res.json();
        const saved = data.project;
        const idx = projects.findIndex(p => p.id === saved.id);
        if (idx >= 0) {
          projects[idx] = saved;
        } else {
          projects.push(saved);
        }
        cacheProjects();
        expandedProjects[saved.id] = true;
        saveProjectUiState();
        if (projectModal) projectModal.style.display = 'none';
        if (wasNew && pendingMoveConvId) {
          const cid = pendingMoveConvId;
          pendingMoveConvId = null;
          moveConversationToProject(cid, saved.id);
        } else if (wasNew) {
          createNewConversation(saved.id);
        } else {
          renderSidebarHistory(chatSearchInput ? chatSearchInput.value : '');
          updateActiveProjectUI();
        }
        if (typeof updateAccountStats === 'function') updateAccountStats();
        showToast(wasNew ? `Project "${saved.name}" created` : 'Project saved');
      } else {
        showToast('Could not save the project');
      }
    } catch (e) {
      console.error('Error saving project', e);
      showToast('Error saving project');
    }
  }

  async function deleteProject(projectId) {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    if (!confirm(`Delete the project "${proj.name}"?\n\nIts chats are kept and moved back to your normal chat list.`)) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok) {
        projects = projects.filter(p => p.id !== projectId);
        cacheProjects();
        delete expandedProjects[projectId];
        saveProjectUiState();
        conversations.forEach(c => { if (c.projectId === projectId) c.projectId = PROJ_NONE; });
        saveConversations();
        syncActiveProject();
        if (projectModal) projectModal.style.display = 'none';
        if (typeof updateAccountStats === 'function') updateAccountStats();
        showToast('Project deleted');
      } else {
        showToast('Could not delete the project');
      }
    } catch (e) {
      console.error('Error deleting project', e);
    }
  }

  function deleteCurrentProject() {
    if (!editingProjectId || editingProjectId === 'new') return;
    deleteProject(editingProjectId);
  }

  // --- Photo Mode & Lightbox ---
  function togglePhotoMode(forceState) {
    isPhotoGenerationActive = forceState !== undefined ? forceState : !isPhotoGenerationActive;
    if (isPhotoGenerationActive && workModeActive) toggleWorkMode(false);
    if (imageGenToggleBtn) {
      imageGenToggleBtn.classList.toggle('active', isPhotoGenerationActive);
    }
    if (messageInput) {
      messageInput.placeholder = isPhotoGenerationActive
        ? 'Describe the photo to generate (e.g. futuristic cyberpunk tiger 8k)...'
        : 'Message Nova Insight...';
    }
    if (isPhotoGenerationActive) {
      showToast('🎨 Nova Insight Photo Studio active');
    }
  }


  // --- Work mode: Nova works for you (plans, writes files, runs code, reports back) ---
  function toggleWorkMode(forceState) {
    workModeActive = forceState !== undefined ? forceState : !workModeActive;
    if (workModeActive && isPhotoGenerationActive) togglePhotoMode(false);
    if (workToggleBtn) {
      workToggleBtn.classList.toggle('active', workModeActive);
      workToggleBtn.setAttribute('aria-pressed', workModeActive ? 'true' : 'false');
    }
    if (modeSwitch) {
      modeSwitch.setAttribute('data-mode', workModeActive ? 'work' : 'normal');
      [[modeNormalBtn, !workModeActive], [modeWorkBtn, workModeActive]].forEach(([btn, on]) => {
        if (!btn) return;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    document.body.classList.toggle('work-mode-on', workModeActive);
    if (messageInput) {
      messageInput.placeholder = workModeActive
        ? 'Tell Nova what to build or do (e.g. make a to-do web app)...'
        : 'Message Nova Insight...';
    }
    if (workModeActive) {
      showToast('🛠️ Work mode on: Nova will build, run and fix things for you');
    }
  }

  async function runWorkAgent(conv, assistantMsg, assistantRow, assistantContentEl, userMsg, text) {
    isStreaming = true;
    toggleStreamingUI(true);
    abortController = new AbortController();
    const signal = abortController.signal;
    const history = conv.messages.slice(0, -2).map(m => ({ role: m.role, content: messageWithAttachments(m, 3000) }));
    const att = getMsgAttachments(userMsg).map(at => attachmentContext(at, 6000)).join('');
    let lastHtml = '';
    let pending = null;
    let renderTimer = null;
    const paint = () => {
      renderTimer = null;
      if (!pending) return;
      const html = pending.html;
      const summary = pending.summary;
      pending = null;
      const feed = chatScrollFeed;
      const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200;
      assistantContentEl.innerHTML = html + (summary ? `<div class="work-summary">${renderMarkdownWithCodeBlocks(summary)}</div>` : '');
      if (stick && activeConversationId === conv.id && settings.autoScroll !== false) scrollToBottom();
    };
    const onUpdate = (html, summary) => {
      lastHtml = html;
      pending = { html, summary };
      if (renderTimer === null) renderTimer = setTimeout(paint, 120);
    };
    assistantContentEl.innerHTML = '';
    try {
      const out = await window.NovaWork.runAgent({
        convId: conv.id,
        userText: (text || 'Please look at the attached file.') + att,
        history,
        signal,
        model: currentModel,
        extraBody: {
          apiKey: settings.apiKey,
          geminiApiKey: settings.geminiApiKey,
          claudeApiKey: settings.claudeApiKey,
          baseUrl: settings.baseUrl,
          projectId: (conv.projectId && conv.projectId !== 'proj-default') ? conv.projectId : null,
          nickname: (settings.nickname || (userAccount && userAccount.name) || ''),
          systemPrompt: settings.systemPrompt || ''
        },
        headers: getAuthHeaders(),
        onUpdate
      });
      if (renderTimer !== null) { clearTimeout(renderTimer); renderTimer = null; }
      pending = { html: out.html, summary: out.summary };
      paint();
      assistantMsg.content = out.html + (out.summary ? '\n\n' + out.summary : '');
      if (typeof updateAccountStats === 'function') updateAccountStats();
    } catch (err) {
      if (renderTimer !== null) { clearTimeout(renderTimer); renderTimer = null; }
      console.error('Work mode error', err);
      assistantMsg.content = (lastHtml || '') + '\n\n⚠️ Work mode stopped unexpectedly. Your files are kept; tap send to continue.';
      assistantContentEl.innerHTML = lastHtml + '<div class="work-summary"><p>⚠️ Work mode stopped unexpectedly. Your files are kept; send a message to continue.</p></div>';
    } finally {
      assistantRow.classList.remove('streaming');
      isStreaming = false;
      toggleStreamingUI(false);
      abortController = null;
    }
    saveConversations();
    renderChatFeed();
    if (activeConversationId === conv.id && settings.autoScroll !== false) scrollToBottom();
    maybeGenerateTitle(conv);
  }

  function openImageLightbox(src) {
    if (!imageLightboxModal || !lightboxImg) return;
    lightboxImg.src = src;
    if (lightboxDownloadBtn) lightboxDownloadBtn.href = src;
    imageLightboxModal.style.display = 'flex';
  }

  // --- Event Listeners ---
  function attachEventListeners() {
    // Account Modal triggers
    if (userPill) {
      userPill.addEventListener('click', openAccountModal);
    }
    if (closeAccountBtn) {
      closeAccountBtn.addEventListener('click', () => { accountModal.style.display = 'none'; });
    }
    if (saveAccountBtn) {
      saveAccountBtn.addEventListener('click', saveUserAccount);
    }
    if (accountSignOutBtn) {
      accountSignOutBtn.addEventListener('click', handleLogout);
    }

    // Auth Tabs & Actions
    if (tabBtnSignIn && tabBtnRegister && panelSignIn && panelRegister) {
      tabBtnSignIn.addEventListener('click', () => {
        tabBtnSignIn.classList.add('active');
        tabBtnRegister.classList.remove('active');
        panelSignIn.style.display = 'block';
        panelRegister.style.display = 'none';
        if (loginStatusMsg) loginStatusMsg.textContent = '';
      });

      tabBtnRegister.addEventListener('click', () => {
        tabBtnRegister.classList.add('active');
        tabBtnSignIn.classList.remove('active');
        panelRegister.style.display = 'block';
        panelSignIn.style.display = 'none';
        if (regStatusMsg) regStatusMsg.textContent = '';
      });
    }

    if (submitLoginBtn) {
      submitLoginBtn.addEventListener('click', handleLogin);
    }
    if (loginPasswordInput) {
      loginPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
      });
    }

    if (submitRegisterBtn) {
      submitRegisterBtn.addEventListener('click', handleRegister);
    }
    if (regPasswordInput) {
      regPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleRegister();
      });
    }

    if (regAvatarPicker) {
      regAvatarPicker.querySelectorAll('.avatar-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          regAvatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    if (togglePasswordBtn && accPasswordInput) {
      togglePasswordBtn.addEventListener('click', () => {
        const isPw = accPasswordInput.type === 'password';
        accPasswordInput.type = isPw ? 'text' : 'password';
        if (pwEyeIcon) pwEyeIcon.textContent = isPw ? '🔒' : '👁️';
      });
    }
    if (avatarPicker) {
      avatarPicker.querySelectorAll('.avatar-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          avatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          pendingAvatar = null;
          paintAvatar(accountAvatarEmoji, btn.getAttribute('data-avatar'), '⚡');
        });
      });
    }

    // Projects (sidebar section) & modal triggers
    if (addProjectBtn) {
      addProjectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingMoveConvId = null;
        openProjectModal('new');
      });
    }
    const spToggleBtn = document.getElementById('spToggle');
    if (spToggleBtn) {
      spToggleBtn.addEventListener('click', () => {
        projectsSectionOpen = !projectsSectionOpen;
        saveProjectUiState();
        renderProjectsSidebar(chatSearchInput ? chatSearchInput.value : '');
      });
    }
    if (topNavProjectBadge) {
      topNavProjectBadge.addEventListener('click', () => {
        if (activeProjectId && activeProjectId !== PROJ_NONE) openProjectModal(activeProjectId);
      });
    }
    if (closeProjectBtn) {
      closeProjectBtn.addEventListener('click', () => { projectModal.style.display = 'none'; });
    }
    if (cancelProjectBtn) {
      cancelProjectBtn.addEventListener('click', () => { projectModal.style.display = 'none'; });
    }
    if (saveProjectBtn) {
      saveProjectBtn.addEventListener('click', saveProjectFromModal);
    }
    if (deleteProjectBtn) {
      deleteProjectBtn.addEventListener('click', deleteCurrentProject);
    }
    if (addProjectDocBtn && projectNewFileContent) {
      addProjectDocBtn.addEventListener('click', () => {
        const isHidden = projectNewFileContent.style.display === 'none';
        projectNewFileContent.style.display = isHidden ? 'block' : 'none';
        if (isHidden) projectNewFileContent.focus();
      });
    }

    // Work mode toggle
    if (window.NovaWork) {
      window.NovaWork.init({ userId: () => (userAccount && userAccount.id) || 'anon', toast: showToast });
    }
    if (workToggleBtn) {
      workToggleBtn.addEventListener('click', () => toggleWorkMode());
    }

    // Photo Generation Toggle
    if (imageGenToggleBtn) {
      imageGenToggleBtn.addEventListener('click', () => togglePhotoMode());
    }
    if (closeLightboxBtn) {
      closeLightboxBtn.addEventListener('click', () => { imageLightboxModal.style.display = 'none'; });
    }
    if (imageLightboxModal) {
      imageLightboxModal.addEventListener('click', (e) => {
        if (e.target === imageLightboxModal) imageLightboxModal.style.display = 'none';
      });
    }
    // Sidebar collapse / expand
    sidebarCollapseBtn.addEventListener('click', () => {
      appLayout.classList.add('sidebar-collapsed');
    });
    sidebarOpenBtn.addEventListener('click', () => {
      appLayout.classList.remove('sidebar-collapsed');
    });
    // On phones the sidebar slides over the chat: tapping the dimmed area outside it closes it again
    appLayout.addEventListener('click', (e) => {
      if (window.innerWidth > 768 || appLayout.classList.contains('sidebar-collapsed')) return;
      if (e.target.closest('.sidebar') || e.target.closest('#sidebarOpenBtn')) return;
      appLayout.classList.add('sidebar-collapsed');
    });

    // New chat
    newChatBtn.addEventListener('click', createNewConversation);

    // Keyboard shortcut Ctrl+K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        createNewConversation();
      }
    });

    // Search filter
    chatSearchInput.addEventListener('input', (e) => {
      renderSidebarHistory(e.target.value);
    });

    // Model dropdown (if present)
    if (modelSelectorBtn && modelDropdownMenu) {
      modelSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdownMenu.classList.toggle('active');
      });
    }
    if (modelSelectorWrap && modelDropdownMenu) {
      document.addEventListener('click', (e) => {
        if (!modelSelectorWrap.contains(e.target)) {
          modelDropdownMenu.classList.remove('active');
        }
      });
    }

    // Theme toggle
    themeToggleBtn.addEventListener('click', toggleTheme);

    // Settings modal
    settingsBtn.addEventListener('click', openSettings);
    const settingsBtnTopEl = document.getElementById('settingsBtnTop');
    if (settingsBtnTopEl) settingsBtnTopEl.addEventListener('click', openSettings);
    const exportChatsBtnEl = document.getElementById('exportChatsBtn');
    if (exportChatsBtnEl) exportChatsBtnEl.addEventListener('click', exportChats);
    closeSettingsBtn.addEventListener('click', closeSettings);
    cancelSettingsBtn.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', saveSettings);
    clearAllChatsBtn.addEventListener('click', clearAllConversations);
    settingTemperature.addEventListener('input', (e) => {
      tempValue.textContent = e.target.value;
    });

    // Theme selector inside Settings
    if (settingsThemeDark) {
      settingsThemeDark.addEventListener('click', () => applyTheme('dark'));
    }
    if (settingsThemeLight) {
      settingsThemeLight.addEventListener('click', () => applyTheme('light'));
    }
    if (settingsThemeSystem) {
      settingsThemeSystem.addEventListener('click', () => applyTheme('system'));
    }

    // Voice Changer controls inside Settings
    if (settingVoicePreset) {
      settingVoicePreset.addEventListener('change', (e) => applyVoicePreset(e.target.value));
    }
    if (settingVoicePitch && voicePitchVal) {
      settingVoicePitch.addEventListener('input', (e) => {
        voicePitchVal.textContent = e.target.value;
        if (settingVoicePreset) settingVoicePreset.value = 'custom';
      });
    }
    if (settingVoiceRate && voiceRateVal) {
      settingVoiceRate.addEventListener('input', (e) => {
        voiceRateVal.textContent = e.target.value;
        if (settingVoicePreset) settingVoicePreset.value = 'custom';
      });
    }
    if (settingVoiceVolume && voiceVolumeVal) {
      settingVoiceVolume.addEventListener('input', (e) => {
        voiceVolumeVal.textContent = e.target.value;
      });
    }
    if (testVoiceBtn) {
      testVoiceBtn.addEventListener('click', testVoiceSample);
    }

    // Voice Assistant Mode triggers & controls
    if (voiceAssistantModeBtn) {
      voiceAssistantModeBtn.addEventListener('click', openVoiceAssistantModal);
    }
    if (closeVoiceAssistantBtn) {
      closeVoiceAssistantBtn.addEventListener('click', closeVoiceAssistantModal);
    }
    if (voiceAssistantOrb) {
      voiceAssistantOrb.addEventListener('click', () => {
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          stopSpeechSynthesis();
          if (voiceAssistantModal) voiceAssistantModal.classList.remove('speaking');
          startVoiceAssistantListening();
        } else if (voiceAssistantRec && isVoiceAssistantActive) {
          // If already listening with text, send now
          if (currentVoiceTranscript && currentVoiceTranscript.trim()) {
            const q = currentVoiceTranscript.trim();
            currentVoiceTranscript = '';
            processVoiceAssistantQuery(q);
          } else {
            startVoiceAssistantListening();
          }
        } else {
          startVoiceAssistantListening();
        }
      });
    }
    if (voiceMicToggleBtn) {
      voiceMicToggleBtn.addEventListener('click', () => {
        if (voiceAssistantRec && isVoiceAssistantActive) {
          stopVoiceAssistantListening();
          if (voiceMicLabel) voiceMicLabel.textContent = "Mic Paused";
          if (voiceMicIcon) voiceMicIcon.textContent = "⏸️";
        } else {
          startVoiceAssistantListening();
          if (voiceMicLabel) voiceMicLabel.textContent = "Mic On";
          if (voiceMicIcon) voiceMicIcon.textContent = "🎙️";
        }
      });
    }
    if (voiceStopSpeakingBtn) {
      voiceStopSpeakingBtn.addEventListener('click', () => {
        stopSpeechSynthesis();
        if (voiceAssistantModal) voiceAssistantModal.classList.remove('speaking');
        startVoiceAssistantListening();
      });
    }
    if (voiceOpenSettingsBtn) {
      voiceOpenSettingsBtn.addEventListener('click', () => {
        closeVoiceAssistantModal();
        openSettings();
      });
    }
    if (voiceSendNowBtn) {
      voiceSendNowBtn.addEventListener('click', () => {
        if (currentVoiceTranscript && currentVoiceTranscript.trim()) {
          const q = currentVoiceTranscript.trim();
          currentVoiceTranscript = '';
          processVoiceAssistantQuery(q);
        }
      });
    }
    if (voiceQuickSendBtn && voiceQuickInput) {
      const handleQuickVoiceSend = () => {
        const text = voiceQuickInput.value.trim();
        if (!text) return;
        voiceQuickInput.value = '';
        processVoiceAssistantQuery(text);
      };
      voiceQuickSendBtn.addEventListener('click', handleQuickVoiceSend);
      voiceQuickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleQuickVoiceSend();
        }
      });
    }
    if (voiceSwitchHttpsBtn) {
      voiceSwitchHttpsBtn.addEventListener('click', () => {
        if (window.latestSecureTunnelUrl) {
          window.location.href = window.latestSecureTunnelUrl;
        } else {
          fetch('/api/tunnel-status')
            .then(r => r.json())
            .then(data => {
              if (data && data.url && data.url.startsWith('https://')) {
                window.location.href = data.url;
              } else {
                showToast('Please open the Cloudflare HTTPS link shown in Server Status');
              }
            })
            .catch(() => showToast('Could not fetch secure link'));
        }
      });
    }
    if (voiceRetryMicBtn) {
      voiceRetryMicBtn.addEventListener('click', () => {
        if (voicePermissionAlert) voicePermissionAlert.style.display = 'none';
        startVoiceAssistantListening();
      });
    }

    // Video Lightbox modal controls
    if (closeVideoLightboxBtn) {
      closeVideoLightboxBtn.addEventListener('click', closeVideoLightbox);
    }
    if (videoLightboxModal) {
      videoLightboxModal.addEventListener('click', (e) => {
        if (e.target === videoLightboxModal) closeVideoLightbox();
      });
    }

    // Mobile / iOS & Android modal
    if (mobileModalBtn) mobileModalBtn.addEventListener('click', openMobileModal);
    if (closeMobileModalBtn) closeMobileModalBtn.addEventListener('click', closeMobileModal);
    if (doneMobileModalBtn) doneMobileModalBtn.addEventListener('click', closeMobileModal);
    if (copyMobileUrlBtn && mobileUrlDisplay) {
      copyMobileUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(mobileUrlDisplay.textContent);
        showToast('Link copied to clipboard');
      });
    }

    // Fullscreen toggle
    if (fullscreenToggleBtn) {
      fullscreenToggleBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        }
      });
    }

    // Input handlers
    messageInput.addEventListener('input', () => {
      adjustTextareaHeight();
      updateSendButtonState();
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // With 'Press Enter to send' off, plain Enter just adds a new line and Ctrl/Cmd+Enter sends.
        if (settings.enterToSend === false && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        if (isStreaming) {
          showToast('Nova is still replying. Tap the stop button to cancel it.');
          return;
        }
        if (!sendBtn.disabled) {
          sendMessage();
        }
      }
    });

    // While a reply is streaming the send button is the stop button.
    sendBtn.addEventListener('click', () => {
      if (isStreaming) {
        stopStreaming();
      } else {
        sendMessage();
      }
    });

    // File attachments
    attachFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const picked = Array.from(e.target.files || []);
      fileInput.value = '';
      addFiles(picked);
    });
    // Paste photos straight into the message box
    messageInput.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^(image|video)\//.test(f.type));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
    // Drag & drop photos, videos and files anywhere on the page
    let dragDepth = 0;
    const dragHasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0);
    document.addEventListener('dragenter', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      if (dropOverlay) dropOverlay.classList.add('show');
    });
    document.addEventListener('dragover', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
    document.addEventListener('dragleave', (e) => {
      if (!dragHasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth && dropOverlay) dropOverlay.classList.remove('show');
    });
    document.addEventListener('drop', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      if (dropOverlay) dropOverlay.classList.remove('show');
      addFiles(e.dataTransfer.files);
    });

    // Normal / Work switch
    if (modeNormalBtn) modeNormalBtn.addEventListener('click', () => { if (workModeActive) toggleWorkMode(false); });
    if (modeWorkBtn) modeWorkBtn.addEventListener('click', () => { if (!workModeActive) toggleWorkMode(true); });

    // Profile photo
    const avatarPrev = document.getElementById('accountAvatarPreview');
    if (avatarPrev && avatarFileInput) {
      avatarPrev.addEventListener('click', () => avatarFileInput.click());
      avatarPrev.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatarFileInput.click(); } });
    }
    if (avatarUploadBtn && avatarFileInput) avatarUploadBtn.addEventListener('click', () => avatarFileInput.click());
    if (avatarFileInput) {
      avatarFileInput.addEventListener('change', () => {
        const f = avatarFileInput.files && avatarFileInput.files[0];
        avatarFileInput.value = '';
        chooseAvatarPhoto(f);
      });
    }
    if (avatarRemoveBtn) {
      avatarRemoveBtn.addEventListener('click', () => {
        pendingAvatar = null;
        if (avatarPicker) {
          avatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.toggle('active', b.getAttribute('data-avatar') === '⚡'));
        }
        saveUserAccount();
      });
    }

    // Web search toggle
    webSearchToggle.addEventListener('click', () => {
      isWebSearchActive = !isWebSearchActive;
      webSearchToggle.classList.toggle('active', isWebSearchActive);
      showToast(isWebSearchActive ? 'Web search enabled' : 'Web search disabled');
    });

    // Voice dictation
    voiceInputBtn.addEventListener('click', toggleVoiceInput);

    // 24/7 Server & Tunnel settings controls
    if (copyLocalWifiBtn && settingLocalWifiUrl) {
      copyLocalWifiBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(settingLocalWifiUrl.value).then(() => {
          showToast('Copied local Wi-Fi link to clipboard!');
        });
      });
    }

    if (copyPublicHttpsBtn && settingPublicHttpsUrl) {
      copyPublicHttpsBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(settingPublicHttpsUrl.value).then(() => {
          showToast('Copied public HTTPS link to clipboard!');
        });
      });
    }

    if (forceReconnectTunnelBtn) {
      forceReconnectTunnelBtn.addEventListener('click', async () => {
        showToast('Refreshing Cloudflare connector now...');
        try {
          await fetch('/api/tunnel-reconnect', { method: 'POST' });
          setTimeout(fetchTunnelStatus, 4000);
        } catch (e) {
          console.error(e);
        }
      });
    }

    if (saveTunnelConfigBtn) {
      saveTunnelConfigBtn.addEventListener('click', async () => {
        const token = settingCustomTunnelToken ? settingCustomTunnelToken.value.trim() : '';
        const domain = settingCustomTunnelDomain ? settingCustomTunnelDomain.value.trim() : '';
        showToast('Saving permanent tunnel configuration...');
        try {
          const res = await fetch('/api/tunnel-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_token: token, custom_domain: domain })
          });
          if (res.ok) {
            showToast('Permanent domain settings updated! Reconnecting...');
            setTimeout(fetchTunnelStatus, 4000);
          }
        } catch (e) {
          showToast('Error saving tunnel settings');
        }
      });
    }

    if (toggleAutostartBtn) {
      toggleAutostartBtn.addEventListener('click', async () => {
        try {
          const statusRes = await fetch('/api/tunnel-status');
          const statusData = await statusRes.json();
          const target = !statusData.autostart_enabled;
          const endpoint = target ? '/api/autostart/install' : '/api/autostart/uninstall';
          const res = await fetch(endpoint, { method: 'POST' });
          const resData = await res.json();
          if (resData.installed) {
            showToast('✅ Windows Startup Autostart is now ENABLED! Nova Insight starts on boot.');
          } else {
            showToast('ℹ️ Windows Startup Autostart is now DISABLED.');
          }
          fetchTunnelStatus();
        } catch (e) {
          showToast('Could not toggle autostart');
        }
      });
    }

    if (connRetryBtn) {
      connRetryBtn.addEventListener('click', async () => {
        if (connBannerText) connBannerText.textContent = 'Probing connection now...';
        try {
          const res = await fetch('/api/health');
          if (res.ok) {
            isCurrentlyDisconnected = false;
            if (connectionLostBanner) connectionLostBanner.classList.add('hidden');
            showToast('⚡ Connected to Nova Insight!');
          } else {
            showToast('Still attempting to reconnect...');
          }
        } catch (e) {
          showToast('Still attempting to reconnect...');
        }
      });
    }

    // Suggestion Cards
    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.getAttribute('data-prompt');
        if (prompt) {
          messageInput.value = prompt;
          adjustTextareaHeight();
          updateSendButtonState();
          sendMessage(prompt);
        }
      });
    });
  }

  // --- Kickoff ---
  window.addEventListener('DOMContentLoaded', init);

  // --- Mobile PWA (iOS & Android) Service Worker Registration ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('Nova Insight Mobile Service Worker active:', reg.scope);
      }).catch((err) => {
        console.warn('Service Worker registration notice:', err);
      });
    });
  }

  // --- Android PWA Native Install Prompt ---
  let deferredInstallPrompt = null;
  const installAppBtn = document.getElementById('installAppBtn');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installAppBtn && !isStandalone) installAppBtn.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installAppBtn) installAppBtn.style.display = 'none';
    showToast('Nova Insight installed! Open it from your home screen');
  });

  // iOS Safari has no install event: show the button with manual instructions
  if (isIOS && !isStandalone && installAppBtn) installAppBtn.style.display = 'inline-flex';

  if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installAppBtn.style.display = 'none';
      } else if (isIOS) {
        showToast('Tap the Share button, then "Add to Home Screen"');
      } else if (!window.isSecureContext) {
        showToast('Open the https:// public link to install');
      } else {
        showToast('Browser menu (⋮) → "Install app" / "Add to Home screen"');
      }
    });
  }

})();

