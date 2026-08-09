/* =====================================================================
   NEXATEL FINAL CUSTOMER FRONTEND LOGIC
   ---------------------------------------------------------------------
   This file deliberately separates VIEW STATE from CONVERSATION DATA.

   Key behaviour:
   - HOME view remains available at all times.
   - Opening a chat does not delete/hide the rest of the product forever.
   - A compact service strip remains available while chatting.
   - Service/prompt buttons PREPARE text; they never auto-send.
   - The composer is always visible and never overlays the last message.
   - Recent 5 conversations are stored per signed-in user.
   - Human support appears only after meaningful escalation signals.
   ===================================================================== */

const API_BASE_URL = "http://127.0.0.1:8000";
const API = {
  signup: `${API_BASE_URL}/auth/signup`,
  login: `${API_BASE_URL}/auth/login`,
  chat: `${API_BASE_URL}/chat`,
  support: `${API_BASE_URL}/support/request`
};

const MAX_HISTORY = 5;
const STORAGE = {
  user: "nexatel_user",
  activeConversation: "nexatel_active_conversation",
  conversationPrefix: "nexatel_conversations"
};

const state = {
  user: null,
  conversations: [],
  currentConversationId: null,
  selectedService: null,
  currentView: "home", // "home" or "chat"
  sending: false,
  supportEligible: false
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------
   Telecom service catalogue.
   Suggestions only populate the composer; they do NOT send messages.
   --------------------------------------------------------------------- */
const SERVICES = {
  recharge: {
    label: "Recharge & payments",
    description: "Recharge missing, failed payment, duplicate charge or refund help.",
    placeholder: "Describe your recharge or payment issue...",
    suggestions: [
      "My recharge failed but the amount was deducted.",
      "I recharged but the recharge is not reflecting.",
      "I was charged twice for the same recharge.",
      "I want to check my recharge refund status."
    ]
  },
  network: {
    label: "Network & data",
    description: "Signal, mobile data, call quality and 4G/5G troubleshooting.",
    placeholder: "Describe your network or mobile data issue...",
    suggestions: [
      "My mobile data is not working.",
      "I have no network signal.",
      "Calls are dropping frequently.",
      "5G is not working on my phone."
    ]
  },
  account: {
    label: "Plan & validity",
    description: "Plan benefits, validity and account-related guidance.",
    placeholder: "Ask about your plan, validity or account...",
    suggestions: [
      "I want to check my current plan.",
      "I need help with plan validity extension.",
      "What benefits are included in my plan?",
      "I want to change my plan."
    ]
  },
  billing: {
    label: "Billing & refunds",
    description: "Charges, billing, refunds and payment disputes.",
    placeholder: "Describe your billing or refund issue...",
    suggestions: [
      "I was charged twice.",
      "I do not recognise a charge.",
      "My refund has not arrived.",
      "The amount charged is incorrect."
    ]
  },
  sim: {
    label: "SIM & eSIM",
    description: "SIM activation, replacement, blocking and eSIM help.",
    placeholder: "Describe your SIM or eSIM issue...",
    suggestions: [
      "My SIM is not working.",
      "I lost my SIM and need a replacement.",
      "My replacement SIM is not active.",
      "I need help activating eSIM."
    ]
  },
  roaming: {
    label: "Roaming & ISD",
    description: "International roaming, overseas data and ISD support.",
    placeholder: "Describe your roaming or international calling issue...",
    suggestions: [
      "International roaming is not working.",
      "I want to activate international roaming.",
      "Mobile data is not working while roaming.",
      "I want to understand roaming charges."
    ]
  },
  number: {
    label: "Number services",
    description: "Porting, ownership and number-related services.",
    placeholder: "Describe the number service you need help with...",
    suggestions: [
      "I want to port my number.",
      "My number porting request is delayed.",
      "I need help with call forwarding.",
      "I want to activate DND."
    ]
  },
  other: {
    label: "Other support",
    description: "Any other NexaTel service issue.",
    placeholder: "Describe what you need help with...",
    suggestions: [
      "I need help with another service issue.",
      "The NexaTel app is not working properly.",
      "I tried troubleshooting but the issue remains.",
      "I need general customer support."
    ]
  }
};

/* =====================================================================
   INITIALIZE
   ===================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  bindAuthEvents();
  bindAppEvents();
  bindPasswordToggles();
  restoreSession();
  updateCharacterCounter();
});

/* =====================================================================
   AUTHENTICATION
   ===================================================================== */
function bindAuthEvents() {
  $("showSignupButton")?.addEventListener("click", showSignup);
  $("showLoginButton")?.addEventListener("click", showLogin);
  $("loginForm")?.addEventListener("submit", handleLogin);
  $("signupForm")?.addEventListener("submit", handleSignup);
}

function bindPasswordToggles() {
  document.querySelectorAll(".password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(button.dataset.passwordTarget);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
  });
}

