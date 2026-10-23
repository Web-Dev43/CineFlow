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
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function niceDate(value) {
  if (!value) return "Date not specified";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {dateStyle:"medium"}).format(date);
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
  showMessage(dashboardMessage, bookings.length ? bookings.length + " booking" + (bookings.length === 1 ? "" : "s") + " total. New requests start in Pending." : "No bookings yet. New client requests will appear here.");
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
    const status = ["pending","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    const details = [
      "Preferred date: " + niceDate(item.requested_date),
      "Location: " + (item.location || "Not provided"),
      "Budget: " + (item.budget_range || "Not provided"),
      "Phone: " + (item.client_phone || "Not provided"),
      "Referral: " + (item.referral_source || "Not provided"),
      ...(status === "declined" && item.decline_reason ? ["Decline reason: " + item.decline_reason] : [])
    ].join("\n");
    const buttons = status === "pending"
      ? '<button class="approve" data-action="approved" data-id="' + escapeHtml(item.id) + '">Approve</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
      : status === "approved"
        ? '<button data-action="pending" data-id="' + escapeHtml(item.id) + '">Move to pending</button><button data-action="cancelled" data-id="' + escapeHtml(item.id) + '">Cancel booking</button>'
        : '<button data-action="pending" data-id="' + escapeHtml(item.id) + '">Reopen to pending</button>';
    return '<article class="booking-card"><div class="booking-card-top"><div><h3>' + escapeHtml(item.client_name) + ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml(item.service) + '</span></h3><div class="booking-meta">' + escapeHtml(item.client_email) + '<br>Received ' + escapeHtml(new Date(item.created_at).toLocaleString()) + '</div></div><span class="status-pill ' + status + '">' + escapeHtml(status) + '</span></div><div class="booking-details">' + escapeHtml(details) + "\n\n" + escapeHtml(item.project_details) + '</div><div class="booking-actions">' + buttons + '</div></article>';
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
    const serviceInfo = service => {
      const value = String(service || "").toLowerCase();
      if (value.includes("sport") || value.includes("baseball") || value.includes("basketball") || value.includes("football")) return {icon:"⚾", label:service || "Sports"};
      if (value.includes("music")) return {icon:"🎵", label:service || "Music video"};
      if (value.includes("photo")) return {icon:"📸", label:service || "Photography"};
      if (value.includes("event")) return {icon:"🎉", label:service || "Event coverage"};
      if (value.includes("edit")) return {icon:"✂️", label:service || "Video editing"};
      if (value.includes("shoot")) return {icon:"🎬", label:service || "Video shoot"};
      return {icon:"🎥", label:service || "Project"};
    };
    const labels = onDate.slice(0, 2).map(item => {
      const info = serviceInfo(item.service);
      return '<span class="calendar-event-label" title="' + escapeHtml(info.label) + '"><span aria-hidden="true">' + info.icon + '</span><span>' + escapeHtml(info.label) + '</span></span>';
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
    const status = ["pending","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    return '<article class="calendar-booking"><div><strong>' + escapeHtml(item.client_name) + '</strong><span>' + escapeHtml(item.service) + '</span></div><span class="status-pill ' + status + '">' + escapeHtml(status) + '</span><p>' + escapeHtml(item.client_email) + '</p>' + (status === "declined" && item.decline_reason ? '<p class="decline-reason"><strong>Decline reason:</strong> ' + escapeHtml(item.decline_reason) + '</p>' : '') + '</article>';
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
  let declineReason = "";
  if (status === "declined") {
    const enteredReason = window.prompt("Why are you declining this booking? Please give the client a clear explanation.");
    if (enteredReason === null) return;
    declineReason = enteredReason.trim();
    if (!declineReason) {
      window.alert("Please enter a reason before declining this booking.");
      return;
    }
  }
  if (status === "approved") {
    const selected = bookings.find(item => item.id === id);
    const conflict = bookings.find(item => item.id !== id && item.status === "approved" && item.requested_date === selected?.requested_date);
    if (conflict && !window.confirm("Another approved booking has the same requested date. Approve this request anyway?")) return;
  }
  button.disabled = true;
  try {
    const update = {status, decline_reason: status === "declined" ? declineReason : null};
    const {error} = await supabase.from("bookings").update(update).eq("id", id);
    if (error) throw error;
    showMessage(dashboardMessage, status === "declined" ? "Booking declined and the reason was saved." : "Booking updated and moved to the " + status + " tab.");
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