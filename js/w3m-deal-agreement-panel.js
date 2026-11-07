// Isolated, read-only renderer for the W3M V1 canonical agreement status.
// Deliberately not imported by Deal Room until the V1 endpoint and terms are deployed.
function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function renderW3MDealAgreementPanel(container, status, documentRef = globalThis.document) {
  if (!container || typeof container.replaceChildren !== "function" ||
      typeof container.appendChild !== "function") {
    throw new Error("A valid agreement panel container is required.");
  }
  if (!documentRef || typeof documentRef.createElement !== "function") {
    throw new Error("A document implementation is required.");
  }
  if (!status || typeof status !== "object" ||
      typeof status.bothAccepted !== "boolean" ||
      typeof status.dealEligible !== "boolean" ||
      !status.acceptances || typeof status.acceptances !== "object") {
    throw new Error("W3M V1 agreement status is malformed.");
  }
  for (const role of ["buyer", "seller"]) {
    const party = status.acceptances[role];
    if (!party || typeof party.accepted !== "boolean" ||
        (party.accepted && typeof party.accepted_at !== "string")) {
      throw new Error("W3M V1 party acceptance status is malformed.");
    }
  }

  container.replaceChildren();
  const panel = element(documentRef, "section", "w3m-v1-agreement-status");
  const heading = element(documentRef, "h3", "", "W3M V1 Deal Agreement");
  panel.appendChild(heading);

  const terms = status.currentTerms;
  if (!terms) {
    panel.appendChild(element(documentRef, "p", "w3m-v1-muted",
      "No published canonical agreement terms are available for this deal."));
  } else {
    if (typeof terms.terms_version !== "string" ||
        typeof terms.terms_hash !== "string" ||
        !terms.canonical_terms || typeof terms.canonical_terms !== "object" ||
        Array.isArray(terms.canonical_terms)) {
      throw new Error("W3M V1 canonical terms are malformed.");
    }
    panel.appendChild(element(documentRef, "p", "",
      "Published terms version: " + terms.terms_version));
    panel.appendChild(element(documentRef, "p", "",
      "Canonical terms hash: " + terms.terms_hash));
    const details = element(documentRef, "details", "w3m-v1-canonical-terms");
    details.appendChild(element(documentRef, "summary", "", "View canonical agreement terms"));
    const pre = element(documentRef, "pre", "", JSON.stringify(terms.canonical_terms, null, 2));
    pre.style.whiteSpace = "pre-wrap";
    pre.style.overflowWrap = "anywhere";
    details.appendChild(pre);
    panel.appendChild(details);
  }

  for (const role of ["buyer", "seller"]) {
    const party = status.acceptances[role];
    const state = party.accepted
      ? "Accepted" + (party.accepted_at ? " · " + party.accepted_at : "")
      : "Not accepted";
    panel.appendChild(element(documentRef, "p", "w3m-v1-party-state",
      role.charAt(0).toUpperCase() + role.slice(1) + ": " + state));
  }

  const summary = status.bothAccepted && status.dealEligible
    ? "Both parties accepted the current published terms. Server reports the deal as eligible for the next V1 gate."
    : "The V1 agreement gate is not complete. No Safe operation or funds movement is initiated by this panel.";
  panel.appendChild(element(documentRef, "p", "w3m-v1-gate-state", summary));
  container.appendChild(panel);
  return panel;
}