function showSignup() {
  $("loginForm")?.classList.add("hidden");
  $("signupForm")?.classList.remove("hidden");
  $("authTitle").textContent = "Create your account";
  $("authDescription").textContent = "Create your NexaTel account to save conversations and access support.";
}

function showLogin() {
  $("signupForm")?.classList.add("hidden");
  $("loginForm")?.classList.remove("hidden");
  $("authTitle").textContent = "Sign in to continue";
  $("authDescription").textContent = "Access your support conversations and account help.";
}

async function handleSignup(event) {
  event.preventDefault();
  const name = $("signupName")?.value.trim();
  const email = $("signupEmail")?.value.trim().toLowerCase();
  const phone = $("signupPhone")?.value.trim() || "";
  const password = $("signupPassword")?.value || "";

  if (!name || !email || password.length < 6) {
    showToast("Complete the required fields. Password must be at least 6 characters.", "error");
    return;
  }

  setLoading($("signupButton"), true, "Creating account...");
  try {
    const response = await fetch(API.signup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, password })
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(extractApiError(data, "Unable to create account."));

    state.user = normalizeUser(data.user || data, { name, email, phone });
    localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
    loadConversations();
    showApplication();
    showToast("Account created successfully.", "success");
  } catch (error) {
    console.error("Signup error:", error);
    showToast(customerSafeError(error.message), "error");
  } finally {
    setLoading($("signupButton"), false, "Create account");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $("loginEmail")?.value.trim().toLowerCase();
  const password = $("loginPassword")?.value || "";

  if (!email || !password) {
    showToast("Enter your email and password.", "error");
    return;
  }

  setLoading($("loginButton"), true, "Signing in...");
  try {
    const response = await fetch(API.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(extractApiError(data, "The email or password is incorrect."));

    state.user = normalizeUser(data.user || data, { email });
    localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
    loadConversations();
    showApplication();
    showToast(`Welcome back, ${state.user.name}.`, "success");
  } catch (error) {
    console.error("Login error:", error);
    showToast(customerSafeError(error.message), "error");
  } finally {
    setLoading($("loginButton"), false, "Sign in");
  }
}

function normalizeUser(raw = {}, fallback = {}) {
  const email = raw.email || fallback.email || "";
  return {
    id: raw.id || raw.user_id || email,
    name: raw.name || raw.full_name || fallback.name || email.split("@")[0] || "Customer",
    email,
    phone: raw.phone || raw.mobile || fallback.phone || ""
  };
}

function restoreSession() {
  const raw = localStorage.getItem(STORAGE.user);
  if (!raw) {
    showAuthentication();
    return;
  }

  try {
    state.user = normalizeUser(JSON.parse(raw));
    loadConversations();
    showApplication();
  } catch {
    localStorage.removeItem(STORAGE.user);
    showAuthentication();
  }
}

function logout() {
  localStorage.removeItem(STORAGE.user);
  localStorage.removeItem(STORAGE.activeConversation);
  state.user = null;
  state.conversations = [];
  state.currentConversationId = null;
  state.selectedService = null;
  state.supportEligible = false;
  showAuthentication();
  showLogin();
  showToast("You have been signed out.", "info");
}

function showAuthentication() {
  $("appShell")?.classList.add("hidden");
  $("authScreen")?.classList.remove("hidden");
}

function showApplication() {
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
  renderUser();
  restoreOrCreateConversation();
  showHomeView();
}

function renderUser() {
  if (!state.user) return;
  $("sidebarUserName").textContent = state.user.name;
  $("sidebarUserEmail").textContent = state.user.email;
  $("userAvatar").textContent = getInitials(state.user.name);
  $("welcomeCustomerName").textContent = state.user.name.split(/\s+/)[0] || "Customer";
  if (state.user.phone) $("accountMobileNumber").textContent = state.user.phone;
}

/* =====================================================================
   VIEW CONTROLLER
   ===================================================================== */
function showHomeView() {
  state.currentView = "home";
  $("homeView")?.classList.remove("hidden");
  $("chatView")?.classList.add("hidden");
  $("conversationTitle").textContent = "AI Support";
  $("conversationSubtitle").textContent = "Usually replies instantly";
  closeSidebar();
}

function showChatView() {
  state.currentView = "chat";
  $("homeView")?.classList.add("hidden");
  $("chatView")?.classList.remove("hidden");
  const conversation = getCurrentConversation();
  $("conversationTitle").textContent = conversation?.title || "AI Support";
  $("conversationSubtitle").textContent = "Conversation context is preserved";
  renderMessages();
  closeSidebar();
}

/* =====================================================================
   APPLICATION EVENTS
   ===================================================================== */
function bindAppEvents() {
  $("logoutButton")?.addEventListener("click", logout);
  $("newChatButton")?.addEventListener("click", () => startNewConversation(true));
  $("supportHomeButton")?.addEventListener("click", showHomeView);
  $("backHomeButton")?.addEventListener("click", showHomeView);
  $("chatForm")?.addEventListener("submit", handleChatSubmit);
  $("supportReviewButton")?.addEventListener("click", openSupportModal);
  $("homeSupportButton")?.addEventListener("click", openSupportModal);
  $("closeSupportModalButton")?.addEventListener("click", closeSupportModal);
  $("closeSuccessModalButton")?.addEventListener("click", () => $("supportSuccessModal")?.classList.add("hidden"));
  $("supportRequestForm")?.addEventListener("submit", handleSupportRequest);
  $("clearContextButton")?.addEventListener("click", clearServiceContext);
  $("closeGuidedPanel")?.addEventListener("click", () => $("guidedPanel")?.classList.add("hidden"));
  $("openSidebarButton")?.addEventListener("click", () => $("sidebar")?.classList.add("open"));
  $("closeSidebarButton")?.addEventListener("click", closeSidebar);
  $("notificationButton")?.addEventListener("click", () => showToast("No new support updates right now.", "info"));
  $("viewAccountButton")?.addEventListener("click", () => showToast("Account data is demo data until a telecom customer API is connected.", "info"));
  $("rechargeNowButton")?.addEventListener("click", () => {
    selectService("recharge");
    preparePrompt("I want help with a recharge.");
  });

  $("messageInput")?.addEventListener("input", () => {
    autoResizeTextarea();
    updateCharacterCounter();
  });

  $("messageInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("chatForm")?.requestSubmit();
    }
  });

  document.querySelectorAll("[data-service]").forEach((button) => {
    button.addEventListener("click", () => selectService(button.dataset.service));
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => preparePrompt(button.dataset.prompt));
  });

  $("supportModal")?.addEventListener("click", (event) => {
    if (event.target === $("supportModal")) closeSupportModal();
  });
}

/* =====================================================================
   SERVICES + GUIDED SUPPORT
   ===================================================================== */
function selectService(key) {
  const service = SERVICES[key];
  if (!service) return;

  state.selectedService = key;
  $("composerContextText").textContent = service.label;
  $("composerContext")?.classList.remove("hidden");
  $("messageInput").placeholder = service.placeholder;

  // Only show the large guided panel on Home. In chat, the compact strip is enough.
  if (state.currentView === "home") {
    $("guidedTitle").textContent = service.label;
    $("guidedDescription").textContent = service.description;
    const holder = $("guidedSuggestions");
    holder.innerHTML = "";

    service.suggestions.forEach((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "guided-chip";
      button.textContent = suggestion;
      button.addEventListener("click", () => preparePrompt(suggestion));
      holder.appendChild(button);
    });

    $("guidedPanel")?.classList.remove("hidden");
    $("guidedPanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("messageInput")?.focus();
  closeSidebar();
}

function preparePrompt(text) {
  const input = $("messageInput");
  if (!input) return;
  input.value = text || "";
  autoResizeTextarea();
  updateCharacterCounter();
  input.focus();
  // Deliberately no submit here.
}

function clearServiceContext() {
  state.selectedService = null;
  $("composerContext")?.classList.add("hidden");
  $("guidedPanel")?.classList.add("hidden");
  $("messageInput").placeholder = "Describe what you need help with...";
}

/* =====================================================================
   CONVERSATION STORAGE
   ===================================================================== */
function conversationStorageKey() {
  return `${STORAGE.conversationPrefix}_${state.user?.email || "guest"}`;
}

function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(conversationStorageKey()) || "[]");
    state.conversations = Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    state.conversations = [];
  }
}

