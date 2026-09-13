// ============================================================================
// CHITCHAT — APPLICATION LOGIC
// ============================================================================

const supabaseClient = window.supabase.createClient(
  'https://vcdtujvdvfhvyszmervz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZHR1anZkdmZodnlzem1lcnZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MTE3NTcsImV4cCI6MjEwMzk4Nzc1N30.DiRo39HTxg47vUDVvHm2Lltw6sQ57b5XxaBEhaZRCA4',
  {
    auth: { persistSession: true, autoRefreshToken: true }
  }
);

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const state = {
  session: null,
  me: null,
  conversations: [],
  activeConversationId: null,
  activeOtherUser: null,
  messages: [],
  messageChannel: null,
  typingChannel: null,
  presenceChannel: null,
  userSignalingChannel: null,
  _presenceDbChannel: null,
  conversationsChannel: null,
  onlineUserIds: new Set(),
  typingTimeout: null,
  lastTypingSentAt: 0,
  replyTarget: null,
  searchDebounce: null,
  userSearchDebounce: null,
  msgSearchQuery: ''
};

const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const ACCENTS = ['#3E5C76', '#B3541E', '#3E7C59', '#7C3E76', '#8A6D3B', '#3E76B3'];
const GIPHY_API_KEY = 'q0S1zwFZBSQSWzzE7GnoFqQh23gJbz8C';

// ---------------------------------------------------------------------------
// DOM SHORTCUTS
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// TOASTS & ERRORS
// ---------------------------------------------------------------------------
function toast(message, type = 'default', duration = 3200) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function friendlyError(err, fallback = 'Something went wrong') {
  const msg = (err && (err.message || err.error_description)) || '';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/already registered|duplicate key.*email/i.test(msg)) return 'An account with that email already exists.';
  if (/duplicate key.*username|profiles_username/i.test(msg)) return 'That username is already taken.';
  if (/password.*at least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/network|fetch/i.test(msg)) return 'Network error — check your connection and try again.';
  if (/JWT|expired|not authenticated/i.test(msg)) return 'Your session expired — please sign in again.';
  return msg || fallback;
}

// ---------------------------------------------------------------------------
// THEME & ACCENT & WALLPAPER
// ---------------------------------------------------------------------------
function initAppearance() {
  const theme = localStorage.getItem('kc_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const accent = localStorage.getItem('kc_accent') || ACCENTS[0];
  applyTheme(theme);
  applyAccent(accent);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('kc_theme', theme);
  qsa('.segmented-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}
function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(hex));
  localStorage.setItem('kc_accent', hex);
  qsa('.accent-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === hex));
}
function hexToRgb(hex) {
  const v = hex.replace('#', '');
  const num = parseInt(v, 16);
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}
function buildAccentSwatches() {
  const wrap = $('accent-swatches');
  wrap.innerHTML = '';
  ACCENTS.forEach(hex => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'accent-swatch';
    b.style.background = hex;
    b.dataset.accent = hex;
    b.addEventListener('click', () => applyAccent(hex));
    wrap.appendChild(b);
  });
  applyAccent(localStorage.getItem('kc_accent') || ACCENTS[0]);
}

function initWallpaper() {
  const saved = localStorage.getItem('chat_wallpaper');
  applyWallpaper(saved || null);
}

function applyWallpaper(dataUrl) {
  const container = $('messages-scroll');
  if (container) {
    container.style.backgroundImage = dataUrl ? `url('${dataUrl}')` : 'none';
  }
}

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------
function avatarUrl(profile) {
  if (profile && profile.avatar_url) return profile.avatar_url;
  return './default-avatar.svg';
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function formatDayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yest)) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}
function formatListTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffDays = Math.floor((today - d) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
// AUTHENTICATION
// ---------------------------------------------------------------------------
function showAuthError(el, err) {
  el.textContent = friendlyError(err);
}

$('show-register').addEventListener('click', () => {
  $('login-form').hidden = true;
  $('register-form').hidden = false;
});
$('show-login').addEventListener('click', () => {
  $('register-form').hidden = true;
  $('login-form').hidden = false;
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-submit');
  setBtnLoading(btn, true);
  $('login-error').textContent = '';
  try {
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    showAuthError($('login-error'), err);
  } finally {
    setBtnLoading(btn, false);
  }
});

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('register-submit');
  setBtnLoading(btn, true);
  $('register-error').textContent = '';
  try {
    const displayName = $('register-display-name').value.trim();
    const username = $('register-username').value.trim().toLowerCase();
    const email = $('register-email').value.trim();
    const password = $('register-password').value;

    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
      throw new Error('Username must be 3–20 characters: letters, numbers, "_" or "."');
    }
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');

    const { data: existing } = await supabaseClient.from('profiles').select('id').eq('username', username).maybeSingle();
    if (existing) throw new Error('That username is already taken.');

    const { error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: { username, display_name: displayName } }
    });
    if (error) throw error;
    toast('Account created! You\'re signed in.', 'success');
  } catch (err) {
    showAuthError($('register-error'), err);
  } finally {
    setBtnLoading(btn, false);
  }
});

$('forgot-password-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  if (!email) { $('login-error').textContent = 'Enter your email above first, then click "Forgot password?"'; return; }
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) throw error;
    toast('Password reset email sent.', 'success');
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
});

$('logout-btn').addEventListener('click', async () => {
  await setPresence(false);
  await supabaseClient.auth.signOut();
});

function setBtnLoading(btn, loading) {
  btn.disabled = loading;
  qs('.btn-label', btn).style.visibility = loading ? 'hidden' : 'visible';
  const spinner = qs('.btn-spinner', btn);
  if (spinner) spinner.hidden = !loading;
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  state.session = session;
  if (session && event !== 'TOKEN_REFRESHED') {
    bootApp();
  } else if (!session) {
    teardownApp();
  }
});

async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  if (state.session) {
    bootApp();
  }
}

// ---------------------------------------------------------------------------
// APP BOOT & TEARDOWN (SELF-HEALING)
// ---------------------------------------------------------------------------
let appBooted = false;

