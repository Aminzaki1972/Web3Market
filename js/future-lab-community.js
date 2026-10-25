/* Web3Market Future Lab Community data service.
 * Draft integration module only: not loaded by future-lab.html yet.
 * Requires the existing js/supabase.js unified client and the reviewed community schema.
 * All authorization must remain enforced by Supabase RLS; UI checks are not a security boundary.
 */
(function (root) {
  "use strict";

  const TABLES = Object.freeze({
    articles: "future_lab_articles",
    comments: "future_lab_comments",
    likes: "future_lab_likes",
    profiles: "profiles"
  });
  const CATEGORIES = new Set([
    "Web3", "AI", "Smart Contracts", "Security", "Research", "Development"
  ]);
  const ARTICLE_FIELDS = "id,author_id,title,category,summary,content,sources,status,moderation_note,reviewed_by,reviewed_at,published_at,created_at,updated_at";

  function getClient() {
    const api = root.Web3MarketSupabase;
    const client = api && typeof api.getClient === "function" ? api.getClient() : root.web3marketSupabase || root.supabaseClient;
    if (!client || !client.auth || typeof client.from !== "function") {
      throw new Error("Web3Market account service is not ready. Refresh the page and sign in again.");
    }
    return client;
  }

  async function currentUser(client) {
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    if (!result.data || !result.data.user) throw new Error("Sign in to use Future Lab community features.");
    return result.data.user;
  }

  function checked(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  function cleanArticle(input) {
    const value = input || {};
    const title = String(value.title || "").trim();
    const category = String(value.category || "").trim();
    const summary = String(value.summary || "").trim();
    const content = String(value.content || "").trim();
    const sources = String(value.sources || "").trim();
    if (title.length < 8 || title.length > 180) throw new Error("Title must be 8–180 characters.");
    if (!CATEGORIES.has(category)) throw new Error("Choose a valid Future Lab category.");
    if (summary.length < 20 || summary.length > 400) throw new Error("Summary must be 20–400 characters.");
    if (content.length < 80 || content.length > 50000) throw new Error("Article content must be 80–50,000 characters.");
    return { title, category, summary, content, sources };
  }

  async function ensureAdmin(client, user) {
    const result = await client.from(TABLES.profiles).select("role").eq("id", user.id).maybeSingle();
    const profile = checked(result);
    if (!profile || String(profile.role || "").toLowerCase() !== "admin") {
      throw new Error("Administrator access is required. Database policies also enforce this permission.");
    }
    return user;
  }

  const service = {
    async listPublished(options) {
      const client = getClient();
      const limit = Math.min(100, Math.max(1, Number(options && options.limit) || 30));
      let query = client.from(TABLES.articles)
        .select("id,author_id,title,category,summary,content,sources,status,published_at,created_at,updated_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      if (options && options.category && CATEGORIES.has(options.category)) query = query.eq("category", options.category);
      return checked(await query) || [];
    },

    async getArticle(articleId) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      return checked(await client.from(TABLES.articles).select(ARTICLE_FIELDS).eq("id", articleId).maybeSingle());
    },

    async submitArticle(input) {
      const client = getClient();
      const user = await currentUser(client);
      const article = cleanArticle(input);
      const result = await client.from(TABLES.articles).insert({
        ...article,
        author_id: user.id,
        status: "pending_review"
      }).select(ARTICLE_FIELDS).single();
      return checked(result);
    },

    async saveDraft(input) {
      const client = getClient();
      const user = await currentUser(client);
      const article = cleanArticle(input);
      const result = await client.from(TABLES.articles).insert({
        ...article,
        author_id: user.id,
        status: "draft"
      }).select(ARTICLE_FIELDS).single();
      return checked(result);
    },

    async updateOwnArticle(articleId, input, status) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      const user = await currentUser(client);
      const article = cleanArticle(input);
      const nextStatus = status === "pending_review" ? "pending_review" : "draft";
      const result = await client.from(TABLES.articles)
        .update({ ...article, status: nextStatus, moderation_note: null, reviewed_by: null, reviewed_at: null, published_at: null })
        .eq("id", articleId)
        .eq("author_id", user.id)
        .select(ARTICLE_FIELDS)
        .single();
      return checked(result);
    },

    async listComments(articleId) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      const result = await client.from(TABLES.comments)
        .select("id,article_id,author_id,body,created_at,updated_at")
        .eq("article_id", articleId)
        .order("created_at", { ascending: true })
        .limit(200);
      return checked(result) || [];
    },

    async addComment(articleId, body) {
      if (!articleId) throw new Error("Article ID is required.");
      const text = String(body || "").trim();
      if (!text || text.length > 3000) throw new Error("Comment must be 1–3,000 characters.");
      const client = getClient();
      const user = await currentUser(client);
      return checked(await client.from(TABLES.comments)
        .insert({ article_id: articleId, author_id: user.id, body: text })
        .select("id,article_id,author_id,body,created_at,updated_at")
        .single());
    },

    async listLikes(articleId) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      const result = await client.from(TABLES.likes).select("article_id,user_id,created_at").eq("article_id", articleId).limit(5000);
      return checked(result) || [];
    },

    async hasLiked(articleId) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      const user = await currentUser(client);
      const result = await client.from(TABLES.likes).select("article_id").eq("article_id", articleId).eq("user_id", user.id).maybeSingle();
      return !!checked(result);
    },

    async toggleLike(articleId) {
      if (!articleId) throw new Error("Article ID is required.");
      const client = getClient();
      const user = await currentUser(client);
      const existing = checked(await client.from(TABLES.likes).select("article_id").eq("article_id", articleId).eq("user_id", user.id).maybeSingle());
      if (existing) {
        checked(await client.from(TABLES.likes).delete().eq("article_id", articleId).eq("user_id", user.id));
        return { liked: false };
      }
      checked(await client.from(TABLES.likes).insert({ article_id: articleId, user_id: user.id }));
      return { liked: true };
    },

    async listReviewQueue() {
      const client = getClient();
      const user = await currentUser(client);
      await ensureAdmin(client, user);
      return checked(await client.from(TABLES.articles)
        .select(ARTICLE_FIELDS)
        .in("status", ["pending_review", "changes_requested"])
        .order("created_at", { ascending: true })
        .limit(200)) || [];
    },

    async reviewArticle(articleId, decision, note) {
      if (!articleId) throw new Error("Article ID is required.");
      const allowed = new Set(["published", "rejected", "changes_requested"]);
      if (!allowed.has(decision)) throw new Error("Unsupported moderation decision.");
      const client = getClient();
      const user = await currentUser(client);
      await ensureAdmin(client, user);
      const moderationNote = String(note || "").trim().slice(0, 2000);
      if (decision !== "published" && !moderationNote) throw new Error("Add a moderation note for a rejection or requested changes.");
      const patch = {
        status: decision,
        moderation_note: moderationNote || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        published_at: decision === "published" ? new Date().toISOString() : null
      };
      return checked(await client.from(TABLES.articles).update(patch).eq("id", articleId)
        .in("status", ["pending_review", "changes_requested"]).select(ARTICLE_FIELDS).single());
    }
  };

  root.Web3MarketFutureLabCommunity = Object.freeze(service);
})(window);
