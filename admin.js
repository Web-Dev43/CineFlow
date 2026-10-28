import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const config = window.CINEFLOW_CONFIG || {};
const configured = config.supabaseUrl && config.supabasePublishableKey &&
  !config.supabaseUrl.includes("YOUR_PROJECT_REF") &&
  !config.supabasePublishableKey.includes("YOUR_SUPABASE");
const supabase = configured ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null;

const loginSection = document.querySelector("#login-section");
const dashboardSection = document.querySelector("#dashboard-section");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const bookingList = document.querySelector("#booking-list");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarHeading = document.querySelector("#calendar-heading");
const calendarDayBookings = document.querySelector("#calendar-day-bookings");
const calendarSelectedLabel = document.querySelector("#calendar-selected-label");
let currentFilter = "pending";
let bookings = [];
const today = new Date();
const calendarStart = new Date(today.getFullYear(), today.getMonth(), 1);
const calendarEnd = new Date(today.getFullYear() + 5, today.getMonth(), 1);
let calendarMonth = new Date(calendarStart);
let selectedCalendarDate = dateKey(today);

function dateKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function showMessage(element, message, error = false) {
  element.textContent = message;
  element.style.color = error ? "var(--danger)" : "var(--muted)";
}
function showPushErrorOverlay(error, context = "Save notification to Supabase") {
  const overlay = document.querySelector("#push-error-overlay");
  const details = document.querySelector("#push-error-details");
  const message = String(error?.message || error || "Unknown error");
  if (details) details.textContent = [
    "Context: " + context,
    "Error: " + message,
    "Page: " + location.href,
    "Secure context: " + String(window.isSecureContext),
    "Notification permission: " + (window.Notification ? Notification.permission : "unsupported"),
    "Service worker supported: " + String("serviceWorker" in navigator),
    "PushManager supported: " + String("PushManager" in window),
    "Supabase configured: " + String(Boolean(supabase)),
    "Time: " + new Date().toISOString()
  ].join("\\n");
  const title = document.querySelector("#push-error-title");
  if (title) title.textContent = context + " failed";
  if (overlay) overlay.hidden = false;
  else window.alert(context + ": " + message);
}
function hidePushErrorOverlay() {
  const overlay = document.querySelector("#push-error-overlay");
  if (overlay) overlay.hidden = true;
}
function pushMessage(message, error = false) {
  const node = document.querySelector("#push-message");
  if (node) {
    node.textContent = message;
    node.style.color = error ? "var(--danger)" : "var(--muted)";
  }
}
const pushUrl = config.supabaseUrl ? config.supabaseUrl + "/functions/v1/cineflow-push" : "";
const emailUrl = config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/cineflow-email" : "";
function decodePublicKey(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
async function callPush(payload, needsAdmin = false) {
  const headers = { "Content-Type": "application/json", "apikey": config.supabasePublishableKey };
  if (needsAdmin) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    headers.Authorization = "Bearer " + token;
  }
  const response = await fetch(pushUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Push notification request failed.");
  return result;
}

async function callEmail(payload, needsAdmin = false) {
  const headers = { "Content-Type": "application/json", "apikey": config.supabasePublishableKey };
  if (needsAdmin) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    headers.Authorization = "Bearer " + token;
  }
  const response = await fetch(emailUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Email notification request failed.");
  return result;
}

async function ensurePushServiceWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("Push notifications aren't supported in this browser.");
  }
  if (!window.isSecureContext) throw new Error("Notifications require a secure HTTPS connection.");
  // The admin page must register the worker itself; serviceWorker.ready can wait forever otherwise.
  await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) throw new Error("This browser doesn't support push notifications for this site.");
  return registration;
}
async function enableAdminPush() {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!config.vapidPublicKey || config.vapidPublicKey.includes("PASTE_VAPID")) {
    throw new Error("Add the VAPID public key to config.js first.");
  }
  // On iPhone/iPad, Web Push requires the website to be added to the Home Screen and opened as an app.
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isAppleMobile && !isStandalone) {
    throw new Error("On iPhone/iPad, first use Share → Add to Home Screen, open CineFlow from its new Home Screen icon, sign in, then enable alerts there.");
  }
  const registration = await ensurePushServiceWorker();
  let permission = Notification.permission;
  if (permission !== "granted") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for CineFlow. Allow them in your device/browser settings, then try again."
      : "Notification permission wasn't granted. Tap Enable booking alerts and allow the browser prompt.");
  }
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePublicKey(config.vapidPublicKey)
    });
  }
  // Persist on the server every time, even if the browser already had a local subscription.
  await callPush({ action: "subscribe-admin", subscription: subscription.toJSON() }, true);
  return "Booking alerts are enabled and saved on this device.";
}
async function refreshPushStatus() {
  const node = document.querySelector("#push-message");
  const button = document.querySelector("#enable-push");
  const buttonLabel = button?.querySelector("span");
  const setEnabledVisual = enabled => {
    if (buttonLabel) buttonLabel.textContent = enabled ? "Booking alerts enabled ✓" : "Enable booking alerts";
    if (button) button.setAttribute("aria-label", enabled ? "Booking alerts enabled on this device" : "Enable booking alerts");
  };
  setEnabledVisual(false);
  if (!node || !supabase) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushMessage("Push notifications aren't supported in this browser.", true);
    return;
  }
  if (Notification.permission === "denied") {
    pushMessage("Notifications are blocked in device/browser settings. Allow them there, then refresh this page.", true);
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("./");
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription && Notification.permission === "granted") {
      // Re-sync the browser's existing subscription to Supabase on each admin load.
      // A local subscription alone does not prove the server has a usable endpoint.
      try {
        await callPush({ action: "subscribe-admin", subscription: subscription.toJSON() }, true);
        setEnabledVisual(true);
        pushMessage("Booking alerts are enabled and the device subscription has been synced to CineFlow.");
      } catch (error) {
        setEnabledVisual(false);
        pushMessage(error.message || "This device's alert subscription could not be synced. Please try enabling alerts again.", true);
      }
    } else if (Notification.permission === "granted") {
      pushMessage("Permission is allowed, but booking alerts aren't fully set up yet. Tap Enable booking alerts.");
    } else {
      pushMessage("Booking alerts are off on this device. Tap Enable booking alerts to set them up.");
    }
  } catch {
    setEnabledVisual(false);
    pushMessage("Booking alerts aren't fully set up yet. Tap Enable booking alerts.");
  }
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function niceDate(value) {
  if (!value) return "Date not specified";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {dateStyle:"medium"}).format(date);
}
function niceTime(value) {
  if (!value) return "Time not specified";
  const match = String(value).match(/^(\d{2}):(\d{2})/);
  if (!match) return value;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return new Intl.DateTimeFormat(undefined, {hour:"numeric", minute:"2-digit"}).format(date);
}
function showSignedIn(user) {
  loginSection.hidden = Boolean(user);
  dashboardSection.hidden = !user;
  if (user) {
    document.querySelector("#signed-in-label").textContent = user.email || "Signed in";
    loadBookings();
  }
}
async function loadBookings() {
  if (!supabase) return;
  bookingList.innerHTML = '<div class="empty-state">Loading booking requests…</div>';
  const { data, error } = await supabase.from("bookings").select("*").order("created_at", {ascending:false});
  if (error) {
    bookings = [];
    bookingList.innerHTML = "";
    showMessage(dashboardMessage, "Couldn't load requests. Confirm this account is listed as a CineFlow admin in Supabase.", true);
    renderCalendar();
    return;
  }
  bookings = data || [];
  showMessage(dashboardMessage, bookings.length ? bookings.length + " booking" + (bookings.length === 1 ? "" : "s") + " total. New requests start as Accepted." : "No bookings yet. New client requests will appear here.");
  renderBookings();
  renderCalendar();
}
function renderBookings() {
  const visible = bookings.filter(item => item.status === currentFilter);
  if (!visible.length) {
    bookingList.innerHTML = '<div class="empty-state">No ' + escapeHtml(currentFilter) + ' bookings right now.</div>';
    return;
  }
  bookingList.innerHTML = visible.map(item => {
    const status = ["pending","read","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    const details = [
      "Event / project: " + (item.event_name || "Unnamed project"),
      "Preferred date: " + niceDate(item.requested_date),
      "Start time: " + niceTime(item.requested_time),
      "Location: " + (item.location || "Not provided"),
      "Budget: " + (item.budget_range || "Not provided"),
      "Phone: " + (item.client_phone || "Not provided"),
      "Referral: " + (item.referral_source || "Not provided"),
      ...(status === "declined" && item.decline_reason ? ["Decline reason: " + item.decline_reason] : [])
    ].join("\n");
    const paymentStatus = ["not_requested","awaiting_payment","awaiting_verification","paid_verified","refunded","disputed"].includes(item.payment_status) ? item.payment_status : "not_requested";
    const paymentLabels = {not_requested:"Not requested",awaiting_payment:"Awaiting payment",awaiting_verification:"Awaiting verification",paid_verified:"Payment verified",refunded:"Refunded",disputed:"Disputed"};
    const paymentPanel = status === "approved" ? '<div class="payment-admin-panel"><strong>Payment & customer protection</strong><p>Agreed price: ' + (item.agreed_price == null ? 'Not set' : '$' + Number(item.agreed_price).toFixed(2)) + '</p><p>Payment status: <span class="status-pill">' + escapeHtml(paymentLabels[paymentStatus]) + '</span></p><div class="booking-actions"><button data-action="set-price" data-id="' + escapeHtml(item.id) + '">Set / update price</button>' + (item.agreed_price != null ? '<button data-action="payment-message" data-id="' + escapeHtml(item.id) + '">Prepare customer payment message</button>' : '') + (paymentStatus === "awaiting_payment" ? '<button data-action="payment-awaiting-verification" data-id="' + escapeHtml(item.id) + '">Customer says paid</button>' : '') + (paymentStatus === "awaiting_verification" ? '<button class="approve" data-action="payment-paid-verified" data-id="' + escapeHtml(item.id) + '">Verify payment</button>' : '') + '</div><small>Only mark payment verified after checking the transaction directly in Cash App. A screenshot alone is not proof.</small></div>' : "";
    const buttons = status === "pending"
      ? '<button class="approve" data-action="read" data-id="' + escapeHtml(item.id) + '">Read</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
      : status === "read"
        ? '<button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button><button data-action="approved" data-id="' + escapeHtml(item.id) + '">Accept & set price</button>'
        : status === "approved"
          ? '<button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button><button data-action="cancelled" data-id="' + escapeHtml(item.id) + '">Cancel booking</button>'
          : '<button data-action="approved" data-id="' + escapeHtml(item.id) + '">Mark as accepted & set price</button>';
    return '<article class="booking-card"><div class="booking-card-top"><div><h3>' + escapeHtml(item.client_name) + ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml(item.service) + '</span></h3><div class="booking-meta">' + escapeHtml(item.client_email) + '<br>Received ' + escapeHtml(new Date(item.created_at).toLocaleString()) + '</div></div><span class="status-pill ' + status + '">' + escapeHtml(status === "approved" ? "accepted" : status) + '</span></div><div class="booking-details">' + escapeHtml(details) + "\\n\\n" + escapeHtml(item.project_details) + '</div>' + paymentPanel + '<div class="booking-actions">' + buttons + '</div></article>';
  }).join("");
}
function renderCalendar() {
  if (!calendarGrid) return;
  calendarHeading.textContent = new Intl.DateTimeFormat(undefined, {month:"long", year:"numeric"}).format(calendarMonth);
  const previous = document.querySelector("#calendar-previous");
  const next = document.querySelector("#calendar-next");
  previous.disabled = calendarMonth <= calendarStart;
  next.disabled = calendarMonth >= calendarEnd;
  previous.setAttribute("aria-label", "Previous month");
  next.setAttribute("aria-label", "Next month");

  const firstWeekday = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<div class="calendar-cell calendar-blank" aria-hidden="true"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    const key = dateKey(date);
    const onDate = bookings.filter(item => item.status === "approved" && item.requested_date === key);
    const labels = onDate.slice(0, 2).map(item => {
      const label = (item.event_name || item.service || "Project") + (item.requested_time ? " · " + niceTime(item.requested_time) : "");
      return '<span class="calendar-event-label" title="' + escapeHtml(label) + '"><span aria-hidden="true">🎬</span><span>' + escapeHtml(label) + '</span></span>';
    }).join("") + (onDate.length > 2 ? '<span class="calendar-extra">+' + (onDate.length - 2) + ' more</span>' : "");
    const classes = ["calendar-cell","calendar-day",key === selectedCalendarDate ? "selected" : "",key === dateKey(today) ? "today" : ""].filter(Boolean).join(" ");
    cells.push('<button type="button" class="' + classes + '" data-calendar-date="' + key + '" aria-label="' + escapeHtml(new Intl.DateTimeFormat(undefined,{dateStyle:"full"}).format(date)) + (onDate.length ? ", " + onDate.length + " booking(s)" : "") + '"><span class="calendar-number">' + day + '</span><span class="calendar-events">' + labels + '</span></button>');
  }
  calendarGrid.innerHTML = cells.join("");
  renderCalendarDay();
}
function renderCalendarDay() {
  const date = new Date(selectedCalendarDate + "T12:00:00");
  calendarSelectedLabel.textContent = new Intl.DateTimeFormat(undefined,{dateStyle:"full"}).format(date);
  const dayBookings = bookings.filter(item => item.status === "approved" && item.requested_date === selectedCalendarDate)
    .sort((a,b) => (a.created_at || "").localeCompare(b.created_at || ""));
  if (!dayBookings.length) {
    calendarDayBookings.innerHTML = '<div class="empty-state">No bookings for this date.</div>';
    return;
  }
  calendarDayBookings.innerHTML = dayBookings.map(item => {
    const status = ["pending","read","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    return '<article class="calendar-booking"><div><strong>' + escapeHtml(item.event_name || item.service || "Project") + '</strong><span>' + escapeHtml(item.service) + ' · ' + escapeHtml(niceTime(item.requested_time)) + '</span></div><span class="status-pill ' + status + '">' + escapeHtml(status === "approved" ? "accepted" : status) + '</span><p>' + escapeHtml(item.client_name) + ' · ' + escapeHtml(item.client_email) + '</p><p>Where: ' + escapeHtml(item.location || "Not provided") + '</p>' + (status === "declined" && item.decline_reason ? '<p class="decline-reason"><strong>Decline reason:</strong> ' + escapeHtml(item.decline_reason) + '</p>' : '') + '</article>';
  }).join("");
}
document.querySelector("#calendar-previous").addEventListener("click", () => {
  const target = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  if (target >= calendarStart) { calendarMonth = target; selectedCalendarDate = dateKey(target); renderCalendar(); }
});
document.querySelector("#calendar-next").addEventListener("click", () => {
  const target = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  if (target <= calendarEnd) { calendarMonth = target; selectedCalendarDate = dateKey(target); renderCalendar(); }
});
calendarGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-calendar-date]");
  if (!button) return;
  selectedCalendarDate = button.dataset.calendarDate;
  renderCalendar();
});
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) {
    showMessage(loginMessage, "Supabase isn't configured yet. Follow the setup steps in README.md first.", true);
    return;
  }
  const button = loginForm.querySelector('button[type="submit"]');
  const values = new FormData(loginForm);
  button.disabled = true;
  showMessage(loginMessage, "Signing in…");
  try {
    const {error} = await supabase.auth.signInWithPassword({email:String(values.get("email")).trim(),password:String(values.get("password"))});
    if (error) throw error;
    loginForm.reset();
    showMessage(loginMessage, "");
  } catch (error) {
    showMessage(loginMessage, error.message || "Sign in failed.", true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#sign-out").addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
  showSignedIn(null);
});
document.querySelector("#refresh-bookings").addEventListener("click", loadBookings);
const enablePushButton = document.querySelector("#enable-push");
if (enablePushButton) {
  enablePushButton.addEventListener("click", async () => {
    enablePushButton.disabled = true;
    pushMessage("Setting up booking alerts…");
    try {
      pushMessage(await enableAdminPush());
      const enabledLabel = enablePushButton.querySelector("span");
      if (enabledLabel) enabledLabel.textContent = "Booking alerts enabled ✓";
      enablePushButton.setAttribute("aria-label", "Booking alerts enabled on this device");
    } catch (error) {
      pushMessage(error.message || "Could not enable notifications.", true);
      showPushErrorOverlay(error, "Save notification to Supabase");
    } finally {
      enablePushButton.disabled = false;
    }
  });
  // Keep the message in sync when returning to the admin dashboard.
  refreshPushStatus();
}
document.querySelector("#filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  currentFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderBookings();
});
bookingList.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button || !supabase) return;
  const id = button.dataset.id;
  const status = button.dataset.action;
  const selectedBooking = bookings.find(item => item.id === id);
  if (!selectedBooking) return;
  if (status === "set-price" || status === "approved") {
    const entered = window.prompt("Enter the exact agreed price in USD before asking the customer to pay:", selectedBooking.agreed_price == null ? "" : Number(selectedBooking.agreed_price).toFixed(2));
    if (entered === null) return;
    const price = Number(entered.trim());
    if (!entered.trim() || !Number.isFinite(price) || price < 0 || !/^\\d+(?:\\.\\d{1,2})?$/.test(entered.trim())) {
      window.alert("Enter a valid price, such as 125 or 125.50. No changes were made.");
      return;
    }
    if (status === "approved") {
      const conflict = bookings.find(item => item.id !== id && item.status === "approved" && item.requested_date === selectedBooking.requested_date);
      if (conflict && !window.confirm("Another accepted booking has the same requested date. Accept this request anyway?")) return;
    }
    button.disabled = true;
    try {
      const update = status === "approved"
        ? {status:"approved", agreed_price:price, payment_status:"awaiting_payment", decline_reason:null}
        : {agreed_price:price, payment_status:selectedBooking.payment_status === "not_requested" ? "awaiting_payment" : selectedBooking.payment_status};
      const {error} = await supabase.from("bookings").update(update).eq("id", id);
      if (error) throw error;
      if (status === "approved") {
        try { await callEmail({action:"booking-status",bookingId:id}, true); } catch (emailError) { console.warn("Status email could not be confirmed:",emailError); }
      }
      showMessage(dashboardMessage, "Saved the exact price. Payment is awaiting customer payment; no automatic payment was processed.");
      await loadBookings();
    } catch (error) {
      showMessage(dashboardMessage, "Couldn't save the price. Check the admin permissions and try again.", true);
      button.disabled = false;
    }
    return;
  }
  if (status === "payment-message") {
    if (selectedBooking.agreed_price == null) { window.alert("Set the agreed price first."); return; }
    const message = "Hi " + selectedBooking.client_name + ", your CineFlow booking is accepted.\\n\\nService: " + selectedBooking.service + "\\nProject: " + selectedBooking.event_name + "\\nDate: " + niceDate(selectedBooking.requested_date) + (selectedBooking.requested_time ? "\\nTime: " + niceTime(selectedBooking.requested_time) : "") + "\\nAgreed total: $" + Number(selectedBooking.agreed_price).toFixed(2) + "\\n\\nIf you choose to pay via Cash App, use https://cash.app/$kejh17 and pay the exact agreed amount. Please only pay after checking these details. Payment is not marked verified until it is checked directly in Cash App. Keep your receipt. For cancellations, refunds, or rescheduling, contact us before paying so the terms can be agreed in writing.\\n\\nReply to this email if anything is incorrect.";
    window.location.href = "mailto:" + encodeURIComponent(selectedBooking.client_email) + "?subject=" + encodeURIComponent("CineFlow booking details and payment") + "&body=" + encodeURIComponent(message);
    return;
  }
  if (status === "payment-awaiting-verification" || status === "payment-paid-verified") {
    const next = status === "payment-awaiting-verification" ? "awaiting_verification" : "paid_verified";
    const promptText = next === "paid_verified" ? "Confirm you checked the transaction directly in Cash App and verified the amount and sender." : "Only use this after the customer says they sent payment. You'll still need to check Cash App before verifying.";
    if (!window.confirm(promptText)) return;
    button.disabled = true;
    try {
      const {error} = await supabase.from("bookings").update({payment_status:next}).eq("id",id);
      if (error) throw error;
      showMessage(dashboardMessage, next === "paid_verified" ? "Payment marked verified. Keep the transaction record with the booking." : "Marked as awaiting verification. This does not mean payment has been received.");
      await loadBookings();
    } catch (error) {
      showMessage(dashboardMessage, "Couldn't update payment status. Check admin permissions and try again.", true);
      button.disabled = false;
    }
    return;
  }
  if (status === "declined") {
    if (!selectedBooking) return;
    window.alert("(Recommended) Email " + selectedBooking.client_email + " to let them know you declined (sorry i couldn't automatically do it, it cost money -Team of Developers: Yuan)");
  }
  button.disabled = true;
  try {
    const update = {status, decline_reason: null};
    const {error} = await supabase.from("bookings").update(update).eq("id", id);
    if (error) throw error;
    let emailWarning = "";
    if (status !== "read") {
      try {
        const emailResult = await callEmail({ action: "booking-status", bookingId: id }, true);
        if (!emailResult.ok || Number(emailResult.sent) < 1) {
          console.warn("CineFlow status email could not be confirmed:", emailResult);
          emailWarning = " The admin email alert could not be confirmed; check the email setup.";
        }
      } catch (emailError) {
        console.warn("CineFlow status email request failed:", emailError);
        emailWarning = " The admin email alert could not be confirmed; check the email setup.";
      }
    }
    showMessage(dashboardMessage, (status === "declined" ? "Booking declined. Remember to email the client yourself." : status === "read" ? "Booking marked as read and moved to Already read. No client email was sent." : "Booking updated and moved to the " + status + " tab.") + emailWarning, Boolean(emailWarning));
    await loadBookings();
  } catch (error) {
    showMessage(dashboardMessage, "Couldn't update this booking. Check admin permissions and try again.", true);
    button.disabled = false;
  }
});

if (!supabase) {
  showMessage(loginMessage, "Setup required: add the Supabase project URL and publishable key in config.js, then apply supabase/schema.sql.", true);
} else {
  supabase.auth.getSession().then(({data}) => showSignedIn(data.session?.user || null));
  supabase.auth.onAuthStateChange((_event, session) => showSignedIn(session?.user || null));
}
document.querySelector("#push-error-close")?.addEventListener("click", hidePushErrorOverlay);
document.querySelector("#push-error-retry")?.addEventListener("click", () => {
  hidePushErrorOverlay();
  enablePushButton?.click();
});
document.querySelector("#push-error-copy")?.addEventListener("click", async () => {
  const details = document.querySelector("#push-error-details")?.textContent || "";
  try {
    await navigator.clipboard.writeText(details);
    document.querySelector("#push-error-copy").textContent = "Copied diagnostics ✓";
  } catch {
    pushMessage("Copy was blocked. Select and copy the diagnostic text manually.", true);
  }
});
document.querySelector("#push-error-overlay")?.addEventListener("click", event => {
  if (event.target.id === "push-error-overlay") hidePushErrorOverlay();
});