async function bootApp() {
  if (appBooted) return;
  appBooted = true;

  try {
    const user = state.session?.user;
    if (!user) throw new Error('No active session');

    const userId = user.id;
    let { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    // Auto-create profile if delayed by database trigger
    if (!profile) {
      const fallbackName = user.user_metadata?.display_name || user.email.split('@')[0];
      const fallbackUsername = (user.user_metadata?.username || user.email.split('@')[0]).toLowerCase();

      const { data: created, error: createErr } = await supabaseClient
        .from('profiles')
        .upsert({
          id: userId,
          display_name: fallbackName,
          username: fallbackUsername,
          is_online: true,
          last_seen: new Date().toISOString()
        })
        .select()
        .single();

      if (createErr) throw createErr;
      profile = created;
    }

    state.me = profile;
    $('auth-screen').hidden = true;
    $('app-shell').hidden = false;

    renderMyAvatar();
    initWallpaper();
    await setPresence(true);
    subscribeGlobalPresence();
    subscribeConversationsRealtime();
    await loadConversations();

    window.addEventListener('beforeunload', () => { 
      navigator.sendBeacon && setPresence(false); 
    });
  } catch (err) {
    console.error('Boot error:', err);
    appBooted = false;
    toast(friendlyError(err, 'Failed to log in.'), 'error');
  }
}

function teardownApp() {
  appBooted = false;
  state.me = null;
  state.conversations = [];
  state.activeConversationId = null;
  cleanupActiveConversationChannels();
  if (state.presenceChannel) supabaseClient.removeChannel(state.presenceChannel);
  if (state.userSignalingChannel) supabaseClient.removeChannel(state.userSignalingChannel);
  if (state._presenceDbChannel) {
    supabaseClient.removeChannel(state._presenceDbChannel);
    state._presenceDbChannel = null;
  }
  if (state.conversationsChannel) supabaseClient.removeChannel(state.conversationsChannel);
  state.presenceChannel = null;
  state.userSignalingChannel = null;
  state.conversationsChannel = null;
  $('app-shell').hidden = true;
  $('auth-screen').hidden = false;
  $('login-form').hidden = false;
  $('register-form').hidden = true;
  $('login-form').reset();
  $('register-form').reset();
}

function renderMyAvatar() {
  $('my-avatar').src = avatarUrl(state.me);
  $('my-avatar').alt = state.me.display_name;
}

// ---------------------------------------------------------------------------
// PRESENCE & DIRECT SIGNALING (GLOBAL LISTENER FOR CALLS)
// ---------------------------------------------------------------------------
async function setPresence(online) {
  if (!state.me) return;
  try {
    await supabaseClient.from('profiles').update({
      is_online: online,
      last_seen: new Date().toISOString()
    }).eq('id', state.me.id);
  } catch (_) {}
}

function subscribeGlobalPresence() {
  if (state.presenceChannel) {
    try { supabaseClient.removeChannel(state.presenceChannel); } catch (_) {}
    state.presenceChannel = null;
  }

  const channel = supabaseClient.channel('presence:global', {
    config: { presence: { key: state.me.id } }
  });

  channel.on('presence', { event: 'sync' }, () => {
    const presenceState = channel.presenceState();
    state.onlineUserIds = new Set(Object.keys(presenceState));
    refreshOnlineIndicators();
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ online_at: new Date().toISOString() });
    }
  });

  state.presenceChannel = channel;

  // Direct personal channel for incoming WebRTC calls
  if (state.userSignalingChannel) {
    try { supabaseClient.removeChannel(state.userSignalingChannel); } catch (_) {}
  }

  state.userSignalingChannel = supabaseClient
    .channel(`user:${state.me.id}`)
    .on('broadcast', { event: 'webrtc_signal' }, ({ payload }) => {
      handleIncomingWebRTCSignal(payload);
    })
    .subscribe();

  if (state._presenceDbChannel) {
    try { supabaseClient.removeChannel(state._presenceDbChannel); } catch (_) {}
    state._presenceDbChannel = null;
  }

  const dbChannel = supabaseClient
    .channel('presence:profiles-db')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
      if (state.activeOtherUser && payload.new.id === state.activeOtherUser.id) {
        state.activeOtherUser = { ...state.activeOtherUser, ...payload.new };
        renderChatHeaderStatus();
      }
      const conv = state.conversations.find(c => c.otherUser && c.otherUser.id === payload.new.id);
      if (conv) {
        conv.otherUser = { ...conv.otherUser, ...payload.new };
        renderConversationList();
      }
    })
    .subscribe();

  state._presenceDbChannel = dbChannel;

  window.addEventListener('pagehide', () => { setPresence(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') setPresence(false);
    else setPresence(true);
  });
}

function isUserOnline(userId) {
  return state.onlineUserIds.has(userId);
}

function refreshOnlineIndicators() {
  renderConversationList();
  if (state.activeOtherUser) renderChatHeaderStatus();
}

// ---------------------------------------------------------------------------
// CONVERSATIONS
// ---------------------------------------------------------------------------
async function loadConversations() {
  $('conversations-loading').hidden = false;
  $('conversations-empty').hidden = true;
  try {
    const { data: memberships, error } = await supabaseClient
      .from('conversation_members')
      .select('conversation_id, is_pinned, is_muted, last_read_at, conversations(id, last_message_at, updated_at)')
      .eq('user_id', state.me.id);
    if (error) throw error;

    const convIds = memberships.map(m => m.conversation_id);
    if (convIds.length === 0) {
      state.conversations = [];
      renderConversationList();
      return;
    }

    const { data: allMembers } = await supabaseClient
      .from('conversation_members')
      .select('conversation_id, user_id, profiles(id, username, display_name, avatar_url, is_online, last_seen, bio)')
      .in('conversation_id', convIds);

    const { data: lastMessages } = await supabaseClient
      .from('messages')
      .select('id, conversation_id, content, message_type, sender_id, created_at, is_deleted')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    const lastMsgByConv = {};
    for (const m of lastMessages || []) {
      if (!lastMsgByConv[m.conversation_id]) lastMsgByConv[m.conversation_id] = m;
    }

    const unreadCounts = await computeUnreadCounts(convIds, memberships);

    state.conversations = memberships.map(m => {
      const other = (allMembers || []).find(x => x.conversation_id === m.conversation_id && x.user_id !== state.me.id);
      return {
        id: m.conversation_id,
        isPinned: m.is_pinned,
        isMuted: m.is_muted,
        lastReadAt: m.last_read_at,
        lastMessageAt: m.conversations ? m.conversations.last_message_at : null,
        otherUser: other ? other.profiles : null,
        lastMessage: lastMsgByConv[m.conversation_id] || null,
        unreadCount: unreadCounts[m.conversation_id] || 0
      };
    }).filter(c => c.otherUser);

    renderConversationList();
  } catch (err) {
    toast(friendlyError(err, 'Could not load conversations'), 'error');
  } finally {
    $('conversations-loading').hidden = true;
  }
}

async function computeUnreadCounts(convIds, memberships) {
  const counts = {};
  const byConv = {};
  memberships.forEach(m => byConv[m.conversation_id] = m.last_read_at);
  const { data } = await supabaseClient
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .in('conversation_id', convIds)
    .neq('sender_id', state.me.id);
  (data || []).forEach(m => {
    const readAt = byConv[m.conversation_id];
    if (!readAt || new Date(m.created_at) > new Date(readAt)) {
      counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1;
    }
  });
  return counts;
}

function sortedConversations() {
  return [...state.conversations].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const at = a.lastMessage ? a.lastMessage.created_at : a.lastMessageAt;
    const bt = b.lastMessage ? b.lastMessage.created_at : b.lastMessageAt;
    return new Date(bt) - new Date(at);
  });
}

