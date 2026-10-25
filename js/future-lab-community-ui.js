/* Future Lab Community UI — safe DOM rendering; authorization remains enforced by Supabase RLS. */
(function () {
  "use strict";
  const categories = ["Web3", "AI", "Smart Contracts", "Security", "Research", "Development"];
  const service = () => window.Web3MarketFutureLabCommunity;
  const client = () => window.Web3MarketSupabase && window.Web3MarketSupabase.getClient();
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  function message(host, text, error) {
    host.textContent = text || "";
    host.style.color = error ? "#b42318" : "#147d4b";
  }
  function button(text, cls, handler) {
    const b = el("button", cls || "flc-btn", text);
    b.type = "button";
    b.addEventListener("click", handler);
    return b;
  }
  function build() {
    if (document.getElementById("future-lab-community")) return;
    const section = el("section", "section");
    section.id = "future-lab-community";
    section.style.cssText = "background:#eef0f5;border-top:1px solid #e1e5ec;border-bottom:1px solid #e1e5ec";
    const wrap = el("div", "wrap");
    const head = el("div", "flc-head");
    head.append(el("div", "flc-kicker", "W3M COMMUNITY"), el("h2", "", "Publish. Discuss. Build the future."), el("p", "", "Share original research with the community. Every submission is reviewed by Web3Market admins before it becomes public."));
    wrap.append(head);
    const status = el("p", "flc-status", "Connecting to Web3Market account service…");
    status.setAttribute("role", "status");
    wrap.append(status);

    const formCard = el("div", "flc-panel");
    formCard.append(el("h3", "", "Submit an article for review"));
    const form = el("form", "flc-form");
    const title = el("input"); title.name = "title"; title.required = true; title.minLength = 8; title.maxLength = 180; title.placeholder = "Article title (8–180 characters)";
    const category = el("select"); category.name = "category"; category.required = true;
    category.append(new Option("Choose a category", ""));
    categories.forEach(c => category.append(new Option(c, c)));
    const summary = el("textarea"); summary.name = "summary"; summary.required = true; summary.minLength = 20; summary.maxLength = 400; summary.rows = 2; summary.placeholder = "Short summary (20–400 characters)";
    const content = el("textarea"); content.name = "content"; content.required = true; content.minLength = 80; content.maxLength = 50000; content.rows = 6; content.placeholder = "Write your article (80–50,000 characters)";
    const sources = el("input"); sources.name = "sources"; sources.maxLength = 4000; sources.placeholder = "Sources / reference links (optional)";
    const submit = el("button", "flc-btn flc-primary", "Send to admin review"); submit.type = "submit";
    const save = button("Save draft", "flc-btn", () => send("draft"));
    const formMsg = el("p", "flc-status"); formMsg.setAttribute("role", "status");
    form.append(title, category, summary, content, sources, el("div", "flc-actions"));
    form.lastChild.append(submit, save);
    form.append(formMsg);
    form.addEventListener("submit", async e => { e.preventDefault(); await send("pending_review"); });
    async function send(mode) {
      try {
        if (!service()) throw new Error("Community service is not loaded. Refresh and try again.");
        const payload = {title:title.value, category:category.value, summary:summary.value, content:content.value, sources:sources.value};
        if (mode === "draft") await service().saveDraft(payload);
        else await service().submitArticle(payload);
        form.reset();
        message(formMsg, mode === "draft" ? "Draft saved to your account." : "Submitted. An admin must approve it before publication.");
        await refresh();
      } catch (e) { message(formMsg, e.message || "Could not save this article.", true); }
    }
    formCard.append(form);
    wrap.append(formCard);

    const reviewPanel = el("div", "flc-panel"); reviewPanel.hidden = true;
    reviewPanel.append(el("h3", "", "Admin review queue"));
    const reviewList = el("div", "flc-review-list"); reviewPanel.append(reviewList);
    wrap.append(reviewPanel);

    const feed = el("div", "flc-feed");
    wrap.append(el("h3", "flc-feed-title", "Community articles"), feed);
    section.append(wrap);
    const bookSection = document.querySelector(".books");
    if (bookSection && bookSection.parentNode) bookSection.parentNode.insertBefore(section, bookSection);
    else document.querySelector("main")?.append(section);

    const style = el("style");
    style.textContent = "#future-lab-community .flc-head{max-width:760px;margin-bottom:24px}#future-lab-community .flc-kicker{font-size:11px;font-weight:900;letter-spacing:1px;color:#635bff}#future-lab-community .flc-head h2{font-size:clamp(28px,4vw,40px);margin:8px 0}#future-lab-community .flc-head p,#future-lab-community .flc-status{color:#687282;line-height:1.6}#future-lab-community .flc-panel{background:#fff;border:1px solid #e0e4eb;border-radius:18px;padding:22px;margin:20px 0}#future-lab-community .flc-form{display:grid;gap:10px}#future-lab-community input,#future-lab-community select,#future-lab-community textarea{width:100%;min-width:0;padding:12px;border:1px solid #d6dce5;border-radius:10px;background:#fff;color:#141820;font:inherit}#future-lab-community .flc-actions{display:flex;gap:10px;flex-wrap:wrap}#future-lab-community .flc-btn{padding:10px 14px;border:1px solid #d6dce5;border-radius:10px;background:#fff;color:#383f4c;font-weight:800;cursor:pointer}#future-lab-community .flc-primary{background:#635bff;color:#fff;border-color:#635bff}#future-lab-community .flc-feed{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#future-lab-community .flc-article{background:#fff;border:1px solid #e0e4eb;border-radius:16px;padding:20px;min-width:0}#future-lab-community .flc-meta{color:#737b88;font-size:12px}#future-lab-community .flc-article p{line-height:1.7;overflow-wrap:anywhere}#future-lab-community .flc-comments{border-top:1px solid #e7eaf0;margin-top:14px;padding-top:12px}#future-lab-community .flc-comment{padding:8px 0;border-bottom:1px solid #f0f1f4;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}#future-lab-community .flc-review-item{border-top:1px solid #e7eaf0;padding:14px 0}#future-lab-community .flc-feed-title{margin-top:32px}@media(max-width:680px){#future-lab-community .flc-feed{grid-template-columns:1fr}#future-lab-community .flc-panel{padding:16px}}";
    document.head.append(style);

    async function renderArticle(article) {
      const card = el("article", "flc-article");
      card.append(el("div", "flc-meta", article.category + " • " + new Date(article.published_at || article.created_at).toLocaleDateString()));
      card.append(el("h3", "", article.title));
      card.append(el("p", "", article.summary));
      const body = el("details");
      body.append(el("summary", "flc-read", "Read full article"));
      body.append(el("p", "", article.content));
      if (article.sources) body.append(el("p", "flc-meta", "Sources: " + article.sources));
      card.append(body);
      const actions = el("div", "flc-actions");
      const likeButton = button("Like", "flc-btn", async () => {
        try {
          if (!client()) throw new Error("Account service is unavailable.");
          const result = await service().toggleLike(article.id);
          likeButton.textContent = result.liked ? "Unlike" : "Like";
          await updateLikeCount(article.id, count);
        } catch (e) { message(cardStatus, e.message || "Please sign in to like articles.", true); }
      });
      const count = el("span", "flc-meta", "Likes: …");
      const cardStatus = el("p", "flc-status");
      async function updateLikeCount(id, target) {
        try { target.textContent = "Likes: " + await service().countLikes(id); } catch (_) { target.textContent = "Likes unavailable"; }
      }
      try {
        const u = await client()?.auth.getUser();
        if (u && u.data && u.data.user && await service().hasLiked(article.id)) likeButton.textContent = "Unlike";
      } catch (_) {}
      await updateLikeCount(article.id, count);
      actions.append(likeButton, count);
      card.append(actions, cardStatus);

      const comments = el("div", "flc-comments");
      comments.append(el("strong", "", "Comments"));
      const commentList = el("div");
      comments.append(commentList);
      async function loadComments() {
        commentList.replaceChildren();
        try {
          const items = await service().listComments(article.id);
          if (!items.length) commentList.append(el("p", "flc-meta", "No comments yet."));
          items.forEach(c => commentList.append(el("div", "flc-comment", c.body)));
        } catch (_) { commentList.append(el("p", "flc-meta", "Comments unavailable right now.")); }
      }
      await loadComments();
      const commentForm = el("form", "flc-form");
      const commentInput = el("textarea"); commentInput.rows = 2; commentInput.maxLength = 3000; commentInput.required = true; commentInput.placeholder = "Add a comment (members only)";
      const commentSubmit = el("button", "flc-btn", "Post comment"); commentSubmit.type = "submit";
      const commentMsg = el("p", "flc-status");
      commentForm.append(commentInput, commentSubmit, commentMsg);
      commentForm.addEventListener("submit", async e => {
        e.preventDefault();
        try { await service().addComment(article.id, commentInput.value); commentInput.value = ""; message(commentMsg, "Comment posted."); await loadComments(); }
        catch (e) { message(commentMsg, e.message || "Could not post comment.", true); }
      });
      comments.append(commentForm);
      card.append(comments);
      return card;
    }

    async function refresh() {
      if (!service()) { message(status, "Community service is unavailable. Refresh the page.", true); return; }
      try {
        const articles = await service().listPublished({limit:50});
        feed.replaceChildren();
        if (!articles.length) feed.append(el("p", "flc-meta", "No community articles have been published yet. Be the first to submit one."));
        for (const article of articles) feed.append(await renderArticle(article));
        message(status, "Connected. Member submissions are reviewed by an administrator before publication.");
        try {
          const u = await client()?.auth.getUser();
          if (u && u.data && u.data.user) {
            const profile = await client().from("profiles").select("role").eq("id", u.data.user.id).maybeSingle();
            if (!profile.error && String(profile.data?.role || "").toLowerCase() === "admin") {
              reviewPanel.hidden = false;
              const queue = await service().listReviewQueue();
              reviewList.replaceChildren();
              if (!queue.length) reviewList.append(el("p", "flc-meta", "No submissions waiting for review."));
              queue.forEach(item => {
                const row = el("div", "flc-review-item");
                row.append(el("strong", "", item.title), el("p", "flc-meta", item.category + " • " + item.status), el("p", "", item.summary));
                const note = el("textarea"); note.rows = 2; note.placeholder = "Required note for rejection or changes requested";
                const controls = el("div", "flc-actions");
                [["Publish","published"],["Request changes","changes_requested"],["Reject","rejected"]].forEach(([label,decision]) => controls.append(button(label, "flc-btn", async () => {
                  try { await service().reviewArticle(item.id, decision, note.value); message(status, "Review decision saved."); await refresh(); }
                  catch (e) { message(status, e.message || "Could not save review decision.", true); }
                })));
                row.append(note, controls); reviewList.append(row);
              });
            }
          }
        } catch (_) { reviewPanel.hidden = true; }
      } catch (e) {
        message(status, (e.message || "Could not load community articles.") + " If the community database has not been enabled yet, this feature will remain unavailable until setup is complete.", true);
        feed.replaceChildren(el("p", "flc-meta", "Community articles could not be loaded."));
      }
    }
    refresh();
  }
  function start() {
    const fallback = document.getElementById("future-lab-community-loading");
    if (fallback) fallback.remove();
    if (document.querySelector("main")) build();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once:true});
  else start();
})();