/* =================================================================
   NEXATEL PREMIUM CUSTOMER FRONTEND
   ================================================================= */

   const API_BASE_URL = "http://127.0.0.1:8000";

   const API = {
     signup: `${API_BASE_URL}/auth/signup`,
     login: `${API_BASE_URL}/auth/login`,
     chat: `${API_BASE_URL}/chat`,
     voiceChat: `${API_BASE_URL}/voice/chat`,
     support: `${API_BASE_URL}/support/request`
   };
   
   
   /* =================================================================
      APP CONFIGURATION
      ================================================================= */
   
   const MAX_HISTORY = 5;
   
   
   /*
     Browser storage keys.
   
     Conversation history is stored separately for each signed-in user.
   */
   const STORAGE = {
     user: "nexatel_user",
     activeConversation: "nexatel_active_conversation",
     conversationPrefix: "nexatel_conversations"
   };
   
   
   /* =================================================================
      GLOBAL APPLICATION STATE
      ================================================================= */
   
   const state = {
   
     /* Signed-in customer. */
     user: null,
   
     /* Customer's latest conversations. */
     conversations: [],
   
     /* Currently-open conversation. */
     currentConversationId: null,
   
     /*
       Currently selected telecom support category.
   
       Examples:
       recharge
       network
       billing
       sim
     */
     selectedTopic: null,
   
     /*
       Prevents duplicate chat requests while one request
       is already in progress.
     */
     isSending: false,
   
     /*
       Determines whether human support review should
       currently be shown to the customer.
     */
     supportEligible: false,
   
     /* ===============================================================
        VOICE CHANNEL STATE
        =============================================================== */
   
     /*
       "chat" = normal typed message.
       "voice" = microphone-generated message.
     */
     activeChannel: "chat",
   
     /*
       If true, the next assistant reply should also be
       spoken using browser text-to-speech.
     */
     speakNextReply: false,
   
     /*
       Stores our SpeechRecognition instance.
   
       This is useful both internally and while debugging:
           console.log(state.speechRecognition)
     */
     speechRecognition: null,
   
     /*
       Prevents recognition.start() from being fired twice
       while the microphone is already active.
     */
     isListening: false
   
   };
   
   
   /* =================================================================
      SHORT DOM HELPER
      ================================================================= */
   
   const $ =
     (id) =>
       document.getElementById(id);
   
   
   /* =================================================================
      TELECOM SERVICE CATALOGUE
      =================================================================
   
      Used by:
      - Main service cards
      - Sidebar service shortcuts
      - Guided support suggestions
   
      IMPORTANT:
      Clicking a service card NEVER automatically sends a message.
      ================================================================= */
   
   const SERVICE_CATALOGUE = {
   
     recharge: {
   
       label:
         "Recharge & payments",
   
       description:
         "Recharge missing, payment failure, duplicate charge or transaction help.",
   
       placeholder:
         "Example: I recharged ₹500 but the recharge is not reflecting.",
   
       suggestions: [
         "I recharged but the recharge is not reflecting.",
         "My payment was deducted but the recharge failed.",
         "I was charged twice for the same recharge.",
         "I need help checking a recharge refund."
       ]
   
     },
   
   
     network: {
   
       label:
         "Network & data",
   
       description:
         "Signal, internet, call quality and 4G/5G troubleshooting.",
   
       placeholder:
         "Example: My mobile data is not working even though I have an active plan.",
   
       suggestions: [
         "My mobile data is not working.",
         "I have very weak signal in my area.",
         "Calls are dropping repeatedly.",
         "My phone is not connecting to 5G."
       ]
   
     },
   
   
     account: {
   
       label:
         "Plan & validity",
   
       description:
         "Plan benefits, validity, account guidance and service questions.",
   
       placeholder:
         "Example: I want to understand my plan benefits and validity.",
   
       suggestions: [
         "Help me understand my current plan.",
         "I want to know how plan validity works.",
         "I need help changing my plan.",
         "I have a question about my account."
       ]
   
     },
   
   
     billing: {
   
       label:
         "Billing & refunds",
   
       description:
         "Charges, duplicate billing, refunds and payment disputes.",
   
       placeholder:
         "Example: I was charged twice and need help checking the payment.",
   
       suggestions: [
         "I was charged twice.",
         "I need help with a refund.",
         "I do not recognise a charge.",
         "My payment failed but money was deducted."
       ]
   
     },
   
   
     sim: {
   
       label:
         "SIM & eSIM",
   
       description:
         "Lost SIM, activation, replacement SIM and eSIM guidance.",
   
       placeholder:
         "Example: I lost my SIM and need help with replacement.",
   
       suggestions: [
         "I lost my SIM.",
         "I need a replacement SIM.",
         "My new SIM is not activated.",
         "I need help setting up eSIM."
       ]
   
     },
   
   
     roaming: {
   
       label:
         "Roaming & ISD",
   
       description:
         "International roaming, overseas data and international calling help.",
   
       placeholder:
         "Example: I need help enabling international roaming.",
   
       suggestions: [
         "How do I enable international roaming?",
         "My data is not working while roaming.",
         "I need help with international calling.",
         "I want to understand roaming charges."
       ]
   
     },
   
   
     number: {
   
       label:
         "Number services",
   
       description:
         "Porting, ownership and mobile-number related assistance.",
   
       placeholder:
         "Example: I need help with number porting.",
   
       suggestions: [
         "I need help porting my number.",
         "I have a question about number ownership.",
         "My number transfer is delayed.",
         "I need help with a number-related service."
       ]
   
     },
   
   
     other: {
   
       label:
         "Other support",
   
       description:
         "Any other telecom service issue.",
   
       placeholder:
         "Describe the issue you're facing and I'll help you troubleshoot it.",
   
       suggestions: [
         "I need help with another service issue.",
         "Something on my account is not working.",
         "I want to report a service problem.",
         "I need general support."
       ]
   
     }
   
   };
   
   
   /* =================================================================
      START APPLICATION
      =================================================================
   
      IMPORTANT FIX:
   
      The previous app.js contained wireVoiceSupport(), but that
      function was not automatically called during page startup.
   
      Therefore the microphone only started working after manually
      calling wireVoiceSupport() in DevTools.
   
      We now initialize it automatically.
      ================================================================= */
   
   document.addEventListener(
     "DOMContentLoaded",
     () => {
   
       wireAuthentication();
   
       wireApplication();
   
       wirePasswordToggles();
   
   
       /*
         Initialize microphone support only after HTML has loaded.
   
         This ensures #voiceButton exists before we attach
         its event listener.
       */
       wireVoiceSupport();
   
   
       /*
         Restore an existing signed-in session last.
       */
       restoreSession();
   
     }
   );
   
   
   /* =================================================================
      AUTHENTICATION EVENTS
      ================================================================= */
   
   function wireAuthentication() {
   
     $("showSignupButton")
       ?.addEventListener(
         "click",
         showSignupForm
       );
   
   
     $("showLoginButton")
       ?.addEventListener(
         "click",
         showLoginForm
       );
   
   
     $("loginForm")
       ?.addEventListener(
         "submit",
         handleLogin
       );
   
   
     $("signupForm")
       ?.addEventListener(
         "submit",
         handleSignup
       );
   
   }
   
   
   /* =================================================================
      SHOW SIGNUP FORM
      ================================================================= */
   
   function showSignupForm() {
   
     $("loginForm")
       ?.classList
       .add(
         "hidden"
       );
   
   
     $("signupForm")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     if ($("authTitle")) {
   
       $("authTitle")
         .textContent =
           "Create your account";
   
     }
   
   
     if ($("authDescription")) {
   
       $("authDescription")
         .textContent =
           "Create your NexaTel account to access personalised support and conversation history.";
   
     }
   
   
     setTimeout(
       () =>
         $("signupName")
           ?.focus(),
       50
     );
   
   }
   
   
   /* =================================================================
      SHOW LOGIN FORM
      ================================================================= */
   
   function showLoginForm() {
   
     $("signupForm")
       ?.classList
       .add(
         "hidden"
       );
   
   
     $("loginForm")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     if ($("authTitle")) {
   
       $("authTitle")
         .textContent =
           "Sign in to continue";
   
     }
   
   
     if ($("authDescription")) {
   
       $("authDescription")
         .textContent =
           "Access your support conversations and account help.";
   
     }
   
   }
   
   
   /* =================================================================
      PASSWORD SHOW / HIDE
      ================================================================= */
   
   function wirePasswordToggles() {
   
     document
       .querySelectorAll(
         ".password-toggle"
       )
       .forEach(
         (button) => {
   
           button.addEventListener(
             "click",
             () => {
   
               const field =
                 $(
                   button.dataset.passwordTarget
                 );
   
   
               if (!field) {
                 return;
               }
   
   
               field.type =
                 field.type === "password"
                   ? "text"
                   : "password";
   
             }
           );
   
         }
       );
   
   }
   
   
   /* =================================================================
      SIGNUP
      ================================================================= */
   
   async function handleSignup(event) {
   
     event.preventDefault();
   
   
     const name =
       $("signupName")
         ?.value
         .trim();
   
   
     const email =
       $("signupEmail")
         ?.value
         .trim()
         .toLowerCase();
   
   
     const phone =
       $("signupPhone")
         ?.value
         .trim()
       || "";
   
   
     const password =
       $("signupPassword")
         ?.value
       || "";
   
   
     /* Basic frontend validation. */
     if (
       !name
       ||
       !email
       ||
       password.length < 6
     ) {
   
       showToast(
         "Please complete the required fields. Password must be at least 6 characters.",
         "error"
       );
   
       return;
   
     }
   
   
     setButtonLoading(
       $("signupButton"),
       true,
       "Creating account..."
     );
   
   
     try {
   
       const response =
         await fetch(
           API.signup,
           {
   
             method:
               "POST",
   
             headers: {
   
               "Content-Type":
                 "application/json"
   
             },
   
             body:
               JSON.stringify({
                 name,
                 email,
                 phone,
                 password
               })
   
           }
         );
   
   
       const data =
         await readJson(
           response
         );
   
   
       if (!response.ok) {
   
         throw new Error(
   
           extractSafeApiError(
             data,
             "Unable to create your account."
           )
   
         );
   
       }
   
   
       state.user =
         normalizeUser(
           data.user || data,
           {
             name,
             email,
             phone
           }
         );
   
   
       localStorage.setItem(
         STORAGE.user,
         JSON.stringify(
           state.user
         )
       );
   
   
       loadUserConversations();
   
   
       $("signupForm")
         ?.reset();
   
   
       showApplication();
   
   
       showToast(
         "Account created successfully.",
         "success"
       );
   
     } catch (error) {
   
       /*
         Technical error remains in DevTools.
   
         The customer sees only a safe message.
       */
       console.error(
         "Signup failed:",
         error
       );
   
   
       showToast(
         customerSafeError(
           error.message
         ),
         "error"
       );
   
     } finally {
   
       setButtonLoading(
         $("signupButton"),
         false,
         "Create account"
       );
   
     }
   
   }
   
   
   /* =================================================================
      LOGIN
      ================================================================= */
   
   async function handleLogin(event) {
   
     event.preventDefault();
   
   
     const email =
       $("loginEmail")
         ?.value
         .trim()
         .toLowerCase();
   
   
     const password =
       $("loginPassword")
         ?.value
       || "";
   
   
     if (
       !email
       ||
       !password
     ) {
   
       showToast(
         "Enter your email and password.",
         "error"
       );
   
       return;
   
     }
   
   
     setButtonLoading(
       $("loginButton"),
       true,
       "Signing in..."
     );
   
   
     try {
   
       const response =
         await fetch(
           API.login,
           {
   
             method:
               "POST",
   
             headers: {
   
               "Content-Type":
                 "application/json"
   
             },
   
             body:
               JSON.stringify({
                 email,
                 password
               })
   
           }
         );
   
   
       const data =
         await readJson(
           response
         );
   
   
       if (!response.ok) {
   
         throw new Error(
   
           extractSafeApiError(
             data,
             "The email or password is incorrect."
           )
   
         );
   
       }
   
   
       state.user =
         normalizeUser(
           data.user || data,
           {
             email
           }
         );
   
   
       localStorage.setItem(
         STORAGE.user,
         JSON.stringify(
           state.user
         )
       );
   
   
       loadUserConversations();
   
   
       $("loginForm")
         ?.reset();
   
   
       showApplication();
   
   
       showToast(
         `Welcome back, ${state.user.name}.`,
         "success"
       );
   
     } catch (error) {
   
       console.error(
         "Login failed:",
         error
       );
   
   
       showToast(
         customerSafeError(
           error.message
         ),
         "error"
       );
   
     } finally {
   
       setButtonLoading(
         $("loginButton"),
         false,
         "Sign in"
       );
   
     }
   
   }
   
   
   /* =================================================================
      NORMALIZE BACKEND USER
      =================================================================
   
      Keeps the frontend compatible with API responses that use
      either "id" or "user_id", and "name" or "full_name".
      ================================================================= */
   
   function normalizeUser(
     apiUser,
     fallback = {}
   ) {
   
     return {
   
       id:
         apiUser.id
         ||
         apiUser.user_id
         ||
         fallback.id
         ||
         null,
   
   
       name:
         apiUser.name
         ||
         apiUser.full_name
         ||
         fallback.name
         ||
         fallback.email
           ?.split("@")[0]
         ||
         "Customer",
   
   
       email:
         apiUser.email
         ||
         fallback.email
         ||
         "",
   
   
       phone:
         apiUser.phone
         ||
         fallback.phone
         ||
         ""
   
     };
   
   }
   
   
   /* =================================================================
      RESTORE SESSION
      ================================================================= */
   
   function restoreSession() {
   
     try {
   
       const saved =
         localStorage.getItem(
           STORAGE.user
         );
   
   
       if (!saved) {
   
         showAuthentication();
   
         return;
   
       }
   
   
       state.user =
         JSON.parse(
           saved
         );
   
   
       loadUserConversations();
   
   
       showApplication();
   
     } catch (error) {
   
       console.error(
         "Unable to restore saved session:",
         error
       );
   
   
       localStorage.removeItem(
         STORAGE.user
       );
   
   
       state.user =
         null;
   
   
       showAuthentication();
   
     }
   
   }
   
   
   /* =================================================================
      LOGOUT
      ================================================================= */
   
   function logout() {
   
     /*
       Cancel any AI voice playback.
     */
     if (
       typeof window.speechSynthesis !==
       "undefined"
     ) {
   
       window.speechSynthesis.cancel();
   
     }
   
   
     /*
       Stop active microphone capture.
     */
     if (
       state.speechRecognition
       &&
       state.isListening
     ) {
   
       try {
   
         state.speechRecognition.abort();
   
       } catch (error) {
   
         console.debug(
           "Voice recognition was already stopped:",
           error
         );
   
       }
   
     }
   
   
     localStorage.removeItem(
       STORAGE.user
     );
   
   
     localStorage.removeItem(
       STORAGE.activeConversation
     );
   
   
     /*
       IMPORTANT:
       We intentionally DO NOT delete the customer's stored
       conversation history when they sign out.
     */
     state.user =
       null;
   
   
     state.conversations =
       [];
   
   
     state.currentConversationId =
       null;
   
   
     state.selectedTopic =
       null;
   
   
     state.supportEligible =
       false;
   
   
     state.activeChannel =
       "chat";
   
   
     state.speakNextReply =
       false;
   
   
     state.isListening =
       false;
   
   
     showAuthentication();
   
   
     showLoginForm();
   
   
     showToast(
       "You have been signed out.",
       "info"
     );
   
   }
   
   
   /* =================================================================
      SHOW AUTH SCREEN
      ================================================================= */
   
   function showAuthentication() {
   
     $("appShell")
       ?.classList
       .add(
         "hidden"
       );
   
   
     $("authScreen")
       ?.classList
       .remove(
         "hidden"
       );
   
   }
   
   
   /* =================================================================
      SHOW APPLICATION
      ================================================================= */
   
   function showApplication() {
   
     $("authScreen")
       ?.classList
       .add(
         "hidden"
       );
   
   
     $("appShell")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     renderUser();
   
   
     if (
       state.conversations.length > 0
     ) {
   
       const savedActive =
         localStorage.getItem(
           STORAGE.activeConversation
         );
   
   
       const validSaved =
         state.conversations.some(
           (conversation) =>
             conversation.id ===
             savedActive
         );
   
   
       state.currentConversationId =
         validSaved
   
           ? savedActive
   
           : state.conversations[0].id;
   
   
       renderConversationHistory();
   
   
       renderCurrentConversation();
   
   
       evaluateEscalation();
   
     } else {
   
       startNewConversation(
         false
       );
   
     }
   
   }
   
   
   /* =================================================================
      RENDER USER
      ================================================================= */
   
   function renderUser() {
   
     if (!state.user) {
       return;
     }
   
   
     if ($("sidebarUserName")) {
   
       $("sidebarUserName")
         .textContent =
           state.user.name
           ||
           "Customer";
   
     }
   
   
     if ($("sidebarUserEmail")) {
   
       $("sidebarUserEmail")
         .textContent =
           state.user.email
           ||
           "";
   
     }
   
   
     if ($("userAvatar")) {
   
       $("userAvatar")
         .textContent =
           (
             state.user.name
             ||
             "C"
           )
             .charAt(0)
             .toUpperCase();
   
     }
   
   }
   
   
   /* =================================================================
      APPLICATION EVENT LISTENERS
      ================================================================= */
   
   function wireApplication() {
   
     /* Logout button. */
     $("logoutButton")
       ?.addEventListener(
         "click",
         logout
       );
   
   
     /* Start a brand-new conversation. */
     $("newChatButton")
       ?.addEventListener(
         "click",
         () =>
           startNewConversation(
             true
           )
       );
   
   
     /* Main text/voice chat form. */
     $("chatForm")
       ?.addEventListener(
         "submit",
         handleChatSubmit
       );
   
   
     /* Resize composer and update character count while typing. */
     $("messageInput")
       ?.addEventListener(
         "input",
         () => {
   
           autoResizeTextarea();
   
           updateCharacterCounter();
   
         }
       );
   
   
     /*
       Enter sends.
       Shift + Enter adds a new line.
     */
     $("messageInput")
       ?.addEventListener(
         "keydown",
         (event) => {
   
           if (
             event.key === "Enter"
             &&
             !event.shiftKey
           ) {
   
             event.preventDefault();
   
   
             $("chatForm")
               ?.requestSubmit();
   
           }
   
         }
       );
   
   
     /* ===============================================================
        SERVICE CARDS / SIDEBAR SERVICES
        =============================================================== */
   
     document
       .querySelectorAll(
         "[data-action]"
       )
       .forEach(
         (button) => {
   
           button.addEventListener(
             "click",
             () =>
               selectService(
                 button.dataset.action
               )
           );
   
         }
       );
   
   
     /* ===============================================================
        POPULAR HELP BUTTONS
   
        These only PREPARE the message.
        They DO NOT automatically send.
        =============================================================== */
   
     document
       .querySelectorAll(
         ".popular-action"
       )
       .forEach(
         (button) => {
   
           button.addEventListener(
             "click",
             () =>
               preparePrompt(
                 button.dataset.prompt
               )
           );
   
         }
       );
   
   
     $("closeGuidedPanel")
       ?.addEventListener(
         "click",
         closeGuidedPanel
       );
   
   
     $("clearContextButton")
       ?.addEventListener(
         "click",
         clearSelectedTopic
       );
   
   
     /* Human support review button. */
     $("supportReviewButton")
       ?.addEventListener(
         "click",
         openSupportModal
       );
   
   
     $("closeSupportModalButton")
       ?.addEventListener(
         "click",
         closeSupportModal
       );
   
   
     $("closeSuccessModalButton")
       ?.addEventListener(
         "click",
         () => {
   
           $("supportSuccessModal")
             ?.classList
             .add(
               "hidden"
             );
   
         }
       );
   
   
     $("supportRequestForm")
       ?.addEventListener(
         "submit",
         handleSupportRequest
       );
   
   
     /*
       Clicking the modal backdrop closes it.
       Clicking inside the dialog does not.
     */
     $("supportModal")
       ?.addEventListener(
         "click",
         (event) => {
   
           if (
             event.target ===
             $("supportModal")
           ) {
   
             closeSupportModal();
   
           }
   
         }
       );
   
   
     /* Mobile sidebar controls. */
     $("openSidebarButton")
       ?.addEventListener(
         "click",
         () => {
   
           $("sidebar")
             ?.classList
             .add(
               "open"
             );
   
         }
       );
   
   
     $("closeSidebarButton")
       ?.addEventListener(
         "click",
         () => {
   
           $("sidebar")
             ?.classList
             .remove(
               "open"
             );
   
         }
       );
   
   }
   
   
   /* =================================================================
      SELECT TELECOM SERVICE
      ================================================================= */
   
   function selectService(action) {
   
     const service =
       SERVICE_CATALOGUE[
         action
       ];
   
   
     if (!service) {
       return;
     }
   
   
     /*
       Remember this context until the next message is sent.
     */
     state.selectedTopic =
       action;
   
   
     if ($("composerContextText")) {
   
       $("composerContextText")
         .textContent =
           service.label;
   
     }
   
   
     $("composerContext")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     if ($("messageInput")) {
   
       $("messageInput")
         .placeholder =
           service.placeholder;
   
     }
   
   
     renderGuidedPanel(
       service
     );
   
   
     $("sidebar")
       ?.classList
       .remove(
         "open"
       );
   
   }
   
   
   /* =================================================================
      GUIDED SUPPORT PANEL
      ================================================================= */
   
   function renderGuidedPanel(service) {
   
     if (!$("guidedPanel")) {
       return;
     }
   
   
     if ($("guidedTitle")) {
   
       $("guidedTitle")
         .textContent =
           service.label;
   
     }
   
   
     if ($("guidedDescription")) {
   
       $("guidedDescription")
         .textContent =
           service.description;
   
     }
   
   
     const holder =
       $("guidedSuggestions");
   
   
     if (!holder) {
       return;
     }
   
   
     holder.innerHTML =
       "";
   
   
     service.suggestions.forEach(
       (suggestion) => {
   
         const chip =
           document.createElement(
             "button"
           );
   
   
         chip.type =
           "button";
   
   
         chip.className =
           "guided-chip";
   
   
         chip.textContent =
           suggestion;
   
   
         /*
           IMPORTANT:
   
           Suggestion only enters the message composer.
   
           It does NOT send automatically.
         */
         chip.addEventListener(
           "click",
           () =>
             preparePrompt(
               suggestion
             )
         );
   
   
         holder.appendChild(
           chip
         );
   
       }
     );
   
   
     $("guidedPanel")
       .classList
       .remove(
         "hidden"
       );
   
   
     $("guidedPanel")
       .scrollIntoView({
         behavior: "smooth",
         block: "nearest"
       });
   
   }
   
   
   /* =================================================================
      CLOSE GUIDED PANEL
      ================================================================= */
   
   function closeGuidedPanel() {
   
     $("guidedPanel")
       ?.classList
       .add(
         "hidden"
       );
   
   }
   
   
   /* =================================================================
      PREPARE SUGGESTED MESSAGE
      ================================================================= */
   
   function preparePrompt(prompt) {
   
     const input =
       $("messageInput");
   
   
     if (!input) {
       return;
     }
   
   
     /*
       Only fill the textbox.
       Do NOT automatically submit.
     */
     input.value =
       prompt || "";
   
   
     updateCharacterCounter();
   
   
     autoResizeTextarea();
   
   
     input.focus();
   
   }
   
   
   /* =================================================================
      CLEAR SELECTED SERVICE TOPIC
      ================================================================= */
   
   function clearSelectedTopic() {
   
     state.selectedTopic =
       null;
   
   
     $("composerContext")
       ?.classList
       .add(
         "hidden"
       );
   
   
     if ($("messageInput")) {
   
       $("messageInput")
         .placeholder =
           "Describe what you need help with...";
   
     }
   
   }
   
   
   /* =================================================================
      CONVERSATION STORAGE
      ================================================================= */
   
   
   /*
     Conversation data belongs to the currently signed-in user.
   
     Example key:
         nexatel_conversations_customer@example.com
   */
   function conversationStorageKey() {
   
     return (
       `${STORAGE.conversationPrefix}_${state.user?.email || "guest"}`
     );
   
   }
   
   
   /* =================================================================
      LOAD CONVERSATION HISTORY
      ================================================================= */
   
   function loadUserConversations() {
   
     try {
   
       const stored =
         localStorage.getItem(
           conversationStorageKey()
         );
   
   
       const parsed =
         stored
           ? JSON.parse(
               stored
             )
           : [];
   
   
       state.conversations =
         Array.isArray(
           parsed
         )
   
           ? parsed.slice(
               0,
               MAX_HISTORY
             )
   
           : [];
   
   
       /*
         Make this version compatible with any conversations
         created by earlier versions of app.js.
       */
       state.conversations =
         state.conversations.map(
           (conversation) => ({
   
             id:
               conversation.id
               ||
               generateId(
                 "chat"
               ),
   
             sessionId:
               conversation.sessionId
               ||
               conversation.session_id
               ||
               generateId(
                 "session"
               ),
   
             title:
               conversation.title
               ||
               "New conversation",
   
             createdAt:
               conversation.createdAt
               ||
               conversation.created_at
               ||
               new Date()
                 .toISOString(),
   
             updatedAt:
               conversation.updatedAt
               ||
               conversation.updated_at
               ||
               conversation.createdAt
               ||
               new Date()
                 .toISOString(),
   
             messages:
               Array.isArray(
                 conversation.messages
               )
   
                 ? conversation.messages
   
                 : [],
   
             channel:
               conversation.channel
               ||
               "chat"
   
           })
         );
   
     } catch (error) {
   
       console.error(
         "Unable to load conversation history:",
         error
       );
   
   
       state.conversations =
         [];
   
     }
   
   }
   
   
   /* =================================================================
      SAVE CONVERSATIONS
      ================================================================= */
   
   function saveConversations() {
   
     /*
       Most recently updated chat appears at the top.
     */
     state.conversations.sort(
       (a, b) =>
         new Date(
           b.updatedAt
         )
         -
         new Date(
           a.updatedAt
         )
     );
   
   
     /*
       Only keep latest five chats.
     */
     state.conversations =
       state.conversations.slice(
         0,
         MAX_HISTORY
       );
   
   
     localStorage.setItem(
       conversationStorageKey(),
       JSON.stringify(
         state.conversations
       )
     );
   
   
     if (
       state.currentConversationId
     ) {
   
       localStorage.setItem(
         STORAGE.activeConversation,
         state.currentConversationId
       );
   
     }
   
   }
   
   
   /* =================================================================
      CREATE CONVERSATION
      ================================================================= */
   
   function createConversation() {
   
     const now =
       new Date()
         .toISOString();
   
   
     return {
   
       /*
         Frontend chat ID.
       */
       id:
         generateId(
           "chat"
         ),
   
   
       /*
         Backend conversation/session ID.
   
         This allows follow-up questions to remain contextual.
       */
       sessionId:
         generateId(
           "session"
         ),
   
   
       title:
         "New conversation",
   
   
       createdAt:
         now,
   
   
       updatedAt:
         now,
   
   
       messages:
         [],
   
   
       channel:
         "chat"
   
     };
   
   }
   
   
   /* =================================================================
      START NEW CHAT
      ================================================================= */
   
   function startNewConversation(
     showNotice = true
   ) {
   
     const conversation =
       createConversation();
   
   
     state.conversations.unshift(
       conversation
     );
   
   
     state.conversations =
       state.conversations.slice(
         0,
         MAX_HISTORY
       );
   
   
     state.currentConversationId =
       conversation.id;
   
   
     /*
       Do not carry service context or escalation state
       from the previous conversation.
     */
     state.selectedTopic =
       null;
   
   
     state.supportEligible =
       false;
   
   
     /*
       Voice mode is always reset when a new chat begins.
     */
     state.activeChannel =
       "chat";
   
   
     state.speakNextReply =
       false;
   
   
     saveConversations();
   
   
     renderConversationHistory();
   
   
     renderCurrentConversation();
   
   
     updateSupportButton();
   
   
     closeGuidedPanel();
   
   
     $("messageInput")
       ?.focus();
   
   
     $("sidebar")
       ?.classList
       .remove(
         "open"
       );
   
   
     if (showNotice) {
   
       showToast(
         "New conversation started.",
         "info"
       );
   
     }
   
   }
   
   
   /* =================================================================
      CURRENT CONVERSATION
      ================================================================= */
   
   function getCurrentConversation() {
   
     return (
       state.conversations.find(
         (conversation) =>
           conversation.id ===
           state.currentConversationId
       )
       ||
       null
     );
   
   }
   
   
   /* =================================================================
      OPEN OLD CONVERSATION
      ================================================================= */
   
   function openConversation(id) {
   
     const exists =
       state.conversations.some(
         (conversation) =>
           conversation.id ===
           id
       );
   
   
     if (!exists) {
       return;
     }
   
   
     /*
       Stop any speech from the conversation we are leaving.
     */
     if (
       typeof window.speechSynthesis !==
       "undefined"
     ) {
   
       window.speechSynthesis.cancel();
   
     }
   
   
     state.activeChannel =
       "chat";
   
   
     state.speakNextReply =
       false;
   
   
     state.currentConversationId =
       id;
   
   
     state.selectedTopic =
       null;
   
   
     saveConversations();
   
   
     renderConversationHistory();
   
   
     renderCurrentConversation();
   
   
     evaluateEscalation();
   
   
     $("sidebar")
       ?.classList
       .remove(
         "open"
       );
   
   }
   
   
   /* =================================================================
      RENDER CHAT HISTORY SIDEBAR
      ================================================================= */
   
   function renderConversationHistory() {
   
     const container =
       $("conversationHistory");
   
   
     if (!container) {
       return;
     }
   
   
     container.innerHTML =
       "";
   
   
     if ($("historyCount")) {
   
       $("historyCount")
         .textContent =
           `${state.conversations.length}/${MAX_HISTORY}`;
   
     }
   
   
     $("emptyHistory")
       ?.classList
       .toggle(
         "hidden",
         state.conversations.length > 0
       );
   
   
     state.conversations.forEach(
       (conversation) => {
   
         const button =
           document.createElement(
             "button"
           );
   
   
         button.type =
           "button";
   
   
         button.className =
           "history-item";
   
   
         if (
           conversation.id ===
           state.currentConversationId
         ) {
   
           button.classList.add(
             "active"
           );
   
         }
   
   
         button.innerHTML = `
   
           <span>
             ◇
           </span>
   
           <span class="history-item-copy">
   
             <span class="history-item-title">
   
               ${escapeHtml(
                 conversation.title
                 ||
                 "New conversation"
               )}
   
             </span>
   
             <span class="history-item-date">
   
               ${formatConversationDate(
                 conversation.updatedAt
               )}
   
             </span>
   
           </span>
   
         `;
   
   
         button.addEventListener(
           "click",
           () =>
             openConversation(
               conversation.id
             )
         );
   
   
         container.appendChild(
           button
         );
   
       }
     );
   
   }
   
   
   /* =================================================================
      RENDER CURRENT CONVERSATION
      ================================================================= */
   
   function renderCurrentConversation() {
   
     const conversation =
       getCurrentConversation();
   
   
     const list =
       $("messagesList");
   
   
     if (
       !conversation
       ||
       !list
     ) {
   
       return;
   
     }
   
   
     list.innerHTML =
       "";
   
   
     const hasMessages =
       conversation.messages.length > 0;
   
   
     /*
       Welcome service cards disappear after the conversation begins.
     */
     $("welcomePanel")
       ?.classList
       .toggle(
         "hidden",
         hasMessages
       );
   
   
     if ($("conversationTitle")) {
   
       $("conversationTitle")
         .textContent =
   
           conversation.title ===
           "New conversation"
   
             ? "AI Support"
   
             : conversation.title;
   
     }
   
   
     conversation.messages.forEach(
       (message) =>
         renderMessage(
           message
         )
     );
   
   
     clearSelectedTopic();
   
   
     scrollToBottom();
   
   }
   
   
   /* =================================================================
      SEND CHAT / VOICE MESSAGE
      =================================================================
   
      Both channels use the same conversation history.
   
      TEXT:
          /chat
   
      VOICE:
          microphone
              ↓
          SpeechRecognition
              ↓
          transcript
              ↓
          /voice/chat
              ↓
          same NexaTel RAG + LLM logic
              ↓
          voice reply is spoken with speechSynthesis
      ================================================================= */
   
   async function handleChatSubmit(event) {
   
     event.preventDefault();
   
   
     if (
       state.isSending
     ) {
   
       return;
   
     }
   
   
     const input =
       $("messageInput");
   
   
     const text =
       input
         ?.value
         .trim();
   
   
     if (!text) {
       return;
     }
   
   
     let conversation =
       getCurrentConversation();
   
   
     if (!conversation) {
   
       startNewConversation(
         false
       );
   
   
       conversation =
         getCurrentConversation();
   
     }
   
   
     /*
       Capture the channel NOW.
   
       This is important because activeChannel is later reset.
     */
     const usingVoice =
       state.activeChannel ===
       "voice";
   
   
     conversation.channel =
       usingVoice
         ? "voice"
         : "chat";
   
   
     const userMessage = {
   
       role:
         "user",
   
       content:
         text,
   
       timestamp:
         new Date()
           .toISOString(),
   
       topic:
         state.selectedTopic
   
     };
   
   
     conversation.messages.push(
       userMessage
     );
   
   
     conversation.updatedAt =
       new Date()
         .toISOString();
   
   
     /*
       First user message becomes conversation title.
     */
     if (
       conversation.title ===
       "New conversation"
     ) {
   
       conversation.title =
         createTitle(
           text
         );
   
     }
   
   
     saveConversations();
   
   
     renderConversationHistory();
   
   
     $("welcomePanel")
       ?.classList
       .add(
         "hidden"
       );
   
   
     renderMessage(
       userMessage
     );
   
   
     /*
       Clear the composer immediately.
     */
     input.value =
       "";
   
   
     updateCharacterCounter();
   
   
     autoResizeTextarea();
   
   
     clearSelectedTopic();
   
   
     closeGuidedPanel();
   
   
     scrollToBottom();
   
   
     state.isSending =
       true;
   
   
     if ($("sendButton")) {
   
       $("sendButton")
         .disabled =
           true;
   
     }
   
   
     $("typingIndicator")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     scrollToBottom();
   
   
     try {
   
       /*
         Select correct API without duplicating the AI conversation logic.
       */
       const endpoint =
         usingVoice
   
           ? API.voiceChat
   
           : API.chat;
   
   
       /*
         Voice backend expects "transcript".
         Text backend expects "message".
       */
       const payload =
         usingVoice
   
           ? {
   
               transcript:
                 text,
   
               session_id:
                 conversation.sessionId,
   
               user_id:
                 state.user?.id
                 ||
                 null,
   
               user_email:
                 state.user?.email
                 ||
                 null,
   
               topic:
                 userMessage.topic
                 ||
                 null
   
             }
   
           : {
   
               message:
                 text,
   
               session_id:
                 conversation.sessionId,
   
               user_id:
                 state.user?.id
                 ||
                 null,
   
               user_email:
                 state.user?.email
                 ||
                 null,
   
               topic:
                 userMessage.topic
                 ||
                 null,
   
               channel:
                 "chat"
   
             };
   
   
       const response =
         await fetch(
           endpoint,
           {
   
             method:
               "POST",
   
             headers: {
   
               "Content-Type":
                 "application/json"
   
             },
   
             body:
               JSON.stringify(
                 payload
               )
   
           }
         );
   
   
       const data =
         await readJson(
           response
         );
   
   
       if (!response.ok) {
   
         throw new Error(
   
           extractSafeApiError(
             data,
             "I'm having trouble processing that request right now."
           )
   
         );
   
       }
   
   
       /*
         Support slightly different backend response names.
       */
       const reply =
         data.reply
         ||
         data.response
         ||
         data.answer
         ||
         data.message;
   
   
       if (
         typeof reply !==
         "string"
         ||
         !reply.trim()
       ) {
   
         throw new Error(
           "The support service returned an incomplete response."
         );
   
       }
   
   
       /*
         Backend may return an updated session identifier.
       */
       if (
         data.session_id
       ) {
   
         conversation.sessionId =
           data.session_id;
   
       }
   
   
       const assistantMessage = {
   
         role:
           "assistant",
   
         content:
           reply.trim(),
   
         timestamp:
           new Date()
             .toISOString(),
   
         /*
           Backend can recommend human escalation using any of
           these supported flags.
         */
         escalationRecommended:
           Boolean(
             data.escalation_recommended
             ||
             data.needs_human_review
             ||
             data.requires_support
           )
   
       };
   
   
       conversation.messages.push(
         assistantMessage
       );
   
   
       conversation.updatedAt =
         new Date()
           .toISOString();
   
   
       saveConversations();
   
   
       renderMessage(
         assistantMessage
       );
   
   
       evaluateEscalation(
         assistantMessage
       );
   
   
       /*
         VOICE RESPONSE
   
         Only read the assistant response aloud when the original
         input came from the microphone.
       */
       if (
         usingVoice
         &&
         state.speakNextReply
         &&
         typeof window.speechSynthesis !==
           "undefined"
       ) {
   
         speakAssistantReply(
           data.speak_text
           ||
           assistantMessage.content
         );
   
       }
   
     } catch (error) {
   
       console.error(
         "Chat request failed:",
         error
       );
   
   
       /*
         Never expose raw NVIDIA/OpenAI/Twilio/etc. errors
         directly to the customer.
       */
       const fallback = {
   
         role:
           "assistant",
   
         content:
           `${customerSafeError(
             error.message
           )}\n\n`
           +
           "You can try again. If this is an account-specific or transaction issue, support review is available.",
   
         timestamp:
           new Date()
             .toISOString(),
   
         escalationRecommended:
           true
   
       };
   
   
       conversation.messages.push(
         fallback
       );
   
   
       conversation.updatedAt =
         new Date()
           .toISOString();
   
   
       saveConversations();
   
   
       renderMessage(
         fallback
       );
   
   
       state.supportEligible =
         true;
   
   
       updateSupportButton();
   
     } finally {
   
       /*
         CRITICAL VOICE SAFETY FIX:
   
         Voice applies to ONE message only.
   
         Without this reset, a failed voice request could cause
         the customer's next typed message to accidentally be
         sent to /voice/chat or spoken aloud.
       */
       state.activeChannel =
         "chat";
   
   
       state.speakNextReply =
         false;
   
   
       state.isSending =
         false;
   
   
       if ($("sendButton")) {
   
         $("sendButton")
           .disabled =
             false;
   
       }
   
   
       $("typingIndicator")
         ?.classList
         .add(
           "hidden"
         );
   
   
       scrollToBottom();
   
   
       $("messageInput")
         ?.focus();
   
     }
   
   }
   
   
   /* =================================================================
      RENDER MESSAGE
      ================================================================= */
   
   function renderMessage(message) {
   
     const list =
       $("messagesList");
   
   
     if (!list) {
       return;
     }
   
   
     const row =
       document.createElement(
         "div"
       );
   
   
     row.className =
       `message-row ${message.role}`;
   
   
     const wrap =
       document.createElement(
         "div"
       );
   
   
     wrap.className =
       "message-wrap";
   
   
     const avatar =
       document.createElement(
         "div"
       );
   
   
     if (
       message.role ===
       "assistant"
     ) {
   
       avatar.className =
         "assistant-avatar";
   
   
       avatar.textContent =
         "✦";
   
     } else {
   
       avatar.className =
         "message-user-avatar";
   
   
       avatar.textContent =
         (
           state.user?.name
           ||
           "C"
         )
           .charAt(0)
           .toUpperCase();
   
     }
   
   
     const content =
       document.createElement(
         "div"
       );
   
   
     const bubble =
       document.createElement(
         "div"
       );
   
   
     bubble.className =
       "message-bubble";
   
   
     /*
       textContent is intentional.
   
       This prevents an AI/customer message from injecting HTML
       into the page.
     */
     bubble.textContent =
       message.content;
   
   
     content.appendChild(
       bubble
     );
   
   
     const time =
       document.createElement(
         "div"
       );
   
   
     time.className =
       "message-time";
   
   
     time.textContent =
       formatMessageTime(
         message.timestamp
       );
   
   
     content.appendChild(
       time
     );
   
   
     /*
       AI messages receive thumbs-up / thumbs-down controls.
     */
     if (
       message.role ===
       "assistant"
     ) {
   
       content.appendChild(
         createFeedbackControls(
           message
         )
       );
   
     }
   
   
     wrap.appendChild(
       avatar
     );
   
   
     wrap.appendChild(
       content
     );
   
   
     row.appendChild(
       wrap
     );
   
   
     list.appendChild(
       row
     );
   
   }
   
   
   /* =================================================================
      AI RESPONSE FEEDBACK
      ================================================================= */
   
   function createFeedbackControls(message) {
   
     const box =
       document.createElement(
         "div"
       );
   
   
     box.className =
       "message-feedback";
   
   
     const yes =
       document.createElement(
         "button"
       );
   
   
     yes.type =
       "button";
   
   
     yes.className =
       "feedback-button";
   
   
     yes.textContent =
       "👍";
   
   
     const no =
       document.createElement(
         "button"
       );
   
   
     no.type =
       "button";
   
   
     no.className =
       "feedback-button";
   
   
     no.textContent =
       "👎";
   
   
     /*
       Restore existing feedback when old conversations are opened.
     */
     if (
       message.feedback ===
       "positive"
     ) {
   
       yes.classList.add(
         "selected"
       );
   
     }
   
   
     if (
       message.feedback ===
       "negative"
     ) {
   
       no.classList.add(
         "selected"
       );
   
     }
   
   
     yes.addEventListener(
       "click",
       () => {
   
         message.feedback =
           "positive";
   
   
         yes.classList.add(
           "selected"
         );
   
   
         no.classList.remove(
           "selected"
         );
   
   
         saveConversations();
   
   
         showToast(
           "Thanks for the feedback.",
           "success"
         );
   
       }
     );
   
   
     no.addEventListener(
       "click",
       () => {
   
         message.feedback =
           "negative";
   
   
         no.classList.add(
           "selected"
         );
   
   
         yes.classList.remove(
           "selected"
         );
   
   
         saveConversations();
   
   
         /*
           A negative response is a strong signal that AI
           may not have resolved the issue.
         */
         state.supportEligible =
           true;
   
   
         updateSupportButton();
   
   
         showToast(
           "Support review is now available if you still need help.",
           "info"
         );
   
       }
     );
   
   
     box.appendChild(
       yes
     );
   
   
     box.appendChild(
       no
     );
   
   
     return box;
   
   }
   
   
   /* =================================================================
      HUMAN ESCALATION LOGIC
      =================================================================
   
      Human escalation should appear meaningfully rather than giving
      customers an immediate shortcut directly to support.
   
      Signals include:
   
      - Transaction/recharge issues
      - Repeated troubleshooting
      - Negative AI feedback
      - Explicit backend recommendation
      ================================================================= */
   
   function evaluateEscalation(
     latestAssistantMessage = null
   ) {
   
     const conversation =
       getCurrentConversation();
   
   
     if (!conversation) {
       return;
     }
   
   
     const userMessages =
       conversation.messages.filter(
         (message) =>
           message.role ===
           "user"
       );
   
   
     const text =
       userMessages
         .map(
           (message) =>
             String(
               message.content || ""
             )
               .toLowerCase()
         )
         .join(
           " "
         );
   
   
     /*
       Account-specific / transactional phrases that commonly
       require human verification.
     */
     const highSignalPhrases = [
   
       "money deducted",
   
       "amount deducted",
   
       "payment deducted",
   
       "recharge not reflecting",
   
       "not credited",
   
       "charged twice",
   
       "double charged",
   
       "refund",
   
       "sim blocked",
   
       "account blocked",
   
       "still not working",
   
       "did not work",
   
       "didn't work",
   
       "not resolved",
   
       "complaint",
   
       "transaction"
   
     ];
   
   
     const highSignalIssue =
       highSignalPhrases.some(
         (phrase) =>
           text.includes(
             phrase
           )
       );
   
   
     /*
       After multiple user turns, human review becomes reasonable
       if the AI still hasn't resolved the issue.
     */
     const enoughTroubleshooting =
       userMessages.length >= 2;
   
   
     const negativeFeedback =
       conversation.messages.some(
         (message) =>
           message.feedback ===
           "negative"
       );
   
   
     const backendRecommended =
       Boolean(
         latestAssistantMessage
           ?.escalationRecommended
       );
   
   
     state.supportEligible =
       highSignalIssue
       ||
       enoughTroubleshooting
       ||
       negativeFeedback
       ||
       backendRecommended;
   
   
     updateSupportButton();
   
   }
   
   
   /* =================================================================
      UPDATE SUPPORT REVIEW BUTTON
      ================================================================= */
   
   function updateSupportButton() {
   
     $("supportReviewButton")
       ?.classList
       .toggle(
         "hidden",
         !state.supportEligible
       );
   
   }
   
   
   /* =================================================================
      SUPPORT REVIEW MODAL
      ================================================================= */
   
   function openSupportModal() {
   
     /*
       Customer cannot use support review until the escalation
       criteria have been reached.
     */
     if (
       !state.supportEligible
     ) {
   
       return;
   
     }
   
   
     $("supportModal")
       ?.classList
       .remove(
         "hidden"
       );
   
   
     $("supportReason")
       ?.focus();
   
   }
   
   
   /* =================================================================
      CLOSE SUPPORT MODAL
      ================================================================= */
   
   function closeSupportModal() {
   
     $("supportModal")
       ?.classList
       .add(
         "hidden"
       );
   
   }
   
   
   /* =================================================================
      CREATE SUPPORT REQUEST
      =================================================================
   
      IMPORTANT ARCHITECTURE:
   
      Customer does NOT directly trigger Twilio.
   
      Customer:
          requests review
   
      Support queue:
          receives ticket
   
      Support agent:
          reviews conversation
   
      Support agent:
          decides whether callback is appropriate
   
      Twilio:
          initiated only from support-side workflow
      ================================================================= */
   
   async function handleSupportRequest(event) {
   
     event.preventDefault();
   
   
     const conversation =
       getCurrentConversation();
   
   
     if (!conversation) {
       return;
     }
   
   
     const reason =
       $("supportReason")
         ?.value
         .trim();
   
   
     if (!reason) {
   
       showToast(
         "Please describe what is still unresolved.",
         "error"
       );
   
       return;
   
     }
   
   
     /*
       Customer can state their preferred next channel.
   
       This preference does NOT directly initiate a call.
     */
     const preference =
       document.querySelector(
         'input[name="contactPreference"]:checked'
       )
         ?.value
       ||
       "callback";
   
   
     setButtonLoading(
       $("submitSupportButton"),
       true,
       "Submitting..."
     );
   
   
     try {
   
       const response =
         await fetch(
           API.support,
           {
   
             method:
               "POST",
   
             headers: {
   
               "Content-Type":
                 "application/json"
   
             },
   
             body:
               JSON.stringify({
   
                 session_id:
                   conversation.sessionId,
   
                 conversation_id:
                   conversation.id,
   
                 user_id:
                   state.user?.id
                   ||
                   null,
   
                 customer_name:
                   state.user?.name
                   ||
                   null,
   
                 customer_email:
                   state.user?.email
                   ||
                   null,
   
                 customer_phone:
                   state.user?.phone
                   ||
                   null,
   
                 reason,
   
                 contact_preference:
                   preference,
   
                 /*
                   Send the existing conversation so the support agent
                   doesn't force the customer to explain everything again.
                 */
                 conversation:
                   conversation.messages.map(
                     (message) => ({
   
                       role:
                         message.role,
   
                       content:
                         message.content,
   
                       timestamp:
                         message.timestamp
   
                     })
                   )
   
               })
   
           }
         );
   
   
       const data =
         await readJson(
           response
         );
   
   
       if (!response.ok) {
   
         throw new Error(
   
           extractSafeApiError(
             data,
             "We couldn't submit the support request right now."
           )
   
         );
   
       }
   
   
       closeSupportModal();
   
   
       /*
         Customer-facing success message.
   
         Notice we do not expose internal Twilio/SendGrid details.
       */
       if (
         $("supportSuccessMessage")
       ) {
   
         $("supportSuccessMessage")
           .textContent =
   
             preference ===
             "callback"
   
               ? "Your case has been sent for review. If a call is appropriate, a support agent will contact you after reviewing the conversation."
   
               : "Your case has been sent for review. Updates will be sent to your registered email address.";
   
       }
   
   
       /*
         Backend may use any of these reference names.
       */
       const reference =
         data.ticket_id
         ||
         data.request_id
         ||
         data.reference_id;
   
   
       if (
         reference
         &&
         $("supportTicketReference")
       ) {
   
         $("supportTicketReference")
           .textContent =
             `Reference: ${reference}`;
   
   
         $("supportTicketReference")
           .classList
           .remove(
             "hidden"
           );
   
       } else {
   
         $("supportTicketReference")
           ?.classList
           .add(
             "hidden"
           );
   
       }
   
   
       $("supportSuccessModal")
         ?.classList
         .remove(
           "hidden"
         );
   
   
       if ($("supportReason")) {
   
         $("supportReason")
           .value =
             "";
   
       }
   
   
       /*
         Once request enters the queue, hide the support-review
         action so the user doesn't repeatedly create duplicates.
       */
       state.supportEligible =
         false;
   
   
       updateSupportButton();
   
     } catch (error) {
   
       console.error(
         "Support request failed:",
         error
       );
   
   
       showToast(
         customerSafeError(
           error.message
         ),
         "error"
       );
   
     } finally {
   
       setButtonLoading(
         $("submitSupportButton"),
         false,
         "Submit request"
       );
   
     }
   
   }
   
   
   /* =================================================================
      SAFE JSON PARSER
      ================================================================= */
   
   async function readJson(response) {
   
     const text =
       await response.text();
   
   
     if (!text) {
       return {};
     }
   
   
     try {
   
       return JSON.parse(
         text
       );
   
     } catch {
   
       /*
         Some backend/server errors may return plain text rather
         than JSON. Convert them into our standard structure.
       */
       return {
   
         detail:
           text
   
       };
   
     }
   
   }
   
   
   /* =================================================================
      EXTRACT CUSTOMER-SAFE API ERROR
      ================================================================= */
   
   function extractSafeApiError(
     data,
     fallback
   ) {
   
     const raw =
       data?.detail
       ||
       data?.message
       ||
       data?.error
       ||
       fallback;
   
   
     return typeof raw ===
       "string"
   
       ? customerSafeError(
           raw
         )
   
       : fallback;
   
   }
   
   
   /* =================================================================
      CUSTOMER-SAFE ERROR FILTER
      =================================================================
   
      Customers should NEVER see internal technology errors like:
   
      Twilio failed
      SendGrid failed
      OpenAI quota
      NVIDIA API error
      Gemini API error
      Uvicorn error
      Traceback
      HTTP 500 stack output
      ================================================================= */
   
   function customerSafeError(message) {
   
     const raw =
       String(
         message || ""
       );
   
   
     const lower =
       raw.toLowerCase();
   
   
     const internalTerms = [
   
       "twilio",
   
       "sendgrid",
   
       "openai",
   
       "nvidia",
   
       "gemini",
   
       "api key",
   
       "traceback",
   
       "authenticationerror",
   
       "smtp",
   
       "quota",
   
       "exception",
   
       "uvicorn",
   
       "connection refused",
   
       "connectionerror",
   
       "503",
   
       "500"
   
     ];
   
   
     /*
       Convert infrastructure errors into a safe customer-facing message.
     */
     if (
       internalTerms.some(
         (term) =>
           lower.includes(
             term
           )
       )
     ) {
   
       return (
         "We're having trouble completing that request right now. Please try again."
       );
   
     }
   
   
     /*
       Backend not reachable.
     */
     if (
       raw ===
       "Failed to fetch"
     ) {
   
       return (
         "The support service is temporarily unreachable. Please try again shortly."
       );
   
     }
   
   
     /*
       Reasonable backend-generated user-facing messages are allowed
       through if they are short enough.
     */
     if (
       raw
       &&
       raw.length <= 220
     ) {
   
       return raw;
   
     }
   
   
     return (
       "Something went wrong while processing your request. Please try again."
     );
   
   }
   
   
   /* =================================================================
      BUTTON LOADING HELPER
      ================================================================= */
   
   function setButtonLoading(
     button,
     loading,
     label
   ) {
   
     if (!button) {
       return;
     }
   
   
     button.disabled =
       loading;
   
   
     button.textContent =
       label;
   
   }
   
   
   /* =================================================================
      TOAST NOTIFICATION
      ================================================================= */
   
   function showToast(
     message,
     type = "info"
   ) {
   
     const container =
       $("toastContainer");
   
   
     if (!container) {
       return;
     }
   
   
     const toast =
       document.createElement(
         "div"
       );
   
   
     toast.className =
       `toast ${type}`;
   
   
     toast.textContent =
       message;
   
   
     container.appendChild(
       toast
     );
   
   
     setTimeout(
       () =>
         toast.remove(),
       4000
     );
   
   }
   
   
   /* =================================================================
      AUTO-RESIZE MESSAGE TEXTAREA
      ================================================================= */
   
   function autoResizeTextarea() {
   
     const input =
       $("messageInput");
   
   
     if (!input) {
       return;
     }
   
   
     input.style.height =
       "auto";
   
   
     input.style.height =
       `${Math.min(
         input.scrollHeight,
         150
       )}px`;
   
   }
   
   
   /* =================================================================
      CHARACTER COUNTER
      ================================================================= */
   
   function updateCharacterCounter() {
   
     if (
       $("messageInput")
       &&
       $("characterCounter")
     ) {
   
       $("characterCounter")
         .textContent =
           `${$("messageInput").value.length} / 2000`;
   
     }
   
   }
   
   
   /* =================================================================
      SCROLL CHAT TO LATEST MESSAGE
      ================================================================= */
   
   function scrollToBottom() {
   
     requestAnimationFrame(
       () => {
   
         const container =
           $("messagesContainer");
   
   
         if (container) {
   
           container.scrollTop =
             container.scrollHeight;
   
         }
   
       }
     );
   
   }
   
   
   /* =================================================================
      CREATE CONVERSATION TITLE
      ================================================================= */
   
   function createTitle(message) {
   
     const clean =
       String(
         message || ""
       )
         .replace(
           /\s+/g,
           " "
         )
         .trim();
   
   
     return clean.length <= 34
   
       ? clean
   
       : `${clean.slice(
           0,
           34
         )}...`;
   
   }
   
   
   /* =================================================================
      FORMAT MESSAGE TIME
      ================================================================= */
   
   function formatMessageTime(timestamp) {
   
     try {
   
       return new Date(
         timestamp
       )
         .toLocaleTimeString(
           [],
           {
   
             hour:
               "2-digit",
   
             minute:
               "2-digit"
   
           }
         );
   
     } catch {
   
       return "";
   
     }
   
   }
   
   
   /* =================================================================
      FORMAT CONVERSATION DATE
      ================================================================= */
   
   function formatConversationDate(timestamp) {
   
     try {
   
       const date =
         new Date(
           timestamp
         );
   
   
       const today =
         new Date();
   
   
       if (
         date.toDateString() ===
         today.toDateString()
       ) {
   
         return formatMessageTime(
           timestamp
         );
   
       }
   
   
       return date
         .toLocaleDateString(
           [],
           {
   
             day:
               "numeric",
   
             month:
               "short"
   
           }
         );
   
     } catch {
   
       return "";
   
     }
   
   }
   
   
   /* =================================================================
      GENERATE CLIENT-SIDE ID
      ================================================================= */
   
   function generateId(prefix) {
   
     /*
       Modern browsers.
     */
     if (
       window.crypto
         ?.randomUUID
     ) {
   
       return (
         `${prefix}_${crypto.randomUUID()}`
       );
   
     }
   
   
     /*
       Fallback for older browsers.
     */
     return (
       `${prefix}_${Date.now()}_${Math.random()
         .toString(36)
         .slice(2, 10)}`
     );
   
   }
   
   
   /* =================================================================
      ESCAPE HTML
      ================================================================= */
   
   function escapeHtml(value) {
   
     const div =
       document.createElement(
         "div"
       );
   
   
     div.textContent =
       String(
         value || ""
       );
   
   
     return div.innerHTML;
   
   }
   
   
   /* =================================================================
      VOICE SUPPORT
      =================================================================
   
      Browser voice prototype:
   
         Customer clicks microphone
                    ↓
         SpeechRecognition listens
                    ↓
         Browser creates transcript
                    ↓
         Transcript enters normal composer
                    ↓
         Existing chat form submits
                    ↓
         /voice/chat endpoint
                    ↓
         NexaTel RAG + LLM pipeline
                    ↓
         AI response
                    ↓
         speechSynthesis speaks response
   
      This means voice does NOT duplicate the AI logic.
   
      It uses the same customer/session context as chat.
      ================================================================= */
   
   function wireVoiceSupport() {
   
     const button =
       $("voiceButton");
   
   
     if (!button) {
   
       console.warn(
         "Voice button was not found in the page."
       );
   
       return;
   
     }
   
   
     /*
       Protect against duplicate listeners.
   
       This matters because manually calling wireVoiceSupport()
       from the browser console should not create a second mic listener.
     */
     if (
       button.dataset.voiceWired ===
       "true"
     ) {
   
       return;
   
     }
   
   
     button.dataset.voiceWired =
       "true";
   
   
     /*
       Chrome/Edge commonly expose webkitSpeechRecognition.
   
       Some browsers expose the standards-style SpeechRecognition.
     */
     const Recognition =
       window.SpeechRecognition
       ||
       window.webkitSpeechRecognition;
   
   
     /*
       Browser does not support speech recognition.
     */
     if (!Recognition) {
   
       button.addEventListener(
         "click",
         () =>
           showToast(
             "Voice input is not supported by this browser. Please use Chrome or Edge, or type your message.",
             "info"
           )
       );
   
   
       console.warn(
         "SpeechRecognition is not supported by this browser."
       );
   
   
       return;
   
     }
   
   
     /*
       Create ONE recognition instance and reuse it.
     */
     const recognition =
       new Recognition();
   
   
     /*
       Indian English gives better matching for the current demo.
     */
     recognition.lang =
       "en-IN";
   
   
     /*
       We only want final recognised text.
     */
     recognition.interimResults =
       false;
   
   
     /*
       One spoken request per microphone click.
     */
     recognition.continuous =
       false;
   
   
     recognition.maxAlternatives =
       1;
   
   
     /*
       IMPORTANT:
   
       This was one of the missing/critical pieces in the earlier
       broken voice implementation.
   
       It lets the application know that recognition exists.
     */
     state.speechRecognition =
       recognition;
   
   
     console.log(
       "NexaTel voice support initialized."
     );
   
   
     /* ===============================================================
        MICROPHONE BUTTON CLICK
        =============================================================== */
   
     button.addEventListener(
       "click",
       () => {
   
         /*
           Don't start microphone while an AI request is being processed.
         */
         if (
           state.isSending
         ) {
   
           return;
   
         }
   
   
         /*
           If microphone is already listening, clicking again stops it.
         */
         if (
           state.isListening
         ) {
   
           try {
   
             recognition.stop();
   
           } catch (error) {
   
             console.debug(
               "Voice recognition was already stopping:",
               error
             );
   
           }
   
   
           return;
   
         }
   
   
         try {
   
           /*
             Tell handleChatSubmit() that the resulting message
             belongs to the voice channel.
           */
           state.activeChannel =
             "voice";
   
   
           /*
             The next successful AI reply should be spoken.
           */
           state.speakNextReply =
             true;
   
   
           state.isListening =
             true;
   
   
           /*
             Existing CSS can visually animate/highlight microphone.
           */
           button.classList.add(
             "listening"
           );
   
   
           /*
             Show "Listening..." UI if the element exists.
           */
           $("voiceStatus")
             ?.classList
             .remove(
               "hidden"
             );
   
   
           /*
             Browser will now ask for microphone permission if needed.
           */
           recognition.start();
   
         } catch (error) {
   
           console.error(
             "Voice recognition start failed:",
             error
           );
   
   
           /*
             Very important:
             Failed microphone start must not leave app in voice mode.
           */
           state.activeChannel =
             "chat";
   
   
           state.speakNextReply =
             false;
   
   
           state.isListening =
             false;
   
   
           stopVoiceUi();
   
   
           showToast(
             "The microphone could not start. Check browser microphone permission and try again.",
             "error"
           );
   
         }
   
       }
     );
   
   
     /* ===============================================================
        RECOGNITION STARTED
        =============================================================== */
   
     recognition.onstart =
       () => {
   
         state.isListening =
           true;
   
   
         console.log(
           "NexaTel voice recognition started."
         );
   
       };
   
   
     /* ===============================================================
        SPEECH RECOGNISED
        =============================================================== */
   
     recognition.onresult =
       (event) => {
   
         const transcript =
           event.results?.[0]?.[0]?.transcript
             ?.trim();
   
   
         /*
           Nothing useful heard.
         */
         if (!transcript) {
   
           state.activeChannel =
             "chat";
   
   
           state.speakNextReply =
             false;
   
   
           stopVoiceUi();
   
   
           return;
   
         }
   
   
         const input =
           $("messageInput");
   
   
         if (!input) {
   
           state.activeChannel =
             "chat";
   
   
           state.speakNextReply =
             false;
   
   
           stopVoiceUi();
   
   
           return;
   
         }
   
   
         /*
           Put recognised speech into the SAME composer that
           typed messages use.
         */
         input.value =
           transcript;
   
   
         updateCharacterCounter();
   
   
         autoResizeTextarea();
   
   
         stopVoiceUi();
   
   
         /*
           Submit through our normal chat form.
   
           This preserves:
           - conversation history
           - session ID
           - user ID
           - topic context
           - escalation handling
           - message rendering
         */
         $("chatForm")
           ?.requestSubmit();
   
       };
   
   
     /* ===============================================================
        VOICE ERROR
        =============================================================== */
   
     recognition.onerror =
       (event) => {
   
         console.error(
           "Voice recognition error:",
           event.error
         );
   
   
         /*
           Never allow failed recognition to affect the next typed message.
         */
         state.activeChannel =
           "chat";
   
   
         state.speakNextReply =
           false;
   
   
         state.isListening =
           false;
   
   
         stopVoiceUi();
   
   
         const errorMessages = {
   
           "not-allowed":
             "Microphone permission is blocked. Allow microphone access for this site and try again.",
   
           "service-not-allowed":
             "Browser speech recognition is unavailable for this site.",
   
           "audio-capture":
             "No microphone was detected by the browser.",
   
           "network":
             "The browser speech service could not be reached. Please try again.",
   
           "no-speech":
             "I didn't hear anything. Press the microphone and try again."
   
         };
   
   
         showToast(
           errorMessages[
             event.error
           ]
           ||
           "Voice input could not be captured. Please try again or type your message.",
           "error"
         );
   
       };
   
   
     /* ===============================================================
        RECOGNITION ENDED
        =============================================================== */
   
     recognition.onend =
       () => {
   
         state.isListening =
           false;
   
   
         stopVoiceUi();
   
   
         console.log(
           "NexaTel voice recognition ended."
         );
   
       };
   
   }
   
   
   /* =================================================================
      STOP VOICE UI
      ================================================================= */
   
   function stopVoiceUi() {
   
     $("voiceButton")
       ?.classList
       .remove(
         "listening"
       );
   
   
     $("voiceStatus")
       ?.classList
       .add(
         "hidden"
       );
   
   }
   
   
   /* =================================================================
      SPEAK AI RESPONSE
      ================================================================= */
   
   function speakAssistantReply(text) {
   
     if (
       !text
       ||
       typeof window.speechSynthesis ===
         "undefined"
     ) {
   
       return;
   
     }
   
   
     /*
       Stop any older AI response that may still be speaking.
     */
     window.speechSynthesis.cancel();
   
   
     const utterance =
       new SpeechSynthesisUtterance(
         text
       );
   
   
     utterance.lang =
       "en-IN";
   
   
     utterance.rate =
       1;
   
   
     utterance.pitch =
       1;
   
   
     window.speechSynthesis.speak(
       utterance
     );
   
   }