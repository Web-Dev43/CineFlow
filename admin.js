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
let currentFilter = "all";
let bookings = [];

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
    showMessage(dashboardMessage, error.message.includes("0 rows") ? "No requests yet." : "Couldn't load requests. Confirm this account is listed as a CineFlow admin in Supabase.", true);
    return;
  }
  bookings = data || [];
  showMessage(dashboardMessage, bookings.length ? bookings.length + " request" + (bookings.length === 1 ? "" : "s") + " total. New requests remain pending until you approve them." : "No requests yet. New client requests will appear here.");
  renderBookings();
}
function renderBookings() {
  const visible = bookings.filter(item => currentFilter === "all" || item.status === currentFilter);
  if (!visible.length) {
    bookingList.innerHTML = '<div class="empty-state">No requests in this view.</div>';
    return;
  }
  bookingList.innerHTML = visible.map(item => {
    const status = ["pending","approved","declined","cancelled"].includes(item.status) ? item.status : "pending";
    const details = [
      "Preferred date: " + niceDate(item.requested_date),
      "Location: " + (item.location || "Not provided"),
      "Budget: " + (item.budget_range || "Not provided"),
      "Phone: " + (item.client_phone || "Not provided"),
      "Referral: " + (item.referral_source || "Not provided")
    ].join("\n");
    const buttons = status === "pending"
      ? '<button class="approve" data-action="approved" data-id="' + escapeHtml(item.id) + '">Approve</button><button data-action="declined" data-id="' + escapeHtml(item.id) + '">Decline</button>'
      : status === "approved"
        ? '<button data-action="pending" data-id="' + escapeHtml(item.id) + '">Move to pending</button><button data-action="cancelled" data-id="' + escapeHtml(item.id) + '">Cancel booking</button>'
        : '<button data-action="pending" data-id="' + escapeHtml(item.id) + '">Reopen request</button>';
    return '<article class="booking-card"><div class="booking-card-top"><div><h3>' + escapeHtml(item.client_name) + ' <span style="color:var(--muted);font-weight:400">· ' + escapeHtml(item.service) + '</span></h3><div class="booking-meta">' + escapeHtml(item.client_email) + '<br>Received ' + escapeHtml(new Date(item.created_at).toLocaleString()) + '</div></div><span class="status-pill ' + status + '">' + escapeHtml(status) + '</span></div><div class="booking-details">' + escapeHtml(details) + '\n\n' + escapeHtml(item.project_details) + '</div><div class="booking-actions">' + buttons + '</div></article>';
  }).join("");
}
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
  document.querySelectorAll("[data-filter]").forEach(item => item.classList.toggle("active", item === button));
  renderBookings();
});
bookingList.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button || !supabase) return;
  const id = button.dataset.id;
  const status = button.dataset.action;
  if (status === "approved") {
    const selected = bookings.find(item => item.id === id);
    const conflict = bookings.find(item => item.id !== id && item.status === "approved" && item.requested_date === selected?.requested_date);
    if (conflict && !window.confirm("Another approved booking has the same requested date. Approve this request anyway?")) return;
  }
  button.disabled = true;
  try {
    const {error} = await supabase.from("bookings").update({status}).eq("id", id);
    if (error) throw error;
    showMessage(dashboardMessage, "Booking updated.");
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