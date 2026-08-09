/* =================================================================
   NEXATEL INTERNAL SUPPORT CONSOLE
   =================================================================

   CUSTOMER SIDE:
   - Customer can only CREATE a support request.

   AGENT SIDE:
   - Agent can read the queue.
   - Agent can move a ticket to "reviewing".
   - Agent can initiate the Twilio callback.
   - Agent can resolve a ticket.

   FINAL BACKEND CONTRACT:
   -----------------------------------------------------------------
   GET   /support/requests
   GET   /support/requests/{ticket_id}
   PATCH /support/requests/{ticket_id}
   POST  /support/requests/{ticket_id}/call

   IMPORTANT:
   There are intentionally NO /review or /close endpoints.
   Status changes use PATCH so this frontend exactly matches main.py.
   ================================================================= */


   const API_BASE_URL =
   "http://127.0.0.1:8000";
 
 
 const API = {
 
   tickets:
     `${API_BASE_URL}/support/requests`
 
 };
 
 
 const state = {
 
   tickets: [],
 
   selectedTicketId: null,
 
   filter: "all"
 
 };
 
 
 const $ =
   (id) =>
     document.getElementById(id);
 
 
 /* =================================================================
    STARTUP
    ================================================================= */
 
 document.addEventListener(
   "DOMContentLoaded",
   () => {
 
     $("refreshButton")
       ?.addEventListener(
         "click",
         loadTickets
       );
 
 
     $("markReviewedButton")
       ?.addEventListener(
         "click",
         markReviewing
       );
 
 
     $("callCustomerButton")
       ?.addEventListener(
         "click",
         callCustomer
       );
 
 
     $("closeTicketButton")
       ?.addEventListener(
         "click",
         resolveTicket
       );
 
 
     /*
       Queue filters.
 
       Values exactly match backend:
       waiting / reviewing / resolved.
     */
 
     document
       .querySelectorAll(
         ".filter-button"
       )
       .forEach(
         (button) => {
 
           button.addEventListener(
             "click",
             () => {
 
               state.filter =
                 button.dataset.status;
 
 
               document
                 .querySelectorAll(
                   ".filter-button"
                 )
                 .forEach(
                   (item) =>
                     item.classList.remove(
                       "active"
                     )
                 );
 
 
               button.classList.add(
                 "active"
               );
 
 
               renderTicketList();
 
             }
           );
 
         }
       );
 
 
     /*
       If the admin key is changed,
       reload immediately.
     */
 
     $("adminKeyInput")
       ?.addEventListener(
         "change",
         loadTickets
       );
 
 
     loadTickets();
 
   }
 );
 
 
 /* =================================================================
    ADMIN HEADERS
    ================================================================= */
 
 function adminHeaders(
   includeJson = false
 ) {
 
   const headers = {};
 
 
   const key =
     $("adminKeyInput")
       ?.value
       .trim();
 
 
   if (key) {
 
     headers["X-Admin-Key"] =
       key;
 
   }
 
 
   if (includeJson) {
 
     headers["Content-Type"] =
       "application/json";
 
   }
 
 
   return headers;
 
 }
 
 
 /* =================================================================
    LOAD SUPPORT QUEUE
    ================================================================= */
 
 async function loadTickets() {
 
   setRefreshLoading(
     true
   );
 
 
   try {
 
     const response =
       await fetch(
         API.tickets,
         {
           headers:
             adminHeaders()
         }
       );
 
 
     const data =
       await readJson(
         response
       );
 
 
     if (!response.ok) {
 
       throw new Error(
         extractError(
           data,
           "Unable to load the support queue."
         )
       );
 
     }
 
 
     state.tickets =
       Array.isArray(
         data.requests
       )
         ? data.requests
         : [];
 
 
     /*
       Backend already inserts newest first,
       but sorting here makes the UI resilient.
     */
 
     state.tickets.sort(
       (a, b) =>
         new Date(
           b.created_at || 0
         )
         -
         new Date(
           a.created_at || 0
         )
     );
 
 
     if ($("ticketCount")) {
 
       $("ticketCount")
         .textContent =
           String(
             state.tickets.length
           );
 
     }
 
 
     /*
       If selected ticket disappeared,
       clear selection.
     */
 
     if (
       state.selectedTicketId
       &&
       !state.tickets.some(
         (ticket) =>
           ticket.ticket_id ===
           state.selectedTicketId
       )
     ) {
 
       state.selectedTicketId =
         null;
 
     }
 
 
     renderTicketList();
 
     renderSelectedTicket();
 
 
   } catch (error) {
 
     console.error(
       "Support queue load failed:",
       error
     );
 
 
     showToast(
       error.message
       ||
       "Unable to load the support queue.",
       "error"
     );
 
 
   } finally {
 
     setRefreshLoading(
       false
     );
 
   }
 
 }
 
 
 /* =================================================================
    RENDER QUEUE
    ================================================================= */
 
 function renderTicketList() {
 
   const list =
     $("ticketList");
 
 
   if (!list) {
     return;
   }
 
 
   list.innerHTML =
     "";
 
 
   const visibleTickets =
     state.filter === "all"
 
       ? state.tickets
 
       : state.tickets.filter(
           (ticket) =>
             normalizeStatus(
               ticket.status
             )
             ===
             state.filter
         );
 
 
   $("emptyQueue")
     ?.classList
     .toggle(
       "hidden",
       visibleTickets.length > 0
     );
 
 
   visibleTickets.forEach(
     (ticket) => {
 
       const button =
         document.createElement(
           "button"
         );
 
 
       button.type =
         "button";
 
 
       button.className =
         "ticket-item";
 
 
       if (
         ticket.ticket_id ===
         state.selectedTicketId
       ) {
 
         button.classList.add(
           "active"
         );
 
       }
 
 
       const status =
         normalizeStatus(
           ticket.status
         );
 
 
       button.innerHTML = `
 
         <div class="ticket-item-top">
 
           <strong>
             ${escapeHtml(
               ticket.ticket_id
             )}
           </strong>
 
           <small>
             ${escapeHtml(
               prettyStatus(
                 status
               )
             )}
           </small>
 
         </div>
 
 
         <div class="ticket-reason">
           ${escapeHtml(
             ticket.reason
             ||
             "No issue description provided."
           )}
         </div>
 
       `;
 
 
       button.addEventListener(
         "click",
         () => {
 
           state.selectedTicketId =
             ticket.ticket_id;
 
 
           renderTicketList();
 
           renderSelectedTicket();
 
         }
       );
 
 
       list.appendChild(
         button
       );
 
     }
   );
 
 }
 
 
 /* =================================================================
    SELECTED TICKET
    ================================================================= */
 
 function selectedTicket() {
 
   return state.tickets.find(
     (ticket) =>
       ticket.ticket_id ===
       state.selectedTicketId
   );
 
 }
 
 
 /* =================================================================
    RENDER SELECTED TICKET
    ================================================================= */
 
 function renderSelectedTicket() {
 
   const ticket =
     selectedTicket();
 
 
   if (!ticket) {
 
     $("ticketDetail")
       ?.classList
       .add("hidden");
 
 
     $("emptyDetail")
       ?.classList
       .remove("hidden");
 
 
     return;
 
   }
 
 
   $("emptyDetail")
     ?.classList
     .add("hidden");
 
 
   $("ticketDetail")
     ?.classList
     .remove("hidden");
 
 
   const status =
     normalizeStatus(
       ticket.status
     );
 
 
   /* ---------------------------------------------------------------
      Main ticket information
      --------------------------------------------------------------- */
 
   setText(
     "detailTicketId",
     ticket.ticket_id
     ||
     "Unknown ticket"
   );
 
 
   setText(
     "detailStatus",
     prettyStatus(
       status
     )
   );
 
 
   setText(
     "detailPriority",
     ticket.priority
     ||
     "normal"
   );
 
 
   setText(
     "detailCreatedAt",
     formatDate(
       ticket.created_at
     )
   );
 
 
   /*
     IMPORTANT:
 
     The final main.py stores customer details FLAT:
 
     customer_name
     customer_email
     customer_phone
 
     It does NOT store:
 
     ticket.customer.name
   */
 
   setText(
     "detailCustomerName",
     ticket.customer_name
     ||
     "Customer"
   );
 
 
   setText(
     "detailCustomerEmail",
     ticket.customer_email
     ||
     "—"
   );
 
 
   setText(
     "detailCustomerPhone",
     ticket.customer_phone
     ||
     "—"
   );
 
 
   setText(
     "detailPreference",
     prettyPreference(
       ticket.contact_preference
     )
   );
 
 
   setText(
     "detailReason",
     ticket.reason
     ||
     "—"
   );
 
 
   /* ---------------------------------------------------------------
      Status badge styling
      --------------------------------------------------------------- */
 
   const badge =
     $("detailStatus");
 
 
   if (badge) {
 
     badge.classList.remove(
       "status-waiting",
       "status-reviewing",
       "status-resolved"
     );
 
 
     badge.classList.add(
       `status-${status}`
     );
 
   }
 
 
   /* ---------------------------------------------------------------
      Transcript
      --------------------------------------------------------------- */
 
   const transcript =
     $("detailConversation");
 
 
   if (transcript) {
 
     transcript.innerHTML =
       "";
 
 
     const messages =
       Array.isArray(
         ticket.conversation
       )
         ? ticket.conversation
         : [];
 
 
     if (
       messages.length === 0
     ) {
 
       const empty =
         document.createElement(
           "div"
         );
 
 
       empty.className =
         "transcript-item assistant";
 
 
       empty.textContent =
         "No conversation transcript was attached to this request.";
 
 
       transcript.appendChild(
         empty
       );
 
 
     } else {
 
       messages.forEach(
         (message) => {
 
           const item =
             document.createElement(
               "div"
             );
 
 
           item.className =
             `transcript-item ${
               message.role === "user"
                 ? "user"
                 : "assistant"
             }`;
 
 
           item.textContent =
             message.content
             ||
             "";
 
 
           transcript.appendChild(
             item
           );
 
         }
       );
 
     }
 
   }
 
 
   /* ---------------------------------------------------------------
      Action availability
      --------------------------------------------------------------- */
 
   const phone =
     String(
       ticket.customer_phone
       ||
       ""
     ).trim();
 
 
   const isResolved =
     status ===
     "resolved";
 
 
   const callbackRequested =
     String(
       ticket.contact_preference
       ||
       ""
     )
       .toLowerCase()
     ===
     "callback";
 
 
   /*
     Once reviewing, no need to mark reviewing again.
   */
 
   if ($("markReviewedButton")) {
 
     $("markReviewedButton")
       .disabled =
         status === "reviewing"
         ||
         isResolved;
 
   }
 
 
   /*
     Call button is available only if:
 
     - customer supplied a phone
     - customer requested callback
     - ticket is not resolved
   */
 
   if ($("callCustomerButton")) {
 
     $("callCustomerButton")
       .disabled =
         !phone
         ||
         !callbackRequested
         ||
         isResolved;
 
   }
 
 
   if ($("closeTicketButton")) {
 
     $("closeTicketButton")
       .disabled =
         isResolved;
 
   }
 
 }
 
 
 /* =================================================================
    MARK TICKET AS REVIEWING
    ================================================================= */
 
 async function markReviewing() {
 
   const ticket =
     selectedTicket();
 
 
   if (!ticket) {
     return;
   }
 
 
   await updateTicketStatus(
     ticket.ticket_id,
     "reviewing",
     "Ticket moved to reviewing."
   );
 
 }
 
 
 /* =================================================================
    RESOLVE TICKET
    ================================================================= */
 
 async function resolveTicket() {
 
   const ticket =
     selectedTicket();
 
 
   if (!ticket) {
     return;
   }
 
 
   const confirmed =
     window.confirm(
       `Resolve ${ticket.ticket_id}?\n\n`
       +
       'The ticket will remain in history with status "resolved".'
     );
 
 
   if (!confirmed) {
     return;
   }
 
 
   await updateTicketStatus(
     ticket.ticket_id,
     "resolved",
     "Ticket resolved."
   );
 
 }
 
 
 /* =================================================================
    PATCH STATUS
    ================================================================= */
 
 async function updateTicketStatus(
   ticketId,
   status,
   successMessage
 ) {
 
   try {
 
     const response =
       await fetch(
         `${API.tickets}/${encodeURIComponent(
           ticketId
         )}`,
         {
 
           method:
             "PATCH",
 
           headers:
             adminHeaders(
               true
             ),
 
           body:
             JSON.stringify({
               status
             })
 
         }
       );
 
 
     const data =
       await readJson(
         response
       );
 
 
     if (!response.ok) {
 
       throw new Error(
         extractError(
           data,
           "The ticket could not be updated."
         )
       );
 
     }
 
 
     showToast(
       successMessage,
       "success"
     );
 
 
     await loadTickets();
 
 
   } catch (error) {
 
     console.error(
       "Ticket update failed:",
       error
     );
 
 
     showToast(
       error.message
       ||
       "The ticket could not be updated.",
       "error"
     );
 
   }
 
 }
 
 
 /* =================================================================
    AGENT-FIRST TWILIO CALLBACK
    ================================================================= */
 
 async function callCustomer() {
 
   const ticket =
     selectedTicket();
 
 
   if (!ticket) {
     return;
   }
 
 
   /*
     Backend performs additional safety checks:
 
     - ticket exists
     - ticket isn't resolved
     - preference is callback
     - customer phone is valid
     - Twilio is configured
   */
 
   const confirmed =
     window.confirm(
 
       `Start callback for ${ticket.ticket_id}?\n\n`
 
       +
 
       "Twilio will call the configured support agent FIRST. "
 
       +
 
       "After the agent answers, Twilio will dial and bridge the customer."
 
     );
 
 
   if (!confirmed) {
     return;
   }
 
 
   setActionLoading(
     $("callCustomerButton"),
     true,
     "Starting call..."
   );
 
 
   try {
 
     const response =
       await fetch(
         `${API.tickets}/${encodeURIComponent(
           ticket.ticket_id
         )}/call`,
         {
 
           method:
             "POST",
 
           headers:
             adminHeaders()
 
         }
       );
 
 
     const data =
       await readJson(
         response
       );
 
 
     if (!response.ok) {
 
       throw new Error(
         extractError(
           data,
           "The callback could not be started."
         )
       );
 
     }
 
 
     showToast(
       "Callback started. Twilio is calling the support agent first.",
       "success"
     );
 
 
     await loadTickets();
 
 
   } catch (error) {
 
     console.error(
       "Callback failed:",
       error
     );
 
 
     showToast(
       error.message
       ||
       "The callback could not be started.",
       "error"
     );
 
 
   } finally {
 
     setActionLoading(
       $("callCustomerButton"),
       false,
       "☎ Call customer"
     );
 
   }
 
 }
 
 
 /* =================================================================
    JSON RESPONSE HELPER
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
 
     return {
       detail:
         text
     };
 
   }
 
 }
 
 
 /* =================================================================
    ERROR HELPER
    ================================================================= */
 
 function extractError(
   data,
   fallback
 ) {
 
   const value =
     data?.detail
     ||
     data?.message
     ||
     data?.error;
 
 
   return typeof value ===
     "string"
 
     ? value
 
     : fallback;
 
 }
 
 
 /* =================================================================
    NORMALIZE BACKEND STATUS
    ================================================================= */
 
 function normalizeStatus(status) {
 
   const value =
     String(
       status
       ||
       "waiting"
     )
       .trim()
       .toLowerCase();
 
 
   /*
     Compatibility aliases.
 
     Current backend uses:
     waiting
     reviewing
     resolved
   */
 
   const aliases = {
 
     open:
       "waiting",
 
     pending:
       "waiting",
 
     pending_review:
       "waiting",
 
     new:
       "waiting",
 
     reviewed:
       "reviewing",
 
     under_review:
       "reviewing",
 
     in_progress:
       "reviewing",
 
     closed:
       "resolved",
 
     complete:
       "resolved",
 
     completed:
       "resolved"
 
   };
 
 
   return aliases[value]
     ||
     value;
 
 }
 
 
 /* =================================================================
    HUMAN-READABLE STATUS
    ================================================================= */
 
 function prettyStatus(status) {
 
   const map = {
 
     waiting:
       "Waiting",
 
     reviewing:
       "Reviewing",
 
     resolved:
       "Resolved"
 
   };
 
 
   return (
     map[
       normalizeStatus(
         status
       )
     ]
     ||
     status
     ||
     "Unknown"
   );
 
 }
 
 
 /* =================================================================
    HUMAN-READABLE CONTACT PREFERENCE
    ================================================================= */
 
 function prettyPreference(preference) {
 
   const value =
     String(
       preference
       ||
       ""
     )
       .trim()
       .toLowerCase();
 
 
   if (
     value ===
     "callback"
   ) {
 
     return "Callback";
 
   }
 
 
   if (
     value ===
     "email"
   ) {
 
     return "Email";
 
   }
 
 
   return (
     preference
     ||
     "—"
   );
 
 }
 
 
 /* =================================================================
    DOM TEXT HELPER
    ================================================================= */
 
 function setText(
   id,
   value
 ) {
 
   const element =
     $(id);
 
 
   if (element) {
 
     element.textContent =
       value;
 
   }
 
 }
 
 
 /* =================================================================
    REFRESH BUTTON STATE
    ================================================================= */
 
 function setRefreshLoading(loading) {
 
   const button =
     $("refreshButton");
 
 
   if (!button) {
     return;
   }
 
 
   button.disabled =
     loading;
 
 
   button.textContent =
     loading
       ? "Refreshing..."
       : "Refresh queue";
 
 }
 
 
 /* =================================================================
    ACTION BUTTON STATE
    ================================================================= */
 
 function setActionLoading(
   button,
   loading,
   text
 ) {
 
   if (!button) {
     return;
   }
 
 
   button.disabled =
     loading;
 
 
   button.textContent =
     text;
 
 }
 
 
 /* =================================================================
    TOASTS
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
    DATE FORMAT
    ================================================================= */
 
 function formatDate(value) {
 
   if (!value) {
     return "";
   }
 
 
   try {
 
     return new Date(
       value
     )
       .toLocaleString();
 
 
   } catch {
 
     return value;
 
   }
 
 }
 
 
 /* =================================================================
    HTML ESCAPE
    ================================================================= */
 
 function escapeHtml(value) {
 
   const div =
     document.createElement(
       "div"
     );
 
 
   div.textContent =
     String(
       value
       ||
       ""
     );
 
 
   return div.innerHTML;
 
 }