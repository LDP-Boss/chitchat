// ============================================================================
// CHITCHAT — APPLICATION LOGIC
// ============================================================================

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
const state = {
  session: null,
  me: null,                    // my profile row
  conversations: [],           // enriched conversation list
  activeConversationId: null,
  activeOtherUser: null,
  messages: [],                // messages of the active conversation
  messageChannel: null,        // realtime channel for active conversation's messages/reactions
  typingChannel: null,
  presenceChannel: null,       // global presence channel
  conversationsChannel: null,  // realtime for conversation_members / new messages across all convos
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

// ---------------------------------------------------------------------------
// DOM SHORTCUTS
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// TOASTS
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
// THEME & ACCENT (stored locally)
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

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------
function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
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

// ============================================================================
// AUTH
// ============================================================================

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
    // onAuthStateChange picks up the rest
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

// ============================================================================
// APP BOOT / TEARDOWN
// ============================================================================

let appBooted = false;

async function bootApp() {
  if (appBooted) return;
  appBooted = true;

  try {
    const userId = state.session.user.id;
    let { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
    if (error || !profile) {
      // trigger may still be running just after signup — brief retry
      await new Promise(r => setTimeout(r, 700));
      ({ data: profile, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single());
    }
    if (error || !profile) throw error || new Error('Profile not found');

    state.me = profile;
    $('auth-screen').hidden = true;
    $('app-shell').hidden = false;
    renderMyAvatar();
    await setPresence(true);
    subscribeGlobalPresence();
    subscribeConversationsRealtime();
    await loadConversations();

    window.addEventListener('beforeunload', () => { navigator.sendBeacon && setPresence(false); });
  } catch (err) {
    appBooted = false;
    toast(friendlyError(err, 'Could not load your account'), 'error');
    await supabaseClient.auth.signOut();
  }
}

function teardownApp() {
  appBooted = false;
  state.me = null;
  state.conversations = [];
  state.activeConversationId = null;
  cleanupActiveConversationChannels();
  if (state.presenceChannel) supabaseClient.removeChannel(state.presenceChannel);
  if (state.conversationsChannel) supabaseClient.removeChannel(state.conversationsChannel);
  state.presenceChannel = null;
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

// ============================================================================
// PRESENCE (online / offline)
// ============================================================================

async function setPresence(online) {
  if (!state.me) return;
  try {
    await supabaseClient.from('profiles').update({
      is_online: online,
      last_seen: new Date().toISOString()
    }).eq('id', state.me.id);
  } catch (_) { /* best-effort */ }
}

function subscribeGlobalPresence() {
  // Track this browser tab's presence in a Supabase Presence channel so
  // other users see online status live, without polling the DB.
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

  // Also listen for DB-level is_online / last_seen changes (covers users
  // who close the tab without a clean disconnect, once they reconnect).
  const dbChannel = supabase
    .channel('presence:profiles-db')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
      if (state.activeOtherUser && payload.new.id === state.activeOtherUser.id) {
        state.activeOtherUser = { ...state.activeOtherUser, ...payload.new };
        renderChatHeaderStatus();
      }
      const conv = state.conversations.find(c => c.otherUser && c.otherUser.id === payload.new.id);
      if (conv) { conv.otherUser = { ...conv.otherUser, ...payload.new }; renderConversationList(); }
    })
    .subscribe();

  state.presenceChannel = channel;
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

// ============================================================================
// CONVERSATIONS
// ============================================================================

async function loadConversations() {
  $('conversations-loading').hidden = false;
  $('conversations-empty').hidden = true;
  try {
    const { data: memberships, error } = await supabase
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

    // other members
    const { data: allMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id, profiles(id, username, display_name, avatar_url, is_online, last_seen)')
      .in('conversation_id', convIds);

    // last message per conversation
    const { data: lastMessages } = await supabase
      .from('messages')
      .select('id, conversation_id, content, message_type, sender_id, created_at, is_deleted')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    const lastMsgByConv = {};
    for (const m of lastMessages || []) {
      if (!lastMsgByConv[m.conversation_id]) lastMsgByConv[m.conversation_id] = m;
    }

    // unread counts (messages after my last_read_at, not sent by me)
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
    }).filter(c => c.otherUser); // hide malformed/self-only convos

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
  const { data } = await supabase
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
  // New messages anywhere -> update sidebar (preview/unread/order), even for
  // conversations not currently open.
  const channel = supabase
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
    // new conversation we didn't know about yet (e.g. someone just started one with us)
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
// USER SEARCH -> open/create conversation
// ---------------------------------------------------------------------------
$('user-search-input').addEventListener('input', debounce(async (e) => {
  const q = e.target.value.trim();
  const results = $('user-search-results');
  if (!q) { results.hidden = true; results.innerHTML = ''; return; }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
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

// ============================================================================
// ACTIVE CONVERSATION / MESSAGES
// ============================================================================

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

async function loadMessages(conversationId) {
  $('messages-loading').hidden = false;
  $('messages-empty').hidden = true;
  $('messages-list').innerHTML = '';
  try {
    const { data, error } = await supabase
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
  visible.forEach((msg, idx) => {
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

  // hover actions (left side for mine, so they sit between avatar-side and bubble)
  const hoverActions = document.createElement('div');
  hoverActions.className = 'msg-hover-actions';
  if (!msg.is_deleted) {
    hoverActions.innerHTML = `
      <button data-act="react" title="React">🙂</button>
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
      inner += `<img class="msg-image" src="${msg.media_url}" alt="Shared image" />`;
      if (msg.content) inner += `<div style="padding:6px 4px 2px;">${escapeHtml(msg.content)}</div>`;
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
  qsa('.reaction-picker').forEach(p => p.remove());
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  REACTIONS.forEach(emoji => {
    const b = document.createElement('button');
    b.textContent = emoji;
    b.addEventListener('click', () => {
      const already = msg.message_reactions?.some(r => r.user_id === state.me.id && r.reaction === emoji);
      toggleReaction(msg.id, emoji, already);
      picker.remove();
    });
    picker.appendChild(b);
  });
  e.currentTarget.parentElement.appendChild(picker);
  setTimeout(() => document.addEventListener('click', function closer(ev) {
    if (!picker.contains(ev.target) && ev.target !== e.currentTarget) { picker.remove(); document.removeEventListener('click', closer); }
  }), 0);
}

async function toggleReaction(messageId, emoji, removing) {
  try {
    if (removing) {
      await supabaseClient.from('message_reactions').delete()
        .eq('message_id', messageId).eq('user_id', state.me.id).eq('reaction', emoji);
    } else {
      await supabaseClient.from('message_reactions').insert({ message_id: messageId, user_id: state.me.id, reaction: emoji });
    }
  } catch (err) {
    toast(friendlyError(err, 'Could not react to message'), 'error');
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
  const original = bubble.innerHTML;
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
// REALTIME: messages, reactions, typing (per active conversation)
// ---------------------------------------------------------------------------
function subscribeToConversation(conversationId) {
  const channel = supabase
    .channel(`conv:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      if (state.messages.some(m => m.id === payload.new.id)) return; // avoid dupes
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

  const typingChannel = supabase
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
  } catch (_) { /* best effort */ }
}

// ============================================================================
// SENDING MESSAGES
// ============================================================================

const messageInput = $('message-input');
messageInput.addEventListener('input', () => {
  autoResize(messageInput);
  sendTypingSignal();
});
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('message-form').requestSubmit();
  }
});

function sendTypingSignal() {
  if (!state.activeConversationId) return;
  const now = Date.now();
  if (now - state.lastTypingSentAt < 2000) return; // throttle DB writes
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
// IMAGE UPLOAD
// ---------------------------------------------------------------------------
$('attach-btn').addEventListener('click', () => $('image-input').click());
$('image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !state.activeConversationId) return;

  if (!file.type.startsWith('image/')) { toast('Please select an image file', 'error'); return; }
  if (file.size > 8 * 1024 * 1024) { toast('Image must be smaller than 8MB', 'error'); return; }

  const uploadToast = toast('Uploading image…');
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${state.me.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from('chat-media').upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { data: pub } = supabaseClient.storage.from('chat-media').getPublicUrl(path);

    const { error } = await supabaseClient.from('messages').insert({
      conversation_id: state.activeConversationId,
      sender_id: state.me.id,
      message_type: 'image',
      media_url: pub.publicUrl,
      content: null,
      reply_to_id: state.replyTarget ? state.replyTarget.id : null
    });
    if (error) throw error;
    hideReplyPreview();
    toast('Image sent', 'success');
  } catch (err) {
    toast(friendlyError(err, 'Image upload failed'), 'error');
  }
});

// ---------------------------------------------------------------------------
// EMOJI PICKER (for composer)
// ---------------------------------------------------------------------------
const COMPOSER_EMOJIS = ['😀','😂','😍','😊','😉','😢','😮','😡','👍','👎','🙏','🔥','🎉','❤️','💯','👏','🤔','😴','😎','🥳','😅','🤝','👀','✨'];
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

// ============================================================================
// MESSAGE SEARCH (within conversation)
// ============================================================================
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

// ============================================================================
// CHAT MENU: pin / mute / delete conversation
// ============================================================================
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

// ============================================================================
// PROFILE / SETTINGS MODAL
// ============================================================================
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

$('theme-segmented').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme]');
  if (btn) applyTheme(btn.dataset.theme);
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

// ============================================================================
// INIT
// ============================================================================
(function init() {
  initAppearance();
  buildAccentSwatches();
  buildEmojiPicker();
  initAuth();
})();
