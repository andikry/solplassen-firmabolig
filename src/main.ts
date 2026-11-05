const PIXEL_ID = "1090191617161338";
const CONSENT_KEY = "solplassen_cookie_consent";
const CONSENT_VERSION = 1;

interface ConsentChoice {
  version: number;
  marketing: boolean;
  savedAt: string;
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Mangler elementet #${id}`);
  return element as T;
}

getElement<HTMLSpanElement>("year").textContent = String(new Date().getFullYear());

const banner = getElement<HTMLElement>("cookie-banner");
const acceptButton = getElement<HTMLButtonElement>("cookie-accept");
const rejectButton = getElement<HTMLButtonElement>("cookie-reject");
const settingsButton = getElement<HTMLButtonElement>("cookie-settings");
const form = getElement<HTMLFormElement>("lead-form");
const status = getElement<HTMLElement>("form-status");
const submitButton = form.querySelector<HTMLButtonElement>('[type="submit"]');

if (!submitButton) throw new Error("Skjemaet mangler send-knapp");

const formFields = [
  "firma",
  "navn",
  "telefon",
  "epost",
  "personer",
  "hytter",
  "innflytting",
  "varighet",
  "melding",
] as const;

let marketingConsent = false;
let pixelInitialized = false;
let pageViewSent = false;
let submissionNumber = 0;
const trackedSubmissions = new Set<string>();

function readConsent(): boolean | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;

    const saved = JSON.parse(raw) as Partial<ConsentChoice>;
    if (
      saved.version !== CONSENT_VERSION ||
      typeof saved.marketing !== "boolean"
    ) {
      return null;
    }
    return saved.marketing;
  } catch {
    return null;
  }
}

function saveConsent(allowed: boolean): void {
  const choice: ConsentChoice = {
    version: CONSENT_VERSION,
    marketing: allowed,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {
    // Valget gjelder fortsatt for denne sidevisningen hvis lagring er blokkert.
  }
}

function clearMetaCookies(): void {
  ["_fbp", "_fbc"].forEach((name) => {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.solplassen.no; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=bedrift.solplassen.no; SameSite=Lax`;
  });
}

function installMetaPixel(): Fbq {
  if (window.fbq) return window.fbq;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
    } else {
      fbq.queue.push(args);
    }
  }) as Fbq;

  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  window._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  return fbq;
}

function initializeMetaPixel(): void {
  if (!marketingConsent || pixelInitialized) return;
  pixelInitialized = true;

  const fbq = installMetaPixel();
  fbq("set", "autoConfig", false, PIXEL_ID);
  fbq("init", PIXEL_ID);

  if (!pageViewSent) {
    fbq("track", "PageView");
    pageViewSent = true;
  }
}

function setConsent(allowed: boolean): void {
  marketingConsent = allowed;
  saveConsent(allowed);
  banner.hidden = true;

  if (allowed) {
    initializeMetaPixel();
  } else {
    if (window.fbq && pixelInitialized) window.fbq("consent", "revoke");
    clearMetaCookies();
  }
}

function trackLeadOnce(submissionId: string): void {
  if (
    !marketingConsent ||
    !pixelInitialized ||
    trackedSubmissions.has(submissionId)
  ) {
    return;
  }

  trackedSubmissions.add(submissionId);
  window.fbq?.("track", "Lead");
}

acceptButton.addEventListener("click", () => setConsent(true));
rejectButton.addEventListener("click", () => setConsent(false));
settingsButton.addEventListener("click", () => {
  banner.hidden = false;
});

const savedConsent = readConsent();
if (savedConsent === true) {
  marketingConsent = true;
  initializeMetaPixel();
} else if (savedConsent === null) {
  banner.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.submitting === "true") return;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = new FormData(form);

  // Behold e-post som reserve dersom Formspree-endepunktet fjernes senere.
  if (form.action.includes("DIN-KODE")) {
    const body = formFields
      .map((field) => `${field}: ${data.get(field) || "-"}`)
      .join("\n");

    window.location.href =
      "mailto:solplassen@solplassen.no" +
      `?subject=${encodeURIComponent(
        `Forespørsel firmabolig – ${data.get("firma") || ""}`,
      )}` +
      `&body=${encodeURIComponent(body)}`;
    status.textContent =
      "E-postprogrammet ditt åpnes. Trykk send for å fullføre.";
    return;
  }

  const submissionId = String(++submissionNumber);
  form.dataset.submitting = "true";
  submitButton.disabled = true;

  try {
    const response = await fetch(form.action, {
      method: "POST",
      body: data,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Formspree avviste forespørselen");

    trackLeadOnce(submissionId);
    form.reset();
    status.textContent = "Takk. Vi tar kontakt så snart som mulig.";
  } catch {
    status.textContent = "Noe gikk galt. Ring oss på +47 33 19 92 82.";
  } finally {
    form.dataset.submitting = "false";
    submitButton.disabled = false;
  }
});
