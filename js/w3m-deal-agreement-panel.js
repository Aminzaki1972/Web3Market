// Read-only renderer for the W3M V1 canonical agreement and per-asset status.
function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function renderW3MDealAgreementPanel(container, status, documentRef = globalThis.document, options = {}) {
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
      !status.finalDeliveryConfirmation || typeof status.finalDeliveryConfirmation !== "object" ||
      typeof status.finalDeliveryConfirmation.confirmed !== "boolean" ||
      typeof status.finalDeliveryConfirmation.stale !== "boolean" ||
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

  const assetHeading = element(documentRef, "h4", "", "Included assets and delivery evidence");
  panel.appendChild(assetHeading);
  const assets = Array.isArray(status.assets) ? status.assets : [];
  if (!assets.length) {
    panel.appendChild(element(documentRef, "p", "w3m-v1-muted", "No synchronized asset checklist is available."));
  }
  for (const asset of assets) {
    const card = element(documentRef, "article", "w3m-v1-asset");
    card.appendChild(element(documentRef, "strong", "", asset.assetName));
    card.appendChild(element(documentRef, "p", "", "Status: " + asset.status));
    if (asset.deliveryUrl) {
      const link = element(documentRef, "a", "", "Open delivery reference");
      try {
        const url = new URL(asset.deliveryUrl);
        if (url.protocol === "https:" && !url.username && !url.password) {
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          card.appendChild(link);
        }
      } catch (_) { /* malformed links are omitted */ }
    }
    if (asset.deliveredAt) card.appendChild(element(documentRef, "p", "", "Last delivered: " + asset.deliveredAt));
    if (asset.acceptedAt) card.appendChild(element(documentRef, "p", "", "Accepted: " + asset.acceptedAt));
    const history = element(documentRef, "ol", "w3m-v1-asset-history");
    for (const event of asset.events || []) {
      history.appendChild(element(documentRef, "li", "",
        event.eventType + " · attempt " + event.attemptNumber + " · " + event.occurredAt +
        " · SHA-256 " + event.evidenceDigest));
    }
    card.appendChild(history);

    if (typeof options.onAssetAction === "function" && status.viewerRole === "seller" &&
        ["pending", "delivered", "accepted", "rejected"].includes(asset.status)) {
      const form = element(documentRef, "form", "w3m-v1-asset-delivery-form");
      const urlInput = element(documentRef, "input", "w3m-v1-delivery-url");
      urlInput.type = "url";
      urlInput.required = true;
      urlInput.maxLength = 2048;
      urlInput.placeholder = "HTTPS delivery reference";
      const evidenceInput = element(documentRef, "textarea", "w3m-v1-delivery-evidence");
      evidenceInput.required = true;
      evidenceInput.maxLength = 16000;
      evidenceInput.placeholder = "Describe the delivery evidence (do not paste passwords or private keys)";
      const submit = element(documentRef, "button", "w3m-v1-deliver-button",
        asset.status === "delivered" ? "Submit a new delivery attempt" : "Register delivery");
      submit.type = "submit";
      const notice = element(documentRef, "p", "w3m-v1-asset-action-notice");
      form.appendChild(urlInput);
      form.appendChild(evidenceInput);
      form.appendChild(submit);
      form.appendChild(notice);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        notice.textContent = "Recording delivery…";
        try {
          await options.onAssetAction({
            assetId: asset.assetId,
            action: "deliver",
            deliveryUrl: urlInput.value,
            evidence: evidenceInput.value,
          });
        } catch (error) {
          notice.textContent = error?.message || "Delivery could not be recorded.";
          submit.disabled = false;
        }
      });
      card.appendChild(form);
    }

    if (typeof options.onAssetAction === "function" && status.viewerRole === "buyer" &&
        asset.status === "delivered") {
      const actions = element(documentRef, "div", "w3m-v1-buyer-asset-actions");
      const notice = element(documentRef, "p", "w3m-v1-asset-action-notice");
      for (const action of ["accept", "reject"]) {
        const button = element(documentRef, "button", "w3m-v1-" + action + "-button",
          action === "accept" ? "Accept this asset" : "Reject this asset");
        button.type = "button";
        button.addEventListener("click", async () => {
          button.disabled = true;
          notice.textContent = action === "accept" ? "Recording acceptance…" : "Recording rejection…";
          try {
            await options.onAssetAction({ assetId: asset.assetId, action });
          } catch (error) {
            notice.textContent = error?.message || "Your response could not be recorded.";
            button.disabled = false;
          }
        });
        actions.appendChild(button);
      }
      actions.appendChild(notice);
      card.appendChild(actions);
    }
    panel.appendChild(card);
  }

  const finalConfirmation = status.finalDeliveryConfirmation;
  const allAssetsAccepted = assets.length > 0 && assets.every((asset) => asset.status === "accepted");
  const canConfirmFinalDelivery = status.bothAccepted === true && allAssetsAccepted;
  const finalSection = element(documentRef, "section", "w3m-v1-final-delivery-confirmation");
  finalSection.appendChild(element(documentRef, "h4", "", "Final buyer delivery confirmation"));
  if (finalConfirmation.confirmed) {
    finalSection.appendChild(element(documentRef, "p", "w3m-v1-confirmed",
      "Buyer confirmed the complete asset set" +
      (finalConfirmation.confirmedAt ? " · " + finalConfirmation.confirmedAt : "") +
      (finalConfirmation.assetCount ? " · " + finalConfirmation.assetCount + " assets" : "") + "."));
    if (finalConfirmation.confirmationId) {
      finalSection.appendChild(element(documentRef, "p", "w3m-v1-muted",
        "Confirmation ID: " + finalConfirmation.confirmationId));
    }
    if (finalConfirmation.assetSetDigest) {
      finalSection.appendChild(element(documentRef, "p", "w3m-v1-muted",
        "Confirmed asset-set SHA-256: " + finalConfirmation.assetSetDigest));
    }
  } else {
    finalSection.appendChild(element(documentRef, "p", "w3m-v1-muted",
      finalConfirmation.stale
        ? "The previous final confirmation no longer matches the latest asset delivery. The buyer must confirm the complete asset set again."
        : allAssetsAccepted && !status.bothAccepted
          ? "Every asset is accepted, but both parties must first accept the current published terms."
          : canConfirmFinalDelivery
            ? "Every included asset is accepted and both parties accepted the current terms. The buyer can now confirm the complete delivery."
            : "Final confirmation becomes available after every included asset is accepted and both parties accept the current terms."));
    if (status.viewerRole === "buyer" && canConfirmFinalDelivery &&
        typeof options.onFinalDeliveryConfirm === "function") {
      const confirmButton = element(documentRef, "button", "w3m-v1-final-confirm-button",
        "Confirm all delivered assets");
      confirmButton.type = "button";
      const notice = element(documentRef, "p", "w3m-v1-final-confirm-notice");
      confirmButton.addEventListener("click", async () => {
        confirmButton.disabled = true;
        notice.textContent = "Recording final delivery confirmation…";
        try {
          await options.onFinalDeliveryConfirm();
        } catch (error) {
          notice.textContent = error?.message || "Final delivery confirmation could not be recorded.";
          confirmButton.disabled = false;
        }
      });
      finalSection.appendChild(confirmButton);
      finalSection.appendChild(notice);
    }
  }
  panel.appendChild(finalSection);

  const summary = status.bothAccepted
    ? "Both parties accepted the current published terms. Asset acceptance and the buyer's final delivery confirmation are separate required steps."
    : "The V1 agreement gate is not complete. No Safe operation or funds movement is initiated by this panel.";
  panel.appendChild(element(documentRef, "p", "w3m-v1-gate-state", summary));
  container.appendChild(panel);
  return panel;
}
