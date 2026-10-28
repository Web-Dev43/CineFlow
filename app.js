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


async function submitDeveloperReport({ title, details, source = "manual", severity = "info" }) {
  if (!configured) throw new Error("CineFlow is not connected to its report inbox yet.");
  const reportId = crypto.randomUUID();
  const response = await fetch(config.supabaseUrl.replace(/\/$/, "") + "/rest/v1/developer_reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": config.supabasePublishableKey, "Authorization": "Bearer " + config.supabasePublishableKey, "Prefer": "return=minimal" },
    body: JSON.stringify({ id: reportId, title: String(title).slice(0,160), details: String(details || "").slice(0,10000), source, severity, page_path: location.pathname.slice(0,500), user_agent: navigator.userAgent.slice(0,1000) })
  });
  const raw = await response.text(); let data = null; try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(data?.message || data?.error || raw || "Could not save the report.");
  try {
    const push = await fetch(PUSH_URL, { method:"POST", headers:{"Content-Type":"application/json","apikey":config.supabasePublishableKey}, body:JSON.stringify({action:"new-report",reportId}) });
    const result = await push.json().catch(()=>({}));
    return { saved:true, notified:push.ok && Number(result.sent)>0 };
  } catch { return { saved:true, notified:false }; }
}
document.querySelector("#report-issue")?.addEventListener("click", async () => {
  const title = window.prompt("What should we call the issue? (Example: Admin notification failed)");
  if (!title || !title.trim()) return;
  const details = window.prompt("Describe what happened. Please don't include passwords or sensitive personal information.") || "";
  const button = document.querySelector("#report-issue");
  button.disabled = true; button.textContent = "Sending report…";
  try {
    const result = await submitDeveloperReport({title:title.trim(),details:details.trim(),source:"manual",severity:"warning"});
    window.alert(result.notified ? "Report sent! It was saved and a push alert was sent to the developer." : "Report saved to the Developer Inbox. A push alert could not be confirmed, so the developer will still see it when they open the inbox.");
  } catch (error) { window.alert("Could not send report: " + (error.message || error)); }
  finally { button.disabled=false; button.textContent="Report an issue"; }
});

function setStatus(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
}
function showErrorOverlay(title, details) {
  const overlay = document.querySelector("#error-overlay");
  const heading = document.querySelector("#error-overlay-title");
  const summary = document.querySelector("#error-overlay-summary");
  const detailBox = document.querySelector("#error-overlay-details");
  const readableDetails = details instanceof Error
    ? [details.message || "Unknown error", details.stack && details.stack !== details.message ? "\n\nTechnical trace:\n" + details.stack : ""].filter(Boolean).join("")
    : String(details || "No additional details were provided.");
  if (!overlay || !heading || !summary || !detailBox) {
    setStatus((title ? title + ": " : "") + readableDetails, true);
    return;
  }
  heading.textContent = title || "Something went wrong";
  summary.textContent = "CineFlow caught a problem. The message below explains what failed; technical details follow when available.";
  detailBox.textContent = readableDetails.slice(0, 6000);
  overlay.hidden = false;
}
window.addEventListener("error", (event) => {
  const target = event.target;
  if (target && target !== window && (target.src || target.href)) {
    showErrorOverlay("A resource failed to load", (target.tagName || "Resource") + ": " + (target.src || target.href));
    return;
  }
  showErrorOverlay("A JavaScript error occurred", [
    event.message || "Unknown JavaScript error",
    event.filename ? "File: " + event.filename : "",
    event.lineno ? "Line: " + event.lineno + (event.colno ? ", column: " + event.colno : "") : "",
    event.error && event.error.stack ? event.error.stack : ""
  ].filter(Boolean).join("\n"));
}, true);
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  showErrorOverlay("An async operation failed", reason && (reason.stack || reason.message) ? (reason.stack || reason.message) : String(reason || "Unknown promise rejection"));
});
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
    // Let PostgreSQL apply the column default ("pending") so the INSERT policy checks the canonical value.
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
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    let result = null;
    try { result = responseText ? JSON.parse(responseText) : null; } catch {}
    if (!response.ok) {
      console.error("CineFlow booking submission failed:", response.status, result || responseText);
      const reason = result && typeof result === "object"
        ? [result.message, result.error, result.details, result.hint, result.code ? "Error code: " + result.code : ""].filter(Boolean).join("\n")
        : String(responseText || "").trim();
      throw new Error("Supabase returned HTTP " + response.status + (reason ? ":\n" + reason : ". No error message was returned."));
    }
    form.reset();
    const message = "Request sent! It is pending review, so your date is not confirmed until Cinematiclife.17 approves it.";
    try {
      await subscribeClient(token);
    } catch (pushError) {
      console.warn("CineFlow client push subscription failed:", pushError);
    }
    setStatus(message);
  } catch (error) {
    console.error("CineFlow booking submission failed:", error);
    showErrorOverlay("Booking request failed", error instanceof Error ? error : String(error || "Unknown submission error"));
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
