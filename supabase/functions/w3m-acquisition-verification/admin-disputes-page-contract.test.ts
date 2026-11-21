const pageUrl = new URL("../../../admin-disputes.html", import.meta.url);
const page = await Deno.readTextFile(pageUrl);
Deno.test("admin dispute review page is AAL2-gated and read-only until secure endpoint deployment", () => {
  for (const marker of ["getAuthenticatorAssuranceLevel", "auth.mfa.challenge", "auth.mfa.verify", "profiles"]) {
    if (!page.includes(marker)) throw new Error("Admin dispute page missing security marker: " + marker);
  }
  if (!page.includes("Decision submission is deliberately disabled in this preview")) throw new Error("Admin dispute page must clearly identify its read-only preview state.");
  if (!page.includes("disabled>Submit decision")) throw new Error("Decision submission must remain disabled in preview.");
  if (page.includes("functions.invoke") || page.includes("w3m-protocol-v1-dispute-decision")) throw new Error("Read-only preview must not call the production dispute decision endpoint.");
  for (const table of ["deal_disputes", "deals", "projects", "deal_messages", "deal_assets", "deal_audit_logs"]) {
    for (const operation of ["insert", "update", "upsert", "delete"]) {
      if (page.includes('.from("' + table + '").' + operation + "(")) throw new Error("Admin dispute page must not mutate " + table + ".");
    }
  }
  const scriptStart = page.indexOf("<script>");
  const scriptEnd = page.indexOf("</script>", scriptStart);
  if (scriptStart < 0 || scriptEnd <= scriptStart) throw new Error("Admin dispute page inline script is missing.");
  new Function(page.slice(scriptStart + "<script>".length, scriptEnd));
});