function saveConversations() {
  state.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  state.conversations = state.conversations.slice(0, MAX_HISTORY);
  localStorage.setItem(conversationStorageKey(), JSON.stringify(state.conversations));
  if (state.currentConversationId) localStorage.setItem(STORAGE.activeConversation, state.currentConversationId);
  renderConversationHistory();
}

function createConversation() {
  const now = new Date().toISOString();
  return {
    id: generateId("chat"),
    sessionId: generateId("session"),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    service: null,
    messages: []
  };
}

function restoreOrCreateConversation() {
  if (!state.conversations.length) {
    startNewConversation(false);
    return;
  }

  const saved = localStorage.getItem(STORAGE.activeConversation);
  const exists = state.conversations.some((c) => c.id === saved);
  state.currentConversationId = exists ? saved : state.conversations[0].id;
  renderConversationHistory();
  evaluateEscalation();
}

function startNewConversation(showNotice = true) {
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.currentConversationId = conversation.id;
  state.selectedService = null;
  state.supportEligible = false;
  saveConversations();
  clearServiceContext();
  updateSupportUI();
  showHomeView();
  if (showNotice) showToast("New conversation started.", "info");
}

function getCurrentConversation() {
  return state.conversations.find((c) => c.id === state.currentConversationId);
}

function openConversation(id) {
  if (!state.conversations.some((c) => c.id === id)) return;
  state.currentConversationId = id;
  localStorage.setItem(STORAGE.activeConversation, id);
  clearServiceContext();
  evaluateEscalation();
  showChatView();
}

function renderConversationHistory() {
  const container = $("conversationHistory");
  if (!container) return;

  container.innerHTML = "";
  $("historyCount").textContent = `${state.conversations.length}/${MAX_HISTORY}`;
  $("emptyHistory")?.classList.toggle("hidden", state.conversations.length > 0);

  state.conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    if (conversation.id === state.currentConversationId) button.classList.add("active");

    button.innerHTML = `<span>◇</span><span class="history-item-copy"><strong class="history-title">${escapeHtml(conversation.title)}</strong><small class="history-date">${formatHistoryDate(conversation.updatedAt)}</small></span>`;
    button.addEventListener("click", () => openConversation(conversation.id));
    container.appendChild(button);
  });
}

/* =====================================================================
   CHAT
   ===================================================================== */
async function handleChatSubmit(event) {
  event.preventDefault();
  if (state.sending) return;

  const input = $("messageInput");
  const text = input?.value.trim();
  if (!text) return;

  let conversation = getCurrentConversation();
  if (!conversation) {
    startNewConversation(false);
    conversation = getCurrentConversation();
  }

  const userMessage = {
    id: generateId("msg"),
    role: "user",
    content: text,
    timestamp: new Date().toISOString(),
    service: state.selectedService
  };

  conversation.messages.push(userMessage);
  conversation.updatedAt = new Date().toISOString();
  if (conversation.title === "New conversation") conversation.title = createTitle(text);
  if (state.selectedService) conversation.service = state.selectedService;
  saveConversations();

  input.value = "";
  autoResizeTextarea();
  updateCharacterCounter();
  clearServiceContext();
  showChatView();

  state.sending = true;
  $("sendButton").disabled = true;
  $("typingIndicator")?.classList.remove("hidden");
  scrollChatBottom();

  try {
    const response = await fetch(API.chat, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        session_id: conversation.sessionId,
        user_id: state.user?.id || null,
        user_email: state.user?.email || null,
        topic: conversation.service || null
      })
    });

    const data = await readJson(response);
    if (!response.ok) throw new Error(extractApiError(data, "Unable to process your message."));

    const reply = data.reply || data.response || data.answer || data.message;
    if (!reply || typeof reply !== "string") throw new Error("The support service returned an incomplete response.");
    if (data.session_id) conversation.sessionId = data.session_id;

    conversation.messages.push({
      id: generateId("msg"),
      role: "assistant",
      content: reply.trim(),
      timestamp: new Date().toISOString(),
      feedback: null,
      escalationRecommended: Boolean(data.escalation_recommended || data.needs_human_review || data.requires_support)
    });
    conversation.updatedAt = new Date().toISOString();
    saveConversations();
    renderMessages();
    evaluateEscalation();
  } catch (error) {
    console.error("Chat error:", error);
    conversation.messages.push({
      id: generateId("msg"),
      role: "assistant",
      content: customerSafeError(error.message),
      timestamp: new Date().toISOString(),
      feedback: null,
      escalationRecommended: true
    });
    conversation.updatedAt = new Date().toISOString();
    state.supportEligible = true;
    saveConversations();
    renderMessages();
    updateSupportUI();
  } finally {
    state.sending = false;
    $("sendButton").disabled = false;
    $("typingIndicator")?.classList.add("hidden");
    scrollChatBottom();
    input.focus();
  }
}

