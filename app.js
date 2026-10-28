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
const EMAIL_URL = config.supabaseUrl ? config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/cineflow-email" : "";
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

/* Four-step booking flow: validate each panel and build a final review summary. */
const bookingPanels = [...form.querySelectorAll("[data-step]")];
const stepIndicators = [...document.querySelectorAll("[data-step-indicator]")];
const continueButton = document.querySelector("#booking-continue");
const backButton = document.querySelector("#booking-back");
const progressFill = document.querySelector("#booking-progress-fill");
const reviewSummary = document.querySelector("#booking-review-summary");
let activeBookingStep = 0;
const reviewFields = [
  ["Service", "service"], ["Project", "event_name"], ["Project details", "project_details"],
  ["Preferred date", "requested_date"], ["Start time", "requested_time"], ["Location", "location"],
  ["Name", "client_name"], ["Email", "client_email"], ["Phone", "client_phone"],
  ["Budget", "budget_range"], ["How you found us", "referral_source"]
];
function updateBookingStep() {
  bookingPanels.forEach((panel, index) => {
    const active = index === activeBookingStep;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  stepIndicators.forEach((indicator, index) => {
    indicator.classList.toggle("active", index === activeBookingStep);
    indicator.classList.toggle("complete", index < activeBookingStep);
    if (index === activeBookingStep) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  });
  if (progressFill) progressFill.style.width = (activeBookingStep / (bookingPanels.length - 1) * 100) + "%";
  backButton.hidden = activeBookingStep === 0;
  continueButton.hidden = activeBookingStep === bookingPanels.length - 1;
  submitButton.hidden = activeBookingStep !== bookingPanels.length - 1;
  document.querySelector("#booking-title").textContent = activeBookingStep === 3 ? "Your request, ready to send" : "Let’s plan your project";
  if (activeBookingStep === 3) renderBookingReview();
}
function renderBookingReview() {
  if (!reviewSummary) return;
  reviewSummary.replaceChildren();
  const values = new FormData(form);
  reviewFields.forEach(([label, name]) => {
    const value = String(values.get(name) || "").trim();
    if (!value) return;
    const row = document.createElement("div");
    row.className = "booking-review-row";
    const key = document.createElement("span");
    key.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    row.append(key, content);
    reviewSummary.append(row);
  });
}
function validateBookingStep() {
  const panel = bookingPanels[activeBookingStep];
  const fields = [...panel.querySelectorAll("input, select, textarea")];
  for (const field of fields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      field.focus();
      return false;
    }
  }
  return true;
}
continueButton?.addEventListener("click", () => {
  if (!validateBookingStep()) return;
  activeBookingStep = Math.min(activeBookingStep + 1, bookingPanels.length - 1);
  setStatus("");
  updateBookingStep();
  document.querySelector(".form-card").scrollIntoView({behavior:"smooth",block:"start"});
});
backButton?.addEventListener("click", () => {
  activeBookingStep = Math.max(0, activeBookingStep - 1);
  setStatus("");
  updateBookingStep();
  document.querySelector(".form-card").scrollIntoView({behavior:"smooth",block:"start"});
});
form.querySelectorAll("input, select, textarea").forEach(field => {
  field.addEventListener("input", () => { if (activeBookingStep === 3) renderBookingReview(); });
  field.addEventListener("change", () => { if (activeBookingStep === 3) renderBookingReview(); });
});
const requestedDateField = form.querySelector('[name="requested_date"]');
if (requestedDateField) {
  const localToday = new Date();
  requestedDateField.min = [localToday.getFullYear(), String(localToday.getMonth()+1).padStart(2,"0"), String(localToday.getDate()).padStart(2,"0")].join("-");
}
updateBookingStep();

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

// The wizard uses native field validation in each step instead of a full-screen error overlay.
form.noValidate = true;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Validate every required field before sending, including fields on earlier wizard steps.
  for (const field of form.querySelectorAll("input, select, textarea")) {
    if (!field.checkValidity()) {
      const panel = field.closest("[data-step]");
      if (panel) {
        activeBookingStep = Number(panel.dataset.step);
        updateBookingStep();
      }
      field.reportValidity();
      field.focus();
      return;
    }
  }
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
    // New requests begin in the admin inbox until they are read or declined.
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
    let adminEmailSent = false;
    try {
      const emailResponse = await fetch(EMAIL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.supabasePublishableKey
        },
        body: JSON.stringify({ action: "new-booking", token })
      });
      const emailResult = await emailResponse.json().catch(() => ({}));
      adminEmailSent = emailResponse.ok && emailResult.ok === true && Number(emailResult.sent) > 0;
      if (!adminEmailSent) console.warn("CineFlow admin email could not be confirmed:", emailResult);
    } catch (emailError) {
      console.warn("CineFlow admin email request failed:", emailError);
    }
    const message = "Request sent! Keep an eye on " + data.client_email.trim() + " for any updates from Cinematiclife.17." +
      (adminEmailSent ? "" : " The booking was saved, but the admin email could not be confirmed.");
    try {
      await subscribeClient(token);
    } catch (pushError) {
      console.warn("CineFlow client push subscription failed:", pushError);
    }
    setStatus(message, !adminEmailSent);
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

