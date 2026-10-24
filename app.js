const form = document.querySelector("#booking-form");
const statusBox = document.querySelector("#form-status");
const submitButton = form.querySelector('button[type="submit"]');
document.querySelector("#year").textContent = new Date().getFullYear();

const config = window.CINEFLOW_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey &&
  !config.supabaseUrl.includes("YOUR_PROJECT_REF") &&
  !config.supabasePublishableKey.includes("YOUR_SUPABASE"));
const REST_URL = configured ? config.supabaseUrl.replace(/\/$/, "") + "/rest/v1/bookings" : "";
const PUSH_URL = config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/cineflow-push" : "";
const PUSH_KEY = config.vapidPublicKey || "";

function setStatus(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
}
function showErrorOverlay(title, details) {
  const overlay = document.querySelector("#error-overlay");
  const heading = document.querySelector("#error-overlay-title");
  const summary = document.querySelector("#error-overlay-summary");
  const detailBox = document.querySelector("#error-overlay-details");
  if (!overlay || !heading || !summary || !detailBox) {
    setStatus((title ? title + ": " : "") + String(details || "Unknown error"), true);
    return;
  }
  heading.textContent = title || "Something went wrong";
  summary.textContent = "CineFlow caught a problem. Copy the details below and send them to us so we can diagnose it.";
  detailBox.textContent = String(details || "No additional details were provided.").slice(0, 6000);
  overlay.hidden = false;
}
window.CINEFLOW_SHOW_ERROR = showErrorOverlay;
document.querySelector("#error-overlay-close")?.addEventListener("click", () => {
  document.querySelector("#error-overlay").hidden = true;
});
document.querySelector("#error-overlay-copy")?.addEventListener("click", async () => {
  const details = document.querySelector("#error-overlay-details");
  const button = document.querySelector("#error-overlay-copy");
  try {
    await navigator.clipboard.writeText(details.textContent);
    button.textContent = "Copied!";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(details);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = "Select the text above";
  }
});
function encodeBase64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken() {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
async function subscribeClient(token) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "Push notifications aren't supported in this browser.";
  }
  if (!PUSH_KEY || PUSH_KEY.includes("PASTE_VAPID")) {
    return "Booking received. To enable booking alerts, the public VAPID key still needs to be added to config.js.";
  }
  if (!window.isSecureContext) return "Booking received. Push notifications require a secure HTTPS connection.";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "Booking received. Notifications are off; you can enable them in your browser settings.";
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const paddedKey = PUSH_KEY.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - PUSH_KEY.length % 4) % 4);
    const key = Uint8Array.from(atob(paddedKey), c => c.charCodeAt(0));
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

form.addEventListener("invalid", (event) => {
  const field = event.target;
  const label = field?.name || field?.type || "form field";
  showErrorOverlay("Please check the booking form", label + ": " + (field?.validationMessage || "This field is invalid or incomplete."));
}, true);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!configured) {
    setStatus("CineFlow is not connected to Supabase yet. Please contact Cinematiclife.17 directly.", true);
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
  setStatus("Sending your request securely…");
  try {
    const response = await fetch(REST_URL + "?select=id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + config.supabasePublishableKey,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("CineFlow booking submission failed:", response.status, result);
      throw new Error(result?.message || result?.hint || "The booking service rejected the request (HTTP " + response.status + ").");
    }
    const booking = Array.isArray(result) ? result[0] : null;
    if (!booking?.id) throw new Error("The request response was unexpected. Please contact Cinematiclife.17 before submitting again.");

    form.reset();
    let message = "Request sent! It is pending review, so your date is not confirmed until Cinematiclife.17 approves it.";
    try {
      message += "\n\n" + await subscribeClient(token);
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
    showErrorOverlay("Booking request failed", error && (error.stack || error.message) ? (error.stack || error.message) : String(error || "Unknown submission error"));
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Submit project request";
  }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch(error => console.warn("CineFlow offline support could not be enabled:", error));
  });
}