function renderMessages() {
  const conversation = getCurrentConversation();
  const list = $("messagesList");
  if (!conversation || !list) return;
  list.innerHTML = "";
  conversation.messages.forEach((message) => list.appendChild(createMessageElement(message)));
  scrollChatBottom();
}

function createMessageElement(message) {
  const row = document.createElement("div");
  row.className = `message-row ${message.role}`;

  const wrapper = document.createElement("div");
  wrapper.className = "message-wrap";

  const avatar = document.createElement("div");
  avatar.className = message.role === "assistant" ? "assistant-avatar" : "message-user-avatar";
  avatar.textContent = message.role === "assistant" ? "✦" : getInitials(state.user?.name);

  const content = document.createElement("div");
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = message.content;

  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = formatMessageTime(message.timestamp);

  content.append(bubble, time);
  if (message.role === "assistant") content.appendChild(createFeedback(message));
  wrapper.append(avatar, content);
  row.appendChild(wrapper);
  return row;
}

function createFeedback(message) {
  const box = document.createElement("div");
  box.className = "message-feedback";
  const up = document.createElement("button");
  const down = document.createElement("button");
  up.type = down.type = "button";
  up.className = down.className = "feedback-button";
  up.textContent = "👍";
  down.textContent = "👎";
  if (message.feedback === "positive") up.classList.add("selected");
  if (message.feedback === "negative") down.classList.add("selected");

  up.addEventListener("click", () => {
    message.feedback = "positive";
    saveConversations();
    renderMessages();
    evaluateEscalation();
  });

  down.addEventListener("click", () => {
    message.feedback = "negative";
    state.supportEligible = true;
    saveConversations();
    renderMessages();
    updateSupportUI();
    showToast("Support review is now available if the issue remains unresolved.", "info");
  });

  box.append(up, down);
  return box;
}

/* =====================================================================
   ESCALATION + SUPPORT REQUEST
   ===================================================================== */
function evaluateEscalation() {
  const conversation = getCurrentConversation();
  if (!conversation) {
    state.supportEligible = false;
    updateSupportUI();
    return;
  }

  const userMessages = conversation.messages.filter((m) => m.role === "user");
  const combined = userMessages.map((m) => m.content.toLowerCase()).join(" ");
  const highSignal = [
    "money deducted", "amount deducted", "payment deducted", "charged twice",
    "double charged", "refund", "recharge not reflecting", "not credited",
    "transaction", "lost sim", "replacement sim", "still not working", "not resolved"
  ].some((term) => combined.includes(term));

  const negative = conversation.messages.some((m) => m.feedback === "negative");
  const backendRecommended = conversation.messages.some((m) => m.escalationRecommended === true);

  // Two exchanges for high-risk account/transaction cases, otherwise 3 user turns.
  state.supportEligible = negative || backendRecommended || (highSignal && userMessages.length >= 2) || userMessages.length >= 3;
  updateSupportUI();
}

function updateSupportUI() {
  $("supportReviewButton")?.classList.toggle("hidden", !state.supportEligible);
  if ($("homeSupportButton")) $("homeSupportButton").disabled = !state.supportEligible;
}