const reviewsList=document.querySelector("#reviews-list"),reviewForm=document.querySelector("#review-form"),reviewStatus=document.querySelector("#review-status");
function reviewMessage(message,error=false){if(!reviewStatus)return;reviewStatus.textContent=message;reviewStatus.classList.toggle("error",error)}
function renderReviews(items){if(!reviewsList)return;if(!items.length){reviewsList.innerHTML='<div class="reviews-empty"><span class="reviews-empty-mark">✳</span><h3>Be the first to share your experience</h3><p>No approved reviews yet. Real reviews will appear here when approved.</p></div>';return}reviewsList.replaceChildren();items.forEach(item=>{const card=document.createElement("article");card.className="review-card";const stars=document.createElement("p");stars.className="review-stars";stars.textContent="★".repeat(item.rating)+"☆".repeat(5-item.rating);stars.setAttribute("aria-label",item.rating+" out of 5 stars");const quote=document.createElement("p");quote.className="review-quote";quote.textContent=item.review_text;const byline=document.createElement("p");byline.className="review-byline";byline.textContent=item.reviewer_name+" · Customer-submitted review";card.append(stars,quote,byline);reviewsList.append(card)})}
async function loadReviews(){if(!reviewsList)return;if(!configured){reviewsList.innerHTML='<p class="reviews-empty">Reviews will appear when the review service is connected.</p>';return}try{const response=await fetch(config.supabaseUrl.replace(/\/$/,"")+"/rest/v1/reviews?select=id,reviewer_name,rating,review_text,created_at&status=eq.approved&order=created_at.desc&limit=30",{headers:{apikey:config.supabasePublishableKey,Authorization:"Bearer "+config.supabasePublishableKey}});if(!response.ok)throw new Error("Reviews could not be loaded.");renderReviews(await response.json())}catch(error){reviewsList.innerHTML='<p class="reviews-empty">Reviews are temporarily unavailable. Please try again later.</p>';console.warn("Review loading failed:",error)}}
reviewForm?.addEventListener("submit",async event=>{event.preventDefault();if(!configured){reviewMessage("Reviews are temporarily unavailable.",true);return}const data=new FormData(reviewForm);if(String(data.get("website")||"").trim())return;const reviewer_name=String(data.get("reviewer_name")||"").trim(),review_text=String(data.get("review_text")||"").trim(),rating=Number(data.get("rating"));if(!reviewer_name||review_text.length<5||!Number.isInteger(rating)||rating<1||rating>5){reviewMessage("Please enter your name, choose a rating, and write at least 5 characters.",true);return}const button=document.querySelector("#review-submit");button.disabled=true;button.querySelector("span").textContent="Submitting…";reviewMessage("Sending your review for moderation…");try{const response=await fetch(config.supabaseUrl.replace(/\/$/,"")+"/rest/v1/reviews",{method:"POST",headers:{"Content-Type":"application/json",apikey:config.supabasePublishableKey,Authorization:"Bearer "+config.supabasePublishableKey,Prefer:"return=minimal"},body:JSON.stringify({reviewer_name,rating,review_text,status:"pending"})});if(!response.ok)throw new Error("The review could not be saved. Please try again later.");reviewForm.reset();reviewMessage("Thanks! Your review was submitted and will only appear if it’s approved.")}catch(error){reviewMessage(error.message||"Could not submit the review.",true)}finally{button.disabled=false;button.querySelector("span").textContent="Submit review for approval"}});
loadReviews();
