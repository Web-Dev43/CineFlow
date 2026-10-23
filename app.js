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

function setStatus(message, error = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", error);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) {
    setStatus("The booking page is built, but it is not connected to Supabase yet. Finish the setup in the repository README before accepting real requests.", true);
    return;
  }

  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    client_name: data.client_name.trim(),
    client_email: data.client_email.trim().toLowerCase(),
    client_phone: data.client_phone.trim() || null,
    service: data.service,
    requested_date: data.requested_date,
    location: data.location.trim() || null,
    budget_range: data.budget_range || null,
    referral_source: data.referral_source || null,
    project_details: data.project_details.trim(),
    status: "pending"
  };

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Sending request…";
  setStatus("");

  try {
    const { error } = await supabase.from("bookings").insert(payload);
    if (error) throw error;
    form.reset();
    setStatus("Request sent. It is pending review, so your date is not confirmed until Cinematiclife.17 approves it.");
  } catch (error) {
    console.error("CineFlow booking submission failed:", error);
    setStatus("We couldn't send your request just yet. Please try again later or contact Cinematiclife.17 directly.", true);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Send booking request";
  }
});