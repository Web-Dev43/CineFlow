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
let bookingSearch = "";
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
  ].join("\n");
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
  updateBookingStats();
  showMessage(dashboardMessage, bookings.length ? bookings.length + " booking" + (bookings.length === 1 ? "" : "s") + " total. New requests start as pending." : "No bookings yet. New client requests will appear here.");
  renderBookings();
  renderCalendar();
}
function updateBookingStats() {
  const count = status => bookings.filter(item => item.status === status).length;
  const set = (id, value) => { const node = document.querySelector(id); if (node) node.textContent = String(value); };
  set("#stat-total", bookings.length);
  set("#stat-pending", count("pending"));
  set("#stat-approved", count("approved"));
  set("#stat-declined", count("declined"));
}
function findScheduleConflicts(booking) {
  if (!booking.requested_date) return [];
  return bookings.filter(other =>
    other.id !== booking.id &&
    other.status === "approved" &&
    other.requested_date === booking.requested_date
  ).map(other => {
    const sameKnownTime = Boolean(booking.requested_time && other.requested_time) &&
      String(booking.requested_time).slice(0, 5) === String(other.requested_time).slice(0, 5);
    const needsTimeCheck = !booking.requested_time || !other.requested_time;
    return {...other, conflictLevel: sameKnownTime ? "super-important" : "review", needsTimeCheck};
  });
}
function renderBookings() {
  const query = bookingSearch.trim().toLocaleLowerCase();
  const visible = bookings.filter(item => {
    if (item.status !== currentFilter) return false;
    if (!query) return true;
    return [item.client_name, item.client_email, item.service, item.event_name, item.location, item.project_details, item.client_phone]
      .some(value => String(value || "").toLocaleLowerCase().includes(query));
  });
  const searchCount = document.querySelector("#search-count");
  if (searchCount) searchCount.textContent = query ? visible.length + " match" + (visible.length === 1 ? "" : "es") : "";
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
    const conflicts = status === "approved" ? [] : findScheduleConflicts(item);
    const exactTimeConflicts = conflicts.filter(other => other.conflictLevel === "super-important");
    const dateReviewConflicts = conflicts.filter(other => other.conflictLevel === "review");
    const conflictNotice = exactTimeConflicts.length
      ? '<div class="booking-conflict booking-conflict-critical" role="alert"><strong>⚠ SUPER IMPORTANT — same date and time</strong><span>' +
        escapeHtml(exactTimeConflicts.length + " accepted booking" + (exactTimeConflicts.length === 1 ? "" : "s") + " already start at " + niceTime(item.requested_time) + ". Check this carefully before accepting.") +
        '</span></div>' +
        (dateReviewConflicts.length ? '<div class="booking-conflict booking-conflict-review" role="note"><strong>Important — same day, time needs review</strong><span>' +
          escapeHtml(dateReviewConflicts.length + " other accepted booking" + (dateReviewConflicts.length === 1 ? "" : "s") + " share this date but have a different or unspecified time. Review the schedule.") + '</span></div>' : "")
      : conflicts.length
        ? '<div class="booking-conflict booking-conflict-review" role="note"><strong>Important — same day, review schedule</strong><span>' +
          escapeHtml(conflicts.length + " accepted booking" + (conflicts.length === 1 ? "" : "s") + " share this date. The times differ or one is unspecified, so review the schedule before accepting.") +
          '</span></div>'
        : "";
    const buttons = status === "pending"
      ? '<button data-action="read" data-id="' + escapeHtml(item.id) + '">Mark as read</button><button class="approve" data-action="approved" data-id="' + escapeHtml(item.id) + '">Accept booking</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
      : status === "read"
        ? '<button class="approve" data-action="approved" data-id="' + escapeHtml(item.id) + '">Accept booking</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
        : status === "approved"
          ? '<button data-action="cancelled" data-id="' + escapeHtml(item.id) + '">Cancel booking</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
          : '<button class="approve" data-action="approved" data-id="' + escapeHtml(item.id) + '">Re-accept booking</button>';
    return '<article class="booking-card"><div class="booking-card-top"><div><h3>' + escapeHtml(item.client_name) + ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml(item.service) + '</span></h3><div class="booking-meta">' + escapeHtml(item.client_email) + '<br>Received ' + escapeHtml(new Date(item.created_at).toLocaleString()) + '</div></div><span class="status-pill ' + status + '">' + escapeHtml(status === "approved" ? "accepted" : status) + '</span></div>' + conflictNotice + '<div class="booking-details">' + escapeHtml(details) + "\n\nProject details:\n" + escapeHtml(item.project_details || "Not provided") + '</div>' + '<div class="booking-actions">' + buttons + '</div></article>';
  }).join("");
}
function renderCalendar() {
  if (!calendarGrid) return;
  calendarHeading.textContent = new Intl.DateTimeFormat(undefined, {month:"long", year:"numeric"}).format(calendarMonth);
  const todayButton = document.querySelector("#calendar-today");
  if (todayButton) todayButton.disabled = calendarMonth.getFullYear() === today.getFullYear() && calendarMonth.getMonth() === today.getMonth();
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
    calendarDayBookings.innerHTML = '<div class="empty-state">No accepted bookings for this date. Select a highlighted date to review scheduled work.</div>';
    return;
  }
  calendarDayBookings.innerHTML = dayBookings.map(item => {
    const status = ["pending","read","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    return '<article class="calendar-booking"><div><strong>' + escapeHtml(item.event_name || item.service || "Project") + '</strong><span>' + escapeHtml(item.service) + ' · ' + escapeHtml(niceTime(item.requested_time)) + '</span></div><span class="status-pill ' + status + '">' + escapeHtml(status === "approved" ? "accepted" : status) + '</span><p>' + escapeHtml(item.client_name) + ' · ' + escapeHtml(item.client_email) + '</p><p>Where: ' + escapeHtml(item.location || "Not provided") + '</p>' + (status === "declined" && item.decline_reason ? '<p class="decline-reason"><strong>Decline reason:</strong> ' + escapeHtml(item.decline_reason) + '</p>' : '') + '</article>';
  }).join("");
}
document.querySelector("#calendar-today")?.addEventListener("click", () => {
  calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedCalendarDate = dateKey(today);
  renderCalendar();
});
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
document.querySelector("#booking-search")?.addEventListener("input", event => {
  bookingSearch = event.target.value;
  renderBookings();
});
document.querySelector("#filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  currentFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderBookings();
});
bookingList.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button || !supabase || button.disabled) return;
  const id = button.dataset.id;
  const status = button.dataset.action;
  const selectedBooking = bookings.find(item => String(item.id) === String(id));
  if (!selectedBooking) {
    showMessage(dashboardMessage, "This booking is no longer in the current list. Refresh and try again.", true);
    return;
  }

  if (status === "declined" && !window.confirm("Decline this booking request? The status will be saved, but CineFlow will not automatically email the client about a decline.")) return;
  if (status === "cancelled" && !window.confirm("Cancel this accepted booking? The status will be saved, but you should contact the client yourself.")) return;

  if (status === "approved") {
    const conflicts = findScheduleConflicts(selectedBooking);
    if (conflicts.length) {
      const exact = conflicts.filter(item => item.conflictLevel === "super-important");
      const review = conflicts.filter(item => item.conflictLevel === "review");
      const overlap = conflicts.map(item =>
        (item.conflictLevel === "super-important" ? "[SUPER IMPORTANT: SAME TIME] " : "[IMPORTANT: SAME DAY] ") +
        (item.event_name || item.service || "Project") + " — " + niceDate(item.requested_date) + " at " + niceTime(item.requested_time)
      ).join("\n");
      const severity = exact.length
        ? "SUPER IMPORTANT: " + exact.length + " accepted booking(s) already have this exact date and start time."
        : "IMPORTANT: accepted booking(s) already exist on this date, but the time differs or needs checking.";
      const message = severity + (review.length ? "\nThere are also " + review.length + " same-day booking(s) to review." : "") +
        "\n\n" + overlap + "\n\nCheck the schedule before accepting. The request will remain unchanged if you cancel.";
      if (!window.confirm(message + "\n\nAccept this booking anyway?")) return;
    }
  }

  const actionButtons = button.closest(".booking-actions");
  const previousLabel = button.textContent;
  if (actionButtons) actionButtons.querySelectorAll("button").forEach(item => { item.disabled = true; });
  button.textContent = status === "approved" ? "Accepting…" : status === "declined" ? "Declining…" : status === "cancelled" ? "Cancelling…" : "Saving…";
  showMessage(dashboardMessage, "Saving booking update…");
  try {
    const { data, error } = await supabase.from("bookings").update({ status, decline_reason: null }).eq("id", id).select("id,status").maybeSingle();
    if (error) throw error;
    if (!data || data.status !== status) throw new Error("Supabase did not confirm the requested status change. Refresh the list before trying again.");

    let notice = status === "approved" ? "Booking accepted and saved." :
      status === "read" ? "Request marked as read and moved to Already read." :
      status === "declined" ? "Booking declined and saved. Please contact the client yourself." :
      status === "cancelled" ? "Booking cancelled and saved. Please contact the client yourself." :
      "Booking status updated.";
    let emailWarning = "";
    if (status === "approved") {
      try {
        const result = await callEmail({ action: "booking-status", bookingId: id }, true);
        if (!result.ok || Number(result.sent) < 1) emailWarning = " The booking was saved, but the customer email could not be confirmed.";
      } catch (emailError) {
        console.warn("Booking acceptance email could not be confirmed:", emailError);
        emailWarning = " The booking was saved, but the customer email could not be confirmed.";
      }
    }
    showMessage(dashboardMessage, notice + emailWarning, Boolean(emailWarning));
    await loadBookings();
  } catch (error) {
    console.error("CineFlow booking status update failed:", error);
    showMessage(dashboardMessage, "Couldn't confirm the booking update: " + (error.message || "Unknown error") + " Refresh the list and check the status before retrying.", true);
    if (actionButtons) actionButtons.querySelectorAll("button").forEach(item => { item.disabled = false; });
    button.textContent = previousLabel;
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