function renderConversationList() {
  const list = $('conversation-list');
  qsa('.conv-item').forEach(el => el.remove());
  const sorted = sortedConversations();

  $('conversations-empty').hidden = sorted.length > 0;

  sorted.forEach(conv => {
    const item = document.createElement('button');
    item.className = 'conv-item' + (conv.id === state.activeConversationId ? ' active' : '') + (conv.unreadCount > 0 ? ' unread' : '');
    item.dataset.id = conv.id;

    const online = isUserOnline(conv.otherUser.id);
    const preview = conv.lastMessage
      ? (conv.lastMessage.is_deleted ? 'This message was deleted'
        : conv.lastMessage.message_type === 'image' ? '📷 Photo'
        : conv.lastMessage.message_type === 'video' ? '🎥 Video'
        : conv.lastMessage.message_type === 'audio' ? '🎙️ Voice note'
        : conv.lastMessage.message_type === 'call' ? '📞 Call'
        : conv.lastMessage.message_type === 'file' ? '📁 Attachment'
        : conv.lastMessage.content)
      : 'Say hello 👋';

    item.innerHTML = `
      <div class="conv-item-avatar-wrap">
        <img class="avatar avatar-sm" src="${avatarUrl(conv.otherUser)}" alt="" />
        <span class="presence-dot ${online ? 'online' : ''}"></span>
      </div>
      <div class="conv-item-body">
        <div class="conv-item-top">
          <span class="conv-item-name">${conv.isPinned ? '<span class="pin-icon">📌</span>' : ''}${escapeHtml(conv.otherUser.display_name)}</span>
          <span class="conv-item-time">${conv.lastMessage ? formatListTime(conv.lastMessage.created_at) : ''}</span>
        </div>
        <div class="conv-item-bottom">
          <span class="conv-item-preview">${escapeHtml(preview)}</span>
          ${conv.isMuted ? '<span class="mute-icon">🔇</span>' : ''}
          ${conv.unreadCount > 0 && !conv.isMuted ? `<span class="unread-badge">${conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>` : ''}
        </div>
      </div>
    `;
    item.addEventListener('click', () => openConversation(conv.id));
    list.appendChild(item);
  });
}

function subscribeConversationsRealtime() {
  const channel = supabaseClient
    .channel('conversations:messages-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      handleIncomingMessageForSidebar(payload.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${state.me.id}` }, (payload) => {
      const conv = state.conversations.find(c => c.id === payload.new.conversation_id);
      if (conv) {
        conv.isPinned = payload.new.is_pinned;
        conv.isMuted = payload.new.is_muted;
        conv.lastReadAt = payload.new.last_read_at;
        renderConversationList();
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${state.me.id}` }, () => {
      loadConversations();
    })
    .subscribe();
  state.conversationsChannel = channel;
}

async function handleIncomingMessageForSidebar(msg) {
  let conv = state.conversations.find(c => c.id === msg.conversation_id);
  if (!conv) {
    await loadConversations();
    return;
  }
  conv.lastMessage = msg;
  if (msg.sender_id !== state.me.id && msg.conversation_id !== state.activeConversationId) {
    conv.unreadCount = (conv.unreadCount || 0) + 1;
  }
  renderConversationList();
}

// ---------------------------------------------------------------------------
// SEARCH & OPEN CONVERSATIONS
// ---------------------------------------------------------------------------
$('user-search-input').addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const results = $('user-search-results');
  if (!q) { results.hidden = true; results.innerHTML = ''; return; }
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .neq('id', state.me.id)
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(12);
    if (error) throw error;
    results.innerHTML = '';
    if (!data || data.length === 0) {
      results.innerHTML = `<div class="empty-state" style="padding:16px;"><p class="empty-sub">No users found</p></div>`;
    } else {
      data.forEach(u => {
        const item = document.createElement('button');
        item.className = 'search-result-item';
        item.innerHTML = `
          <img class="avatar avatar-sm" src="${avatarUrl(u)}" alt="" />
          <div>
            <div class="search-result-name">${escapeHtml(u.display_name)}</div>
            <div class="search-result-username">@${escapeHtml(u.username)}</div>
          </div>`;
        item.addEventListener('click', () => startConversationWith(u));
        results.appendChild(item);
      });
    }
    results.hidden = false;
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
}, 300));

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) $('user-search-results').hidden = true;
});

async function startConversationWith(user) {
  $('user-search-input').value = '';
  $('user-search-results').hidden = true;
  try {
    const { data, error } = await supabaseClient.rpc('get_or_create_direct_conversation', { other_user_id: user.id });
    if (error) throw error;
    await loadConversations();
    openConversation(data);
  } catch (err) {
    toast(friendlyError(err, 'Could not start conversation'), 'error');
  }
}

// ---------------------------------------------------------------------------
// ACTIVE CONVERSATION & MESSAGES
// ---------------------------------------------------------------------------
function cleanupActiveConversationChannels() {
  if (state.messageChannel) { supabaseClient.removeChannel(state.messageChannel); state.messageChannel = null; }
  if (state.typingChannel) { supabaseClient.removeChannel(state.typingChannel); state.typingChannel = null; }
}

async function openConversation(conversationId) {
  cleanupActiveConversationChannels();
  state.activeConversationId = conversationId;
  state.replyTarget = null;
  hideReplyPreview();
  $('msg-search-bar').hidden = true;
  $('msg-search-input').value = '';
  state.msgSearchQuery = '';

  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv) return;
  state.activeOtherUser = conv.otherUser;

  $('chat-empty-state').hidden = true;
  $('chat-active').hidden = false;
  $('app-shell').classList.add('mobile-chat-open');

  $('chat-header-avatar').src = avatarUrl(conv.otherUser);
  $('chat-header-name').textContent = conv.otherUser.display_name;
  renderChatHeaderStatus();
  updateChatMenuLabels(conv);
  initWallpaper();

  renderConversationList();

  await loadMessages(conversationId);
  subscribeToConversation(conversationId);
  await markConversationRead(conversationId);
}

function renderChatHeaderStatus() {
  if (!state.activeOtherUser) return;
  const online = isUserOnline(state.activeOtherUser.id);
  $('chat-header-status').textContent = online ? 'Online' : lastSeenLabel(state.activeOtherUser.last_seen);
}
function lastSeenLabel(iso) {
  if (!iso) return 'Offline';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  return `Last seen ${Math.floor(hrs / 24)}d ago`;
}

function updateChatMenuLabels(conv) {
  const pinBtn = qs('[data-action="pin"]', $('chat-menu'));
  const muteBtn = qs('[data-action="mute"]', $('chat-menu'));
  pinBtn.textContent = conv.isPinned ? 'Unpin conversation' : 'Pin conversation';
  muteBtn.textContent = conv.isMuted ? 'Unmute conversation' : 'Mute conversation';
}

$('back-to-list-btn').addEventListener('click', () => {
  $('app-shell').classList.remove('mobile-chat-open');
});

$('chat-header-user-btn').addEventListener('click', () => {
  if (!state.activeOtherUser) return;
  $('other-avatar').src = avatarUrl(state.activeOtherUser);
  $('other-display-name').textContent = state.activeOtherUser.display_name || 'User';
  $('other-username').textContent = `@${state.activeOtherUser.username || ''}`;
  $('other-bio').textContent = state.activeOtherUser.bio || 'No bio written yet.';
  $('other-profile-modal').hidden = false;
});
$('close-other-profile-btn').addEventListener('click', () => { $('other-profile-modal').hidden = true; });
$('other-profile-modal').addEventListener('click', (e) => {
  if (e.target === $('other-profile-modal')) $('other-profile-modal').hidden = true;
});

async function loadMessages(conversationId) {
  $('messages-loading').hidden = false;
  $('messages-empty').hidden = true;
  $('messages-list').innerHTML = '';
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*, message_reactions(id, user_id, reaction), message_reads(user_id, read_at)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    state.messages = data || [];
    renderMessages();
    scrollMessagesToBottom();
  } catch (err) {
    toast(friendlyError(err, 'Could not load messages'), 'error');
  } finally {
    $('messages-loading').hidden = true;
  }
}

function scrollMessagesToBottom() {
  const el = $('messages-scroll');
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function renderMessages() {
  const list = $('messages-list');
  list.innerHTML = '';
  const visible = state.messages.filter(m => !state.msgSearchQuery || (m.content || '').toLowerCase().includes(state.msgSearchQuery));

  $('messages-empty').hidden = state.messages.length > 0;

  let lastDay = null;
  let lastSender = null;
  visible.forEach((msg) => {
    const day = formatDayLabel(msg.created_at);
    if (day !== lastDay) {
      const divider = document.createElement('div');
      divider.className = 'day-divider';
      divider.textContent = day;
      list.appendChild(divider);
      lastDay = day;
      lastSender = null;
    }
    list.appendChild(renderMessageRow(msg, msg.sender_id === lastSender));
    lastSender = msg.sender_id;
  });
}

function renderMessageRow(msg, grouped) {
  const mine = msg.sender_id === state.me.id;
  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`;
  row.dataset.id = msg.id;
  if (state.msgSearchQuery && (msg.content || '').toLowerCase().includes(state.msgSearchQuery)) {
    row.classList.add('msg-highlight');
  }

  const wrap = document.createElement('div');
  wrap.className = 'msg-bubble-wrap';

  const hoverActions = document.createElement('div');
  hoverActions.className = 'msg-hover-actions';
  if (!msg.is_deleted) {
    hoverActions.innerHTML = `
      <button data-act="react" title="React">❤</button>
      <button data-act="reply" title="Reply">↩</button>
      ${mine ? '<button data-act="edit" title="Edit">✎</button><button data-act="delete" title="Delete">🗑</button>' : ''}
    `;
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble' + (msg.message_type === 'image' && !msg.is_deleted ? ' image-bubble' : '') + (msg.is_deleted ? ' deleted' : '');

  if (msg.is_deleted) {
    bubble.textContent = 'This message was deleted';
  } else {
    let inner = '';
    if (msg.reply_to_id) {
      const original = state.messages.find(m => m.id === msg.reply_to_id);
      if (original) {
        const label = original.is_deleted ? 'This message was deleted' : (original.message_type === 'image' ? '📷 Photo' : original.content);
        inner += `<div class="msg-reply-quote">${escapeHtml((label || '').slice(0, 80))}</div>`;
      }
    }

    if (msg.message_type === 'image' && msg.media_url) {
      inner += `<img class="msg-image" src="${msg.media_url}" alt="Photo" />`;
      if (msg.content && msg.content !== 'GIF') inner += `<div style="padding:6px 4px 2px;">${escapeHtml(msg.content)}</div>`;
    } else if (msg.message_type === 'video' && msg.media_url) {
      inner += `<video controls playsinline class="msg-video" style="max-width:100%; border-radius:8px;" src="${msg.media_url}"></video>`;
      if (msg.content) inner += `<div style="padding:4px 2px; font-size:12px; opacity:0.8;">${escapeHtml(msg.content)}</div>`;
    } else if (msg.message_type === 'audio' && msg.media_url) {
      inner += `<audio controls style="max-width: 240px; height: 36px;" src="${msg.media_url}"></audio>`;
      if (msg.content) inner += `<div style="padding:2px 4px; font-size:11px; opacity:0.75;">${escapeHtml(msg.content)}</div>`;
    } else if (msg.message_type === 'call') {
      inner += `<strong>${escapeHtml(msg.content || '📞 Call invitation')}</strong>`;
    } else if (msg.message_type === 'file' && msg.media_url) {
      inner += `<a href="${msg.media_url}" target="_blank" download style="display:flex; align-items:center; gap:8px; text-decoration:underline; word-break:break-all;">
                  📁 <span>${escapeHtml(msg.content || 'Download Attachment')}</span>
                </a>`;
    } else {
      inner += escapeHtml(msg.content || '');
    }
    bubble.innerHTML = inner;

    const img = qs('img.msg-image', bubble);
    if (img) img.addEventListener('click', () => openImagePreview(msg.media_url));
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const seen = mine && msg.message_reads && msg.message_reads.length > 0;
  meta.innerHTML = `
    <span>${formatTime(msg.created_at)}</span>
    ${msg.is_edited && !msg.is_deleted ? '<span class="edited-tag">· edited</span>' : ''}
    ${mine ? `<span class="${seen ? 'seen-tick' : ''}">${seen ? '✓✓' : '✓'}</span>` : ''}
  `;

  const reactionsEl = renderReactions(msg);

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  if (reactionsEl) wrap.appendChild(reactionsEl);

  if (mine) { row.appendChild(hoverActions); row.appendChild(wrap); }
  else { row.appendChild(wrap); row.appendChild(hoverActions); }

  bindMessageActions(row, msg, bubble);
  return row;
}

function renderReactions(msg) {
  if (!msg.message_reactions || msg.message_reactions.length === 0) return null;
  const counts = {};
  msg.message_reactions.forEach(r => {
    counts[r.reaction] = counts[r.reaction] || { count: 0, mine: false };
    counts[r.reaction].count++;
    if (r.user_id === state.me.id) counts[r.reaction].mine = true;
  });
  const el = document.createElement('div');
  el.className = 'msg-reactions';
  Object.entries(counts).forEach(([emoji, info]) => {
    const pill = document.createElement('button');
    pill.className = 'reaction-pill' + (info.mine ? ' mine' : '');
    pill.innerHTML = `<span>${emoji}</span><span>${info.count}</span>`;
    pill.addEventListener('click', () => toggleReaction(msg.id, emoji, info.mine));
    el.appendChild(pill);
  });
  return el;
}

function bindMessageActions(row, msg, bubble) {
  const reactBtn = qs('[data-act="react"]', row);
  const replyBtn = qs('[data-act="reply"]', row);
  const editBtn = qs('[data-act="edit"]', row);
  const deleteBtn = qs('[data-act="delete"]', row);

  if (reactBtn) reactBtn.addEventListener('click', (e) => openReactionPicker(e, msg));
  if (replyBtn) replyBtn.addEventListener('click', () => setReplyTarget(msg));
  if (editBtn) editBtn.addEventListener('click', () => startEditMessage(row, msg, bubble));
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteMessage(msg));
}

function openReactionPicker(e, msg) {
  e.preventDefault();
  e.stopPropagation();

  qsa('.reaction-picker').forEach(p => p.remove());

  const row = e.currentTarget.closest('.msg-row');
  if (!row) return;

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';

  REACTIONS.forEach(emoji => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;

    const handlePick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      picker.remove();

      const already = (msg.message_reactions || []).some(
        r => r.user_id === state.me.id && r.reaction === emoji
      );
      await toggleReaction(msg.id, emoji, already);
    };

    b.addEventListener('pointerdown', handlePick);
    b.addEventListener('click', handlePick);
    picker.appendChild(b);
  });

  row.appendChild(picker);

  const outsideCloser = (ev) => {
    if (!picker.contains(ev.target) && !e.currentTarget.contains(ev.target)) {
      picker.remove();
      document.removeEventListener('pointerdown', outsideCloser);
      document.removeEventListener('touchstart', outsideCloser);
    }
  };

  setTimeout(() => {
    document.addEventListener('pointerdown', outsideCloser);
    document.addEventListener('touchstart', outsideCloser);
  }, 100);
}

async function toggleReaction(messageId, emoji, removing) {
  if (!state.me) return;

  const msg = state.messages.find(m => m.id === messageId);
  if (!msg) return;
  msg.message_reactions = msg.message_reactions || [];

  if (removing) {
    msg.message_reactions = msg.message_reactions.filter(
      r => !(r.user_id === state.me.id && r.reaction === emoji)
    );
  } else {
    msg.message_reactions.push({
      id: 'temp-' + Date.now(),
      message_id: messageId,
      user_id: state.me.id,
      reaction: emoji
    });
  }
  renderMessages();

  try {
    if (removing) {
      const { error } = await supabaseClient
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', state.me.id)
        .eq('reaction', emoji);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient
        .from('message_reactions')
        .insert({
          message_id: messageId,
          user_id: state.me.id,
          reaction: emoji
        })
        .select()
        .single();
      if (error) throw error;
      const temp = msg.message_reactions.find(r => r.user_id === state.me.id && r.reaction === emoji);
      if (temp && data) temp.id = data.id;
    }
  } catch (err) {
    toast(friendlyError(err, 'Reaction failed'), 'error');
    if (state.activeConversationId) await loadMessages(state.activeConversationId);
  }
}

function setReplyTarget(msg) {
  state.replyTarget = msg;
  $('reply-preview').hidden = false;
  $('reply-preview-name').textContent = msg.sender_id === state.me.id ? 'yourself' : state.activeOtherUser.display_name;
  $('reply-preview-text').textContent = msg.is_deleted ? 'This message was deleted' : (msg.message_type === 'image' ? '📷 Photo' : msg.content);
  $('message-input').focus();
}
function hideReplyPreview() {
  $('reply-preview').hidden = true;
  state.replyTarget = null;
}
$('reply-preview-cancel').addEventListener('click', hideReplyPreview);

function startEditMessage(row, msg, bubble) {
  const wrap = qs('.msg-bubble-wrap', row);
  bubble.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'msg-edit-box';
  box.innerHTML = `<textarea>${escapeHtml(msg.content || '')}</textarea><button class="btn-secondary" data-x="save">Save</button><button class="btn-secondary" data-x="cancel">Cancel</button>`;
  wrap.insertBefore(box, bubble);
  const ta = qs('textarea', box);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  qs('[data-x="cancel"]', box).addEventListener('click', () => { box.remove(); bubble.style.display = ''; });
  qs('[data-x="save"]', box).addEventListener('click', async () => {
    const newContent = ta.value.trim();
    if (!newContent) { toast('Message can\'t be empty', 'error'); return; }
    try {
      const { error } = await supabaseClient.from('messages')
        .update({ content: newContent, is_edited: true })
        .eq('id', msg.id).eq('sender_id', state.me.id);
      if (error) throw error;
      box.remove();
      bubble.style.display = '';
    } catch (err) {
      toast(friendlyError(err, 'Could not edit message'), 'error');
    }
  });
}

async function deleteMessage(msg) {
  if (!confirm('Delete this message? This can\'t be undone.')) return;
  try {
    const { error } = await supabaseClient.from('messages')
      .update({ is_deleted: true, content: null, media_url: null })
      .eq('id', msg.id).eq('sender_id', state.me.id);
    if (error) throw error;
    toast('Message deleted', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Could not delete message'), 'error');
  }
}

function openImagePreview(url) {
  $('image-preview-img').src = url;
  $('image-preview-modal').hidden = false;
}
$('close-image-preview-btn').addEventListener('click', () => { $('image-preview-modal').hidden = true; });
$('image-preview-modal').addEventListener('click', (e) => { if (e.target === $('image-preview-modal')) $('image-preview-modal').hidden = true; });

// ---------------------------------------------------------------------------
// REALTIME: MESSAGES & TYPING
// ---------------------------------------------------------------------------
function subscribeToConversation(conversationId) {
  const channel = supabaseClient
    .channel(`conv:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      if (state.messages.some(m => m.id === payload.new.id)) return;
      state.messages.push({ ...payload.new, message_reactions: [], message_reads: [] });
      renderMessages();
      scrollMessagesToBottom();
      if (payload.new.sender_id !== state.me.id) {
        markConversationRead(conversationId);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const idx = state.messages.findIndex(m => m.id === payload.new.id);
      if (idx >= 0) {
        state.messages[idx] = { ...state.messages[idx], ...payload.new };
        renderMessages();
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (payload) => {
      const msg = state.messages.find(m => m.id === payload.new.message_id);
      if (msg) {
        msg.message_reactions = msg.message_reactions || [];
        if (!msg.message_reactions.some(r => r.id === payload.new.id)) msg.message_reactions.push(payload.new);
        renderMessages();
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (payload) => {
      state.messages.forEach(m => {
        if (m.message_reactions) m.message_reactions = m.message_reactions.filter(r => r.id !== payload.old.id);
      });
      renderMessages();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads' }, (payload) => {
      applyReadReceipt(payload.new);
    })
    .subscribe();

  state.messageChannel = channel;

  const typingChannel = supabaseClient
    .channel(`typing:${conversationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'typing_indicators', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const row = payload.new;
      if (!row || row.user_id === state.me.id) return;
      const updatedAgoMs = Date.now() - new Date(row.updated_at).getTime();
      if (updatedAgoMs < 6000) showTypingIndicator();
    })
    .subscribe();
  state.typingChannel = typingChannel;
}

function applyReadReceipt(read) {
  const msg = state.messages.find(m => m.id === read.message_id);
  if (msg) {
    msg.message_reads = msg.message_reads || [];
    if (!msg.message_reads.some(r => r.user_id === read.user_id)) msg.message_reads.push(read);
    renderMessages();
  }
}

let typingIndicatorTimeout = null;
function showTypingIndicator() {
  const el = $('typing-indicator');
  el.textContent = `${state.activeOtherUser ? state.activeOtherUser.display_name : 'Someone'} is typing…`;
  el.hidden = false;
  clearTimeout(typingIndicatorTimeout);
  typingIndicatorTimeout = setTimeout(() => { el.hidden = true; }, 3000);
}

async function markConversationRead(conversationId) {
  try {
    await supabaseClient.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    const conv = state.conversations.find(c => c.id === conversationId);
    if (conv) { conv.unreadCount = 0; renderConversationList(); }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// MESSAGE COMPOSER & SENDING
// ---------------------------------------------------------------------------
const messageInput = $('message-input');
messageInput.addEventListener('input', () => {
  autoResize(messageInput);
  sendTypingSignal();
});

messageInput.addEventListener('keydown', (e) => {
  const isEnter = e.key === 'Enter' || e.keyCode === 13 || e.which === 13;
  if (isEnter && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (messageInput.value.trim()) {
      $('message-form').requestSubmit();
    }
  }
});

messageInput.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertLineBreak' && !e.shiftKey) {
    e.preventDefault();
    if (messageInput.value.trim()) {
      $('message-form').requestSubmit();
    }
  }
});

function sendTypingSignal() {
  if (!state.activeConversationId) return;
  const now = Date.now();
  if (now - state.lastTypingSentAt < 2000) return;
  state.lastTypingSentAt = now;
  supabaseClient.from('typing_indicators').upsert({
    conversation_id: state.activeConversationId,
    user_id: state.me.id,
    updated_at: new Date().toISOString()
  }).then(() => {});
}

$('message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = messageInput.value.trim();
  if (!content || !state.activeConversationId) return;
  const btn = $('send-btn');
  setBtnLoading(btn, true);
  try {
    const { error } = await supabaseClient.from('messages').insert({
      conversation_id: state.activeConversationId,
      sender_id: state.me.id,
      content,
      message_type: 'text',
      reply_to_id: state.replyTarget ? state.replyTarget.id : null
    });
    if (error) throw error;
    messageInput.value = '';
    autoResize(messageInput);
    hideReplyPreview();
  } catch (err) {
    toast(friendlyError(err, 'Message failed to send'), 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});

// ---------------------------------------------------------------------------
// FILE ATTACHMENTS
// ---------------------------------------------------------------------------
$('attach-btn').addEventListener('click', () => $('image-input').click());
$('image-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (!files.length || !state.activeConversationId) return;

  toast(`Uploading ${files.length} file(s)…`);

  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      toast(`${file.name} is too large (max 20MB)`, 'error');
      continue;
    }

    try {
      const ext = file.name.split('.').pop() || 'bin';
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${state.me.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${cleanFileName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('chat-media')
        .upload(storagePath, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data: pub } = supabaseClient.storage
        .from('chat-media')
        .getPublicUrl(storagePath);

      let msgType = 'file';
      if (file.type.startsWith('image/')) msgType = 'image';
      else if (file.type.startsWith('video/')) msgType = 'video';
      else if (file.type.startsWith('audio/')) msgType = 'audio';

      const { error: msgError } = await supabaseClient.from('messages').insert({
        conversation_id: state.activeConversationId,
        sender_id: state.me.id,
        message_type: msgType,
        media_url: pub.publicUrl,
        content: file.name,
        reply_to_id: state.replyTarget ? state.replyTarget.id : null
      });

      if (msgError) throw msgError;
    } catch (err) {
      toast(friendlyError(err, `Failed to upload ${file.name}`), 'error');
    }
  }

  hideReplyPreview();
});

// ---------------------------------------------------------------------------
// VOICE NOTE RECORDER (CROSS-BROWSER COMPATIBLE)
// ---------------------------------------------------------------------------
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;
let recordedMimeType = '';

const voiceBtn = $('voice-record-btn');
const recordingOverlay = $('recording-overlay');
const recordingTimer = $('recording-timer');
const cancelRecordBtn = $('cancel-record-btn');
const stopSendRecordBtn = $('stop-send-record-btn');

function getSupportedAudioMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg'
  ];
  for (const t of types) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

voiceBtn.addEventListener('click', async () => {
  if (!state.activeConversationId) {
    toast('Select a chat first', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedMimeType = getSupportedAudioMimeType();
    const options = recordedMimeType ? { mimeType: recordedMimeType } : {};

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    recordingSeconds = 0;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.start(250);

    recordingOverlay.hidden = false;
    $('message-input').hidden = true;
    recordingTimer.textContent = '0:00';

    clearInterval(recordingInterval);
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = recordingSeconds % 60;
      recordingTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
  } catch (err) {
    console.error('Microphone error:', err);
    toast('Microphone access denied or unavailable.', 'error');
  }
});

cancelRecordBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    if (mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  }
  clearInterval(recordingInterval);
  recordingOverlay.hidden = true;
  $('message-input').hidden = false;
  audioChunks = [];
});

stopSendRecordBtn.addEventListener('click', async () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  clearInterval(recordingInterval);
  const duration = recordingSeconds;

  const audioBlob = await new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      if (mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
      }
      const mime = recordedMimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mime });
      resolve(blob);
    };
    mediaRecorder.stop();
  });

  recordingOverlay.hidden = true;
  $('message-input').hidden = false;

  if (!audioBlob || audioBlob.size === 0) {
    toast('No audio recorded.', 'error');
    return;
  }

  toast('Sending voice note…');

  const mime = audioBlob.type || 'audio/webm';
  const ext = mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'webm';
  const storagePath = `${state.me.id}/voice-${Date.now()}.${ext}`;

  try {
    const { error: uploadError } = await supabaseClient.storage
      .from('chat-media')
      .upload(storagePath, audioBlob, { contentType: mime, upsert: false });

    if (uploadError) throw uploadError;

    const { data: pub } = supabaseClient.storage
      .from('chat-media')
      .getPublicUrl(storagePath);

    const { error: msgError } = await supabaseClient.from('messages').insert({
      conversation_id: state.activeConversationId,
      sender_id: state.me.id,
      message_type: 'audio',
      media_url: pub.publicUrl,
      content: `Voice note (${duration}s)`
    });

    if (msgError) throw msgError;
  } catch (err) {
    console.error('Voice note send error:', err);
    toast(friendlyError(err, 'Failed to send voice note'), 'error');
  }
});

// ---------------------------------------------------------------------------
// GIPHY API (INTEGRATED)
// ---------------------------------------------------------------------------
const gifModal = $('gif-picker-modal');
const gifBtn = $('gif-toggle-btn');
const gifSearch = $('gif-search-input');
const gifGrid = $('gif-results-grid');

gifBtn.addEventListener('click', () => {
  gifModal.hidden = !gifModal.hidden;
  if (!gifModal.hidden) {
    fetchGifs('');
    gifSearch.focus();
  }
});

$('close-gif-btn').addEventListener('click', () => {
  gifModal.hidden = true;
});

gifSearch.addEventListener('input', debounce((e) => {
  fetchGifs(e.target.value.trim());
}, 400));

async function fetchGifs(query) {
  gifGrid.innerHTML = '<div style="grid-column: span 2; text-align:center; color:var(--text-muted); padding:20px 0;">Loading GIFs…</div>';
  try {
    const endpoint = query
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=16&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=16&rating=g`;

    const res = await fetch(endpoint);
    const result = await res.json();

    if (!res.ok) throw new Error(result.message || 'Failed to fetch from GIPHY');

    const data = result.data || [];
    gifGrid.innerHTML = '';

    if (data.length === 0) {
      gifGrid.innerHTML = '<div style="grid-column: span 2; text-align:center; color:var(--text-muted); padding:20px 0;">No GIFs found</div>';
      return;
    }

    data.forEach(item => {
      const imgUrl = item.images?.fixed_height_small?.url || item.images?.fixed_height?.url;
      const fullUrl = item.images?.original?.url || imgUrl;
      if (!imgUrl) return;

      const img = document.createElement('img');
      img.src = imgUrl;
      img.loading = 'lazy';
      img.addEventListener('click', () => sendGif(fullUrl));
      gifGrid.appendChild(img);
    });
  } catch (err) {
    console.error('GIPHY Error:', err);
    gifGrid.innerHTML = `<div style="grid-column: span 2; text-align:center; color:var(--text-muted); padding:20px 0;">${err.message || 'Failed to load GIFs'}</div>`;
  }
}

async function sendGif(gifUrl) {
  if (!state.activeConversationId) return;
  gifModal.hidden = true;

  try {
    await supabaseClient.from('messages').insert({
      conversation_id: state.activeConversationId,
      sender_id: state.me.id,
      message_type: 'image',
      media_url: gifUrl,
      content: 'GIF'
    });
  } catch (err) {
    toast(friendlyError(err, 'Failed to send GIF'), 'error');
  }
}

// ---------------------------------------------------------------------------
// IN-APP CAMERA: PHOTO, VIDEO & SWITCHING
// ---------------------------------------------------------------------------
let cameraStream = null;
let videoRecorder = null;
let recordedVideoChunks = [];
let cameraTimerInterval = null;
let cameraSeconds = 0;
let currentCameraMode = 'photo';
let currentFacingMode = 'user';

const cameraModal = $('camera-modal');
const cameraVideo = $('camera-video');
const cameraCanvas = $('camera-canvas');
const cameraBtn = $('camera-btn');
const closeCameraBtn = $('close-camera-btn');
const flipCameraBtn = $('flip-camera-btn');
const modePhotoBtn = $('mode-photo-btn');
const modeVideoBtn = $('mode-video-btn');
const shutterPhotoBtn = $('shutter-photo-btn');
const shutterVideoBtn = $('shutter-video-btn');
const cameraTimer = $('camera-timer');

cameraBtn.addEventListener('click', async () => {
  if (!state.activeConversationId) {
    toast('Select a chat first', 'error');
    return;
  }
  await startCamera();
});

async function startCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    cameraVideo.srcObject = cameraStream;
    cameraModal.hidden = false;
    setCameraMode(currentCameraMode);
  } catch (err) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      cameraVideo.srcObject = cameraStream;
      cameraModal.hidden = false;
    } catch (fallbackErr) {
      toast('Could not access camera or microphone', 'error');
    }
  }
}

if (flipCameraBtn) {
  flipCameraBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startCamera();
  });
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (videoRecorder && videoRecorder.state !== 'inactive') {
    videoRecorder.stop();
  }
  clearInterval(cameraTimerInterval);
  cameraModal.hidden = true;
  shutterVideoBtn.classList.remove('recording');
  cameraTimer.hidden = true;
}

closeCameraBtn.addEventListener('click', stopCamera);

modePhotoBtn.addEventListener('click', () => setCameraMode('photo'));
modeVideoBtn.addEventListener('click', () => setCameraMode('video'));

function setCameraMode(mode) {
  currentCameraMode = mode;
  modePhotoBtn.classList.toggle('active', mode === 'photo');
  modeVideoBtn.classList.toggle('active', mode === 'video');
  shutterPhotoBtn.hidden = mode !== 'photo';
  shutterVideoBtn.hidden = mode !== 'video';
  cameraTimer.hidden = true;
}

shutterPhotoBtn.addEventListener('click', () => {
  if (!cameraStream) return;

  cameraCanvas.width = cameraVideo.videoWidth || 640;
  cameraCanvas.height = cameraVideo.videoHeight || 480;
  const ctx = cameraCanvas.getContext('2d');

  if (currentFacingMode === 'user') {
    ctx.translate(cameraCanvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

  cameraCanvas.toBlob(async (blob) => {
    stopCamera();
    if (!blob) return;

    toast('Sending photo…');
    const path = `${state.me.id}/photo-${Date.now()}.jpg`;

    try {
      const { error: uploadError } = await supabaseClient.storage
        .from('chat-media')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;

      const { data: pub } = supabaseClient.storage
        .from('chat-media')
        .getPublicUrl(path);

      await supabaseClient.from('messages').insert({
        conversation_id: state.activeConversationId,
        sender_id: state.me.id,
        message_type: 'image',
        media_url: pub.publicUrl,
        content: ''
      });
    } catch (err) {
      toast(friendlyError(err, 'Failed to send photo'), 'error');
    }
  }, 'image/jpeg', 0.88);
});

shutterVideoBtn.addEventListener('click', () => {
  if (!cameraStream) return;

  if (videoRecorder && videoRecorder.state === 'recording') {
    videoRecorder.stop();
    return;
  }

  recordedVideoChunks = [];
  videoRecorder = new MediaRecorder(cameraStream, { mimeType: 'video/webm' });

  videoRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedVideoChunks.push(e.data);
  };

  videoRecorder.onstop = async () => {
    clearInterval(cameraTimerInterval);
    shutterVideoBtn.classList.remove('recording');
    cameraTimer.hidden = true;

    const videoBlob = new Blob(recordedVideoChunks, { type: 'video/webm' });
    stopCamera();

    if (videoBlob.size === 0) return;

    toast('Sending video clip…');
    const path = `${state.me.id}/video-${Date.now()}.webm`;

    try {
      const { error: uploadError } = await supabaseClient.storage
        .from('chat-media')
        .upload(path, videoBlob, { contentType: 'video/webm', upsert: false });

      if (uploadError) throw uploadError;

      const { data: pub } = supabaseClient.storage
        .from('chat-media')
        .getPublicUrl(path);

      await supabaseClient.from('messages').insert({
        conversation_id: state.activeConversationId,
        sender_id: state.me.id,
        message_type: 'video',
        media_url: pub.publicUrl,
        content: `Video clip (${cameraSeconds}s)`
      });
    } catch (err) {
      toast(friendlyError(err, 'Failed to send video'), 'error');
    }
  };

  videoRecorder.start();
  shutterVideoBtn.classList.add('recording');
  cameraSeconds = 0;
  cameraTimer.textContent = '0:00';
  cameraTimer.hidden = false;

  cameraTimerInterval = setInterval(() => {
    cameraSeconds++;
    const m = Math.floor(cameraSeconds / 60);
    const s = cameraSeconds % 60;
    cameraTimer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }, 1000);
});

// ---------------------------------------------------------------------------
// WEBRTC CALLING (DIRECT P2P WITH QUEUED ICE & GLOBAL SIGNALING)
// ---------------------------------------------------------------------------
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

let peerConnection = null;
let localCallStream = null;
let remoteCallStream = null;
let callType = 'audio';
let activeCallPartnerId = null;
let iceCandidatesQueue = [];

const callModal = $('call-modal');
const callAvatar = $('call-avatar');
const callUserName = $('call-user-name');
const callStatus = $('call-status');
const callVideoContainer = $('call-video-container');
const localVideo = $('local-video');
const remoteVideo = $('remote-video');
const remoteAudio = $('remote-audio');
const acceptCallBtn = $('accept-call-btn');
const toggleMicBtn = $('toggle-mic-btn');
const endCallBtn = $('end-call-btn');

$('start-audio-call-btn').addEventListener('click', () => initiateCall('audio'));
$('start-video-call-btn').addEventListener('click', () => initiateCall('video'));

async function initiateCall(type) {
  if (!state.activeConversationId || !state.activeOtherUser) {
    toast('Select a chat to call', 'error');
    return;
  }

  callType = type;
  activeCallPartnerId = state.activeOtherUser.id;
  iceCandidatesQueue = [];

  setupCallUI(state.activeOtherUser, `Calling (${type})…`);
  acceptCallBtn.hidden = true;
  toggleMicBtn.hidden = false;

  try {
    await setupLocalStream(type);
    createPeerConnection();

    localCallStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localCallStream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // 1. Direct WebRTC signal via recipient's dedicated channel
    sendDirectCallSignal(activeCallPartnerId, 'call_offer', {
      offer,
      callType,
      conversationId: state.activeConversationId,
      caller: state.me
    });

    // 2. Insert message to trigger recipient push notification
    await supabaseClient.from('messages').insert({
      conversation_id: state.activeConversationId,
      sender_id: state.me.id,
      message_type: 'call',
      content: `📞 Incoming ${type} call…`
    });

  } catch (err) {
    console.error('Call initialization error:', err);
    toast('Camera or Microphone access was denied.', 'error');
    closeCall();
  }
}

function sendDirectCallSignal(targetUserId, subEvent, payload) {
  if (!targetUserId) return;
  supabaseClient.channel(`user:${targetUserId}`).send({
    type: 'broadcast',
    event: 'webrtc_signal',
    payload: { subEvent, from: state.me.id, ...payload }
  });
}

async function setupLocalStream(type) {
  if (localCallStream) {
    localCallStream.getTracks().forEach(t => t.stop());
  }

  localCallStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
  });

  if (type === 'video') {
    callVideoContainer.hidden = false;
    localVideo.srcObject = localCallStream;
    localVideo.muted = true;
    localVideo.play().catch(() => {});
  } else {
    callVideoContainer.hidden = true;
  }
}

function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);
  remoteCallStream = new MediaStream();

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteCallStream.addTrack(track);
    });

    if (callType === 'video') {
      remoteVideo.srcObject = remoteCallStream;
      remoteVideo.play().catch(console.error);
    } else {
      remoteAudio.srcObject = remoteCallStream;
      remoteAudio.play().catch(console.error);
    }
    callStatus.textContent = 'Connected';
  };

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      sendDirectCallSignal(activeCallPartnerId, 'ice_candidate', {
        candidate: e.candidate
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      toast('Call disconnected', 'default');
      closeCall();
    }
  };
}

function setupCallUI(user, statusText) {
  callAvatar.src = avatarUrl(user);
  callUserName.textContent = user.display_name || 'User';
  callStatus.textContent = statusText;
  callModal.hidden = false;
}

async function handleIncomingWebRTCSignal(data) {
  if (!data || data.from === state.me.id) return;

  if (data.subEvent === 'call_offer') {
    callType = data.callType;
    activeCallPartnerId = data.from;
    iceCandidatesQueue = [];

    setupCallUI(data.caller, `Incoming ${data.callType} call…`);
    acceptCallBtn.hidden = false;
    toggleMicBtn.hidden = true;

    acceptCallBtn.onclick = async () => {
      acceptCallBtn.hidden = true;
      toggleMicBtn.hidden = false;
      callStatus.textContent = 'Connecting…';

      try {
        await setupLocalStream(callType);
        createPeerConnection();

        localCallStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localCallStream);
        });

        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

        while (iceCandidatesQueue.length > 0) {
          const cand = iceCandidatesQueue.shift();
          await peerConnection.addIceCandidate(cand);
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendDirectCallSignal(data.from, 'call_answer', { answer });
      } catch (err) {
        console.error('Call answering failed:', err);
        toast('Could not answer call', 'error');
        closeCall();
      }
    };

  } else if (data.subEvent === 'call_answer' && peerConnection) {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      while (iceCandidatesQueue.length > 0) {
        const cand = iceCandidatesQueue.shift();
        await peerConnection.addIceCandidate(cand);
      }
    } catch (err) {
      console.error('Set remote answer error:', err);
    }

  } else if (data.subEvent === 'ice_candidate') {
    const candidate = new RTCIceCandidate(data.candidate);
    if (peerConnection && peerConnection.remoteDescription) {
      peerConnection.addIceCandidate(candidate).catch(console.error);
    } else {
      iceCandidatesQueue.push(candidate);
    }

  } else if (data.subEvent === 'call_end') {
    toast('Call ended', 'default');
    closeCall();
  }
}

function closeCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localCallStream) {
    localCallStream.getTracks().forEach(t => t.stop());
    localCallStream = null;
  }
  if (remoteCallStream) {
    remoteCallStream.getTracks().forEach(t => t.stop());
    remoteCallStream = null;
  }
  callModal.hidden = true;
  callVideoContainer.hidden = true;
  acceptCallBtn.hidden = true;
  toggleMicBtn.hidden = true;
  activeCallPartnerId = null;
  iceCandidatesQueue = [];
}

endCallBtn.addEventListener('click', () => {
  sendDirectCallSignal(activeCallPartnerId, 'call_end', {});
  closeCall();
});

toggleMicBtn.addEventListener('click', () => {
  if (!localCallStream) return;
  const audioTrack = localCallStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    toggleMicBtn.textContent = audioTrack.enabled ? '🎤 Mute' : '🔇 Unmute';
  }
});

// ---------------------------------------------------------------------------
// EMOJI PICKER
// ---------------------------------------------------------------------------
const COMPOSER_EMOJIS = ['😀','😂','😍','😊','😉','😢','😮','😡','👍','👎','🙏','🔥','🎉','❤️','💯','👏','🤔','😴','😎','🥳','😅','🤝','👀','✨','🥰','🥺','😘','🫂','🤗'];
function buildEmojiPicker() {
  const el = $('emoji-picker');
  el.innerHTML = '';
  COMPOSER_EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e;
    b.addEventListener('click', () => {
      messageInput.value += e;
      messageInput.focus();
      autoResize(messageInput);
    });
    el.appendChild(b);
  });
}
$('emoji-btn').addEventListener('click', () => { $('emoji-picker').hidden = !$('emoji-picker').hidden; });
document.addEventListener('click', (e) => {
  if (!e.target.closest('#emoji-picker') && e.target.id !== 'emoji-btn') $('emoji-picker').hidden = true;
});

// ---------------------------------------------------------------------------
// MESSAGE SEARCH
// ---------------------------------------------------------------------------
$('toggle-msg-search-btn').addEventListener('click', () => {
  const bar = $('msg-search-bar');
  bar.hidden = !bar.hidden;
  if (!bar.hidden) $('msg-search-input').focus();
});
$('msg-search-close').addEventListener('click', () => {
  $('msg-search-bar').hidden = true;
  $('msg-search-input').value = '';
  state.msgSearchQuery = '';
  renderMessages();
});
$('msg-search-input').addEventListener('input', debounce((e) => {
  state.msgSearchQuery = e.target.value.trim().toLowerCase();
  renderMessages();
  const firstMatch = qs('.msg-highlight');
  if (firstMatch) firstMatch.scrollIntoView({ block: 'center', behavior: 'smooth' });
}, 200));

// ---------------------------------------------------------------------------
// CHAT MENU: PIN / MUTE / DELETE
// ---------------------------------------------------------------------------
$('chat-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('chat-menu').hidden = !$('chat-menu').hidden;
});
document.addEventListener('click', () => { $('chat-menu').hidden = true; });

$('chat-menu').addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !state.activeConversationId) return;
  const conv = state.conversations.find(c => c.id === state.activeConversationId);
  if (!conv) return;

  if (action === 'pin') {
    await togglePin(conv);
  } else if (action === 'mute') {
    await toggleMute(conv);
  } else if (action === 'delete') {
    await deleteConversation(conv);
  }
});

async function togglePin(conv) {
  try {
    const { error } = await supabaseClient.from('conversation_members')
      .update({ is_pinned: !conv.isPinned })
      .eq('conversation_id', conv.id).eq('user_id', state.me.id);
    if (error) throw error;
    conv.isPinned = !conv.isPinned;
    updateChatMenuLabels(conv);
    renderConversationList();
    toast(conv.isPinned ? 'Conversation pinned' : 'Conversation unpinned', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Could not update pin'), 'error');
  }
}

async function toggleMute(conv) {
  try {
    const { error } = await supabaseClient.from('conversation_members')
      .update({ is_muted: !conv.isMuted })
      .eq('conversation_id', conv.id).eq('user_id', state.me.id);
    if (error) throw error;
    conv.isMuted = !conv.isMuted;
    updateChatMenuLabels(conv);
    renderConversationList();
    toast(conv.isMuted ? 'Conversation muted' : 'Conversation unmuted', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Could not update mute'), 'error');
  }
}

async function deleteConversation(conv) {
  if (!confirm('Delete this conversation for you? The other person will still see it.')) return;
  try {
    const { error } = await supabaseClient.from('conversation_members')
      .delete().eq('conversation_id', conv.id).eq('user_id', state.me.id);
    if (error) throw error;
    state.conversations = state.conversations.filter(c => c.id !== conv.id);
    if (state.activeConversationId === conv.id) {
      state.activeConversationId = null;
      cleanupActiveConversationChannels();
      $('chat-active').hidden = true;
      $('chat-empty-state').hidden = false;
      $('app-shell').classList.remove('mobile-chat-open');
    }
    renderConversationList();
    toast('Conversation deleted', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Could not delete conversation'), 'error');
  }
}

// ---------------------------------------------------------------------------
// PUSH NOTIFICATIONS SUBSCRIPTION
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function subscribeToPush() {
  if (!state.me) {
    toast('Please sign in first.', 'error');
    return;
  }

  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    toast('Push notifications are not supported on this device.', 'error');
    return;
  }

  if (typeof VAPID_PUBLIC_KEY === 'undefined' || !VAPID_PUBLIC_KEY) {
    toast('VAPID public key is missing.', 'error');
    return;
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      toast('Notification permission was not granted.', 'error');
      return;
    }

    await navigator.serviceWorker.register('/service-worker.js');
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const subscriptionJSON = subscription.toJSON();
    const endpoint = subscriptionJSON.endpoint;
    const p256dh = subscriptionJSON.keys?.p256dh;
    const auth = subscriptionJSON.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      throw new Error('Invalid push subscription.');
    }

    const { data: existing, error: findError } =
      await supabaseClient
        .from('push_subscriptions')
        .select('id')
        .eq('endpoint', endpoint)
        .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const { error } = await supabaseClient
        .from('push_subscriptions')
        .update({ user_id: state.me.id, p256dh, auth })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from('push_subscriptions')
        .insert({ user_id: state.me.id, endpoint, p256dh, auth });
      if (error) throw error;
    }

    const btn = $('enable-notifications-btn');
    btn.textContent = '✅ Enabled';
    btn.disabled = true;

    toast('Push notifications enabled 🔔', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Could not enable notifications'), 'error');
  }
}

// ---------------------------------------------------------------------------
// PROFILE / SETTINGS & WALLPAPER HANDLERS
// ---------------------------------------------------------------------------
$('open-profile-btn').addEventListener('click', () => {
  $('profile-display-name').value = state.me.display_name;
  $('profile-username').value = state.me.username;
  $('profile-bio').value = state.me.bio || '';
  $('profile-avatar-preview').src = avatarUrl(state.me);
  $('profile-error').textContent = '';
  $('profile-modal').hidden = false;
});
$('close-profile-btn').addEventListener('click', () => { $('profile-modal').hidden = true; });
$('profile-modal').addEventListener('click', (e) => { if (e.target === $('profile-modal')) $('profile-modal').hidden = true; });
$('enable-notifications-btn').addEventListener('click', subscribeToPush);

$('theme-segmented').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme]');
  if (btn) applyTheme(btn.dataset.theme);
});

$('upload-wallpaper-btn').addEventListener('click', () => $('wallpaper-input').click());
$('wallpaper-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    toast('Please select an image file', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast('Wallpaper must be smaller than 5MB', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const dataUrl = event.target.result;
    localStorage.setItem('chat_wallpaper', dataUrl);
    applyWallpaper(dataUrl);
    toast('Chat wallpaper updated', 'success');
  };
  reader.readAsDataURL(file);
});

$('reset-wallpaper-btn').addEventListener('click', () => {
  localStorage.removeItem('chat_wallpaper');
  applyWallpaper(null);
  toast('Wallpaper removed', 'default');
});

$('upload-avatar-btn').addEventListener('click', () => $('avatar-input').click());
$('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please select an image file', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be smaller than 5MB', 'error'); return; }
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${state.me.id}/avatar-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from('chat-media').upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    const { data: pub } = supabaseClient.storage.from('chat-media').getPublicUrl(path);
    $('profile-avatar-preview').src = pub.publicUrl;
    $('profile-avatar-preview').dataset.pendingUrl = pub.publicUrl;
    toast('Photo uploaded — click Save to apply', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Photo upload failed'), 'error');
  }
});

$('save-profile-btn').addEventListener('click', async () => {
  const btn = $('save-profile-btn');
  $('profile-error').textContent = '';
  const displayName = $('profile-display-name').value.trim();
  const username = $('profile-username').value.trim().toLowerCase();
  const bio = $('profile-bio').value.trim();
  const pendingAvatar = $('profile-avatar-preview').dataset.pendingUrl;

  if (!displayName) { $('profile-error').textContent = 'Display name can\'t be empty.'; return; }
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) { $('profile-error').textContent = 'Username must be 3–20 characters: letters, numbers, "_" or "."'; return; }

  setBtnLoading(btn, true);
  try {
    const updates = { display_name: displayName, username, bio };
    if (pendingAvatar) updates.avatar_url = pendingAvatar;

    const { data, error } = await supabaseClient.from('profiles').update(updates).eq('id', state.me.id).select().single();
    if (error) throw error;
    state.me = data;
    renderMyAvatar();
    delete $('profile-avatar-preview').dataset.pendingUrl;
    $('profile-modal').hidden = true;
    renderConversationList();
    toast('Profile updated', 'success');
  } catch (err) {
    $('profile-error').textContent = friendlyError(err, 'Could not save profile');
  } finally {
    setBtnLoading(btn, false);
  }
});

$('theme-toggle-btn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// ---------------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------------
(function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.warn('SW auto-registration failed:', err);
    });
  }
  initAppearance();
  buildAccentSwatches();
  buildEmojiPicker();
  initAuth();
})();
