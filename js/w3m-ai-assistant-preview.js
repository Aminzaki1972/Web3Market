(() => {
  "use strict";
  const root = document.getElementById("w3m-ai-preview");
  if (!root) return;
  const client = () => window.Web3MarketSupabase?.getClient?.() || window.Web3MarketSupabase?.client || window.supabaseClient || null;
  const $ = (id) => document.getElementById(id);
  const messages = [];
  let language = "auto";
  let activeLanguage = "en";
  let busy = false;
  let recognition = null;
  const speechSupported = "speechSynthesis" in window;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechInputSupported = Boolean(Recognition);

  function detectLanguage(text) { return /[\u0600-\u06FF]/.test(text) ? "ar" : "en"; }
  function copy(text) { return String(text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
  function setStatus(text, error = false) { $("w3m-ai-status").textContent = text; $("w3m-ai-status").classList.toggle("error", error); }
  function addMessage(role, text) {
    const item = document.createElement("article");
    item.className = "message " + role;
    item.dir = detectLanguage(text) === "ar" ? "rtl" : "auto";
    const label = document.createElement("small");
    label.textContent = role === "user" ? (detectLanguage(text) === "ar" ? "أنت" : "You") : "W3M AI";
    const body = document.createElement("p");
    body.textContent = text;
    item.append(label, body);
    $("w3m-ai-messages").append(item);
    $("w3m-ai-messages").scrollTop = $("w3m-ai-messages").scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    $("w3m-ai-send").disabled = value;
    $("w3m-ai-input").disabled = value;
    $("w3m-ai-send").textContent = value ? (language === "ar" ? "جارٍ الرد…" : "Thinking…") : (language === "ar" ? "إرسال" : "Send");
  }
  async function send() {
    const text = copy($("w3m-ai-input").value).trim();
    if (!text || busy) return;
    const sb = client();
    if (!sb?.auth) { setStatus("Secure connection is unavailable. Reload and try again.", true); return; }
    const { data: { session }, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !session) {
      setStatus("Please sign in to your Web3Market account to use the assistant.", true);
      return;
    }
    activeLanguage = language === "auto" ? detectLanguage(text) : language;
    addMessage("user", text);
    messages.push({ role: "user", text });
    $("w3m-ai-input").value = "";
    setBusy(true);
    setStatus(activeLanguage === "ar" ? "يتم تجهيز الإجابة…" : "Preparing your answer…");
    try {
      const { data, error } = await sb.functions.invoke("w3m-ai-assistant", {
        body: { message: text, language: activeLanguage, history: messages.slice(-8, -1) },
      });
      if (error || !data?.ok || typeof data.answer !== "string") throw new Error(data?.error || error?.message || "Assistant request failed.");
      addMessage("assistant", data.answer);
      messages.push({ role: "assistant", text: data.answer });
      setStatus(activeLanguage === "ar" ? "مساعد Web3Market · العربية والإنجليزية" : "Web3Market Assistant · Arabic & English");
    } catch (error) {
      const message = error?.message || "The assistant is temporarily unavailable.";
      addMessage("assistant", activeLanguage === "ar" ? "عذراً، المساعد غير متاح حالياً. حاول مرة أخرى بعد قليل." : "Sorry, the assistant is temporarily unavailable. Please try again shortly.");
      setStatus(message, true);
    } finally { setBusy(false); }
  }
  function speakLast() {
    const last = [...messages].reverse().find((item) => item.role === "assistant");
    if (!last || !speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(last.text);
    utterance.lang = detectLanguage(last.text) === "ar" ? "ar-EG" : "en-US";
    window.speechSynthesis.speak(utterance);
  }
  function startListening() {
    if (!Recognition || busy) return;
    if (recognition) { recognition.stop(); recognition = null; }
    recognition = new Recognition();
    const voiceLanguage = language === "auto"
      ? ((navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : activeLanguage)
      : language;
    recognition.lang = voiceLanguage === "ar" ? "ar-EG" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript) { $("w3m-ai-input").value = transcript; activeLanguage = language === "auto" ? detectLanguage(transcript) : language; }
      setStatus(activeLanguage === "ar" ? "تم التعرف على كلامك. راجع الرسالة ثم أرسلها." : "Speech recognized. Review your message and press Send.");
    };
    recognition.onerror = (event) => setStatus("Voice input unavailable: " + (event.error || "unknown error"), true);
    recognition.onend = () => { $("w3m-ai-voice").classList.remove("listening"); };
    $("w3m-ai-voice").classList.add("listening");
    setStatus(activeLanguage === "ar" ? "استمع الآن… تحدث بوضوح." : "Listening… Speak clearly.");
    recognition.start();
  }
  $("w3m-ai-send").addEventListener("click", send);
  $("w3m-ai-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } });
  $("w3m-ai-voice").addEventListener("click", startListening);
  $("w3m-ai-speak").addEventListener("click", speakLast);
  $("w3m-ai-language").addEventListener("change", (event) => {
    language = event.target.value;
    if (language !== "auto") activeLanguage = language;
    $("w3m-ai-status").textContent = language === "ar" ? "مساعد Web3Market · العربية والإنجليزية" : "Web3Market Assistant · Arabic & English";
  });
  if (!speechInputSupported) $("w3m-ai-voice").hidden = true;
  if (!speechSupported) $("w3m-ai-speak").hidden = true;
  setStatus("Web3Market Assistant · Arabic & English");
})();