function openSupportModal() {
  if (!state.supportEligible) {
    showToast("Continue troubleshooting first. Support review becomes available when it is genuinely needed.", "info");
    return;
  }

  const conversation = getCurrentConversation();
  if (conversation && !$("supportReason")?.value.trim()) {
    const lastUser = [...conversation.messages].reverse().find((m) => m.role === "user");
    if (lastUser) $("supportReason").value = lastUser.content;
  }
  $("supportModal")?.classList.remove("hidden");
}

function closeSupportModal() {
  $("supportModal")?.classList.add("hidden");
}

async function handleSupportRequest(event) {
  event.preventDefault();
  const conversation = getCurrentConversation();
  if (!conversation) return;

  const reason = $("supportReason")?.value.trim();
  const preference = document.querySelector('input[name="contactPreference"]:checked')?.value || "callback";
  if (!reason) {
    showToast("Please describe what remains unresolved.", "error");
    return;
  }

  setLoading($("submitSupportButton"), true, "Submitting...");
  try {
    const response = await fetch(API.support, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: conversation.sessionId,
        conversation_id: conversation.id,
        user_id: state.user?.id || null,
        customer_name: state.user?.name || null,
        customer_email: state.user?.email || null,
        customer_phone: state.user?.phone || null,
        reason,
        contact_preference: preference,
        conversation: conversation.messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
      })
    });

    const data = await readJson(response);
    if (!response.ok) throw new Error(extractApiError(data, "Unable to submit the support request."));

    closeSupportModal();
    $("supportSuccessMessage").textContent = preference === "callback"
      ? "Your callback request is in the support queue. An agent will review the conversation before contacting you."
      : "Your case is in the support queue. Updates can be sent to your registered email.";

    const reference = data.ticket_id || data.request_id || data.reference_id;
    if (reference) {
      $("supportTicketReference").textContent = `Reference: ${reference}`;
      $("supportTicketReference").classList.remove("hidden");
    } else {
      $("supportTicketReference")?.classList.add("hidden");
    }

    $("supportSuccessModal")?.classList.remove("hidden");
    $("supportRequestForm")?.reset();
    state.supportEligible = false;
    updateSupportUI();
  } catch (error) {
    console.error("Support request error:", error);
    showToast(customerSafeError(error.message), "error");
  } finally {
    setLoading($("submitSupportButton"), false, "Submit request");
  }
}

/* =====================================================================
   HELPERS
   ===================================================================== */
async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { detail: text }; }
}

function extractApiError(data, fallback) {
  const raw = data?.detail || data?.message || data?.error;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((x) => x.msg || "Invalid request").join(" ");
  return fallback;
}

function customerSafeError(message) {
  const raw = String(message || "");
  const lower = raw.toLowerCase();
  const hiddenInfrastructure = ["twilio", "sendgrid", "openai", "nvidia", "gemini", "api key", "traceback", "quota", "smtp", "uvicorn", "connection refused"];
  if (hiddenInfrastructure.some((term) => lower.includes(term))) return "We're having trouble completing that request right now. Please try again.";
  if (raw === "Failed to fetch") return "The NexaTel support service is temporarily unreachable. Please try again shortly.";
  return raw && raw.length <= 220 ? raw : "Something went wrong while processing your request. Please try again.";
}

function setLoading(button, loading, label) {
  if (!button) return;
  if (loading && !button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
  button.disabled = loading;
  button.textContent = loading ? label : (button.dataset.originalText || label);
  if (!loading) delete button.dataset.originalText;
}

function showToast(message, type = "info") {
  const holder = $("toastContainer");
  if (!holder) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  holder.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function updateCharacterCounter() {
  if ($("messageInput") && $("characterCounter")) $("characterCounter").textContent = `${$("messageInput").value.length} / 2000`;
}

function autoResizeTextarea() {
  const input = $("messageInput");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}

function scrollChatBottom() {
  requestAnimationFrame(() => {
    const container = $("messagesContainer");
    if (container) container.scrollTop = container.scrollHeight;
  });
}

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
}

function getInitials(name) {
  if (!name) return "U";
  return name.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase();
}

function createTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 36 ? clean : `${clean.slice(0,36)}…`;
}

function formatMessageTime(timestamp) {
  try { return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

function formatHistoryDate(timestamp) {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

function generateId(prefix) {
  return window.crypto?.randomUUID ? `${prefix}_${crypto.randomUUID()}` : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}
