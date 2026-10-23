import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const form = document.querySelector("#booking-form");
const statusBox = document.querySelector("#form-status");
const submitButton = form.querySelector('button[type="submit"]');
document.querySelector("#year").textContent = new Date().getFullYear();

const config = window.CINEFLOW_CONFIG || {};
const configured = config.supabaseUrl && config.supabasePublishableKey &&
  !config.supabaseUrl.includes("YOUR_PROJECT_REF") &&
  !config.supabasePublishableKey.includes("YOUR_SUPABASE");
const supabase = configured ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
const PUSH_URL = config.supabaseUrl ? config.supabaseUrl + "/functions/v1/cineflow-push" : "";
const PUSH_KEY = config.vapidPublicKey || "";

function setStatus(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
}
function encodeBase64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeBase64Url(bytes);
}
async function subscribeClient(token) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "Push notifications aren't supported in this browser.";
  }
  if (!PUSH_KEY || PUSH_KEY.includes("PASTE_VAPID")) return "Booking received. To enable booking alerts, the public VAPID key still needs to be added to config.js.";
  if (!window.isSecureContext) return "Booking received. Push notifications require a secure HTTPS connection.";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "Booking received. Notifications are off; you can enable them in your browser settings.";
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const key = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - PUSH_KEY.length % 4) % 4)), c => c.charCodeAt(0));
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const response = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": config.supabasePublishableKey },
    body: JSON.stringify({ action: "subscribe-client", token, subscription: subscription.toJSON() })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not enable notifications.");
  return "Booking received. Notifications are enabled for updates to this request on this device.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) {
    setStatus("The booking page is built, but it is not connected to Supabase yet. Finish the setup in the repository README before accepting real requests.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(form).entries());
  const token = randomToken();
  const payload = {
    client_name: data.client_name.trim(),
    client_email: data.client_email.trim().toLowerCase(),
    client_phone: data.client_phone.trim() || null,
    service: data.service,
    event_name: data.event_name.trim(),
    requested_date: data.requested_date,
    requested_time: data.requested_time,
    location: data.location.trim(),
    budget_range: data.budget_range || null,
    referral_source: data.referral_source || null,
    project_details: data.project_details.trim(),
    status: "pending",
    client_push_token: token
  };
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Sending request…";
  setStatus("");
  try {
    const { data: booking, error } = await supabase.from("bookings").insert(payload).select("id").single();
    if (error) throw error;
    form.reset();
    let message = "Request sent. It is pending review, so your date is not confirmed until Cinematiclife.17 approves it.";
    try {
      const pushMessage = await subscribeClient(token);
      message += "\n\n" + pushMessage;
    } catch (pushError) {
      console.warn("CineFlow client push subscription failed:", pushError);
      message += "\n\nYour request was saved, but notifications could not be enabled on this device.";
    }
    setStatus(message);
    fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": config.supabasePublishableKey },
      body: JSON.stringify({ action: "new-booking", bookingId: booking.id })
    }).catch(error => console.warn("CineFlow admin push trigger failed:", error));
  } catch (error) {
    console.error("CineFlow booking submission failed:", error);
    setStatus("We couldn't send your request just yet. Please try again later or contact Cinematiclife.17 directly.", true);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Send booking request";
  }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch(error => console.warn("CineFlow offline support could not be enabled:", error));
  });
}
