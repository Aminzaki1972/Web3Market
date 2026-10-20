(function () {
  "use strict";
  const ADMIN_PAGE = /(?:^|\/)admin-support\.html$/.test(location.pathname);
  const BUCKET = "support-attachments";
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const ALLOWED = new Set(["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"]);
  let db, currentUser, currentConversation = null, selectedFile = null, refreshTimer = null;
  const $ = id => document.getElementById(id);
  const say = (id, text, error=false) => { const el=$(id); if(el){el.textContent=text||"";el.style.color=error?"#b91c1c":"";} };
  const escName = name => String(name||"attachment").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,90) || "attachment";
  function getClient(){return window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.supabaseClient||window.web3marketSupabase||null;}
  function node(tag, cls, text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
  function shortId(id){return id?String(id).slice(0,8)+"…"+String(id).slice(-4):"unknown account";}
  function dateText(value){try{return new Date(value).toLocaleString()}catch(_){return ""}}
  async function sessionOrThrow(){
    for(let i=0;i<30&&!db;i++){db=getClient();if(!db)await new Promise(r=>setTimeout(r,100));}
    if(!db?.auth)throw new Error("Secure connection unavailable. Reload the page and try again.");
    const {data,error}=await db.auth.getSession();if(error)throw error;
    currentUser=data?.session?.user||null;
    if(!currentUser)throw new Error("Please sign in to your Web3Market account first.");
  }
  async function ensureAdmin(){
    // Match the database RLS authority source: public.is_admin() checks profiles.role.
    const {data,error}=await db.from("profiles").select("id,role").eq("id",currentUser.id).maybeSingle();
    if(error)throw new Error("Administrator verification failed. "+error.message);
    if(String(data?.role||"").toLowerCase()!=="admin")throw new Error("This account is not authorized to view the administrator inbox.");
    const {data:aal,error:ae}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if(ae)throw ae;
    if(aal?.currentLevel!=="aal2")throw new Error("For security, complete administrator two-factor verification in Admin Review Center, then open this inbox again.");
  }
  async function ensureUserRole(){
    const {data,error}=await db.from("profiles").select("id,role").eq("id",currentUser.id).maybeSingle();
    if(error)throw new Error("Could not verify your dashboard account. "+error.message);
    const role=String(data?.role||"").toLowerCase();
    if(!["buyer","seller"].includes(role))throw new Error("This page is only for signed-in buyer and seller dashboard accounts.");
  }
  async function getOrCreateConversation(){
    const {data,error}=await db.from("support_conversations").select("id,subject,status,last_message_at").eq("user_id",currentUser.id).eq("status","open").order("last_message_at",{ascending:false}).limit(1);
    if(error)throw error;
    if(data?.length)return data[0];
    const {data:created,error:ce}=await db.from("support_conversations").insert({user_id:currentUser.id,subject:"Web3Market Support"}).select("id,subject,status,last_message_at").single();
    if(ce)throw ce;return created;
  }
  function clearThread(id){const el=$(id);if(el)el.replaceChildren();}
  async function signedAttachment(path){
    const {data,error}=await db.storage.from(BUCKET).createSignedUrl(path,300);
    if(error)throw error;return data?.signedUrl||null;
  }
  async function renderMessages(rows, threadId){
    const thread=$(threadId);if(!thread)return;
    thread.replaceChildren();
    if(!rows?.length){thread.append(node("div","empty","No messages yet. Send a message to contact Web3Market administration."));return;}
    for(const m of rows){
      const mine=m.sender_id===currentUser.id;
      const bubble=node("article","msg"+(mine?" mine":""));
      bubble.append(node("div","",m.body||""));
      if(m.attachment_path){
        try{
          const url=await signedAttachment(m.attachment_path);
          if(url){
            const mime=String(m.attachment_mime||"");
            const link=node("a","",m.attachment_name||"Open attachment");link.href=url;link.target="_blank";link.rel="noopener noreferrer";
            if(mime.startsWith("image/")){const img=node("img","attachment");img.src=url;img.alt=m.attachment_name||"Support attachment";img.loading="lazy";bubble.append(img);}
            else if(mime.startsWith("video/")){const video=node("video","attachment attachment-video");video.src=url;video.controls=true;video.preload="metadata";bubble.append(video);}
            bubble.append(link);
          }else bubble.append(node("div","", "Attachment is unavailable."));
        }catch(_){bubble.append(node("div","", "Attachment could not be opened."));}
      }
      const senderLabel = mine ? "You" : (ADMIN_PAGE ? (currentConversation?.user_display_name || currentConversation?.user_email || "Dashboard account") : "Web3Market Administration");
      bubble.append(node("small","",senderLabel+" · "+dateText(m.created_at)));
      thread.append(bubble);
    }
    thread.scrollTop=thread.scrollHeight;
  }
  async function loadUserMessages(){
    if(!currentConversation)return;
    const {data,error}=await db.from("support_messages").select("id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_mime,created_at").eq("conversation_id",currentConversation.id).order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    await renderMessages(data,"supportThread");
    say("supportStatus","Private conversation · "+(currentConversation.status==="closed"?"Closed":"Open")+" · only you and authorized administrators can access it.");
    const closed=currentConversation.status==="closed";
    $("supportBody").disabled=closed;$("supportFile").disabled=closed;$("supportSend").disabled=closed;
    if(closed)say("supportStatus","This conversation is closed. Contact support to request a new conversation.");
  }
  async function loadAdminConversations(){
    const {data,error}=await db.from("support_conversations").select("id,user_id,subject,user_email,user_display_name,status,last_message_at").order("last_message_at",{ascending:false}).limit(200);
    if(error)throw error;
    const list=$("adminConversationList");list.replaceChildren();
    if(!data?.length){list.append(node("div","empty","No support conversations yet."));return;}
    data.forEach(c=>{
      const b=node("button","conversation"+(currentConversation?.id===c.id?" active":""));
      b.type="button";b.append(node("strong","",c.user_display_name||c.user_email||shortId(c.user_id)));
      b.append(node("small","",(c.user_email||shortId(c.user_id))+" · "+c.status+" · "+dateText(c.last_message_at)));
      b.addEventListener("click",()=>openAdminConversation(c));list.append(b);
    });
  }
  async function openAdminConversation(c){
    currentConversation=c;
    $("adminThreadTitle").textContent=(c.user_display_name||c.user_email||shortId(c.user_id))+" · "+(c.subject||"Support conversation");
    $("adminSupportBody").disabled=false;$("adminSupportFile").disabled=false;$("adminSupportSend").disabled=false;
    $("adminSupportError").textContent="";
    await loadAdminMessages();await loadAdminConversations();
  }
  async function loadAdminMessages(){
    if(!currentConversation)return;
    const {data,error}=await db.from("support_messages").select("id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_mime,created_at").eq("conversation_id",currentConversation.id).order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    const thread=$("adminSupportThread");await renderMessages(data,"adminSupportThread");
    thread.querySelectorAll(".msg").forEach((el,i)=>{if(data?.[i]&&data[i].sender_id===currentConversation.user_id)el.classList.add("user-message");});
    say("adminSupportStatus","Administrator access verified · private support inbox.");
  }
  async function sendMessage(bodyId,fileId,sendId,errorId,admin){
    const body=$(bodyId).value.trim(), file=selectedFile;
    if(!body&&!file){say(errorId,"Write a message or attach a photo/video.",true);return;}
    if(file){
      if(!ALLOWED.has(file.type)){say(errorId,"That file type is not allowed. Choose an image or video.",true);return;}
      if(file.size>MAX_FILE_BYTES){say(errorId,"The file exceeds the 20 MB limit.",true);return;}
    }
    const button=$(sendId);button.disabled=true;say(errorId,"");
    try{
      if(!currentConversation){currentConversation=await getOrCreateConversation();}
      let attachment_path=null,attachment_name=null,attachment_mime=null;
      if(file){
        const convId=currentConversation.id;
        const safe=escName(file.name);
        attachment_path=convId+"/"+currentConversation.user_id+"/"+crypto.randomUUID()+"-"+safe;
        attachment_name=file.name;attachment_mime=file.type;
        const {error:upErr}=await db.storage.from(BUCKET).upload(attachment_path,file,{contentType:file.type,upsert:false});
        if(upErr)throw new Error("Attachment upload failed: "+upErr.message);
      }
      const payload={conversation_id:currentConversation.id,sender_id:currentUser.id,body,attachment_path,attachment_name,attachment_mime};
      const {error}=await db.from("support_messages").insert(payload);if(error)throw error;
      $(bodyId).value="";selectedFile=null;$(fileId).value="";$(fileId+"Name") && ($(fileId+"Name").textContent="No file selected");
      if(admin)await loadAdminMessages();else await loadUserMessages();
      if(admin)await loadAdminConversations();
      say(errorId,"");
    }catch(e){say(errorId,e?.message||"Could not send the message.",true);}
    finally{button.disabled=false;}
  }
  function setupFileInput(inputId,nameId){
    const input=$(inputId);if(!input)return;
    input.addEventListener("change",()=>{selectedFile=input.files?.[0]||null;const label=$(nameId);if(label)label.textContent=selectedFile?selectedFile.name+" · "+Math.ceil(selectedFile.size/1024)+" KB":"No file selected";});
  }
  async function startUser(){
    await sessionOrThrow();await ensureUserRole();
    currentConversation=await getOrCreateConversation();
    $("supportForm").addEventListener("submit",e=>{e.preventDefault();sendMessage("supportBody","supportFile","supportSend","supportError",false);});
    setupFileInput("supportFile","supportFileName");
    await loadUserMessages();
    refreshTimer=setInterval(async()=>{try{await loadUserMessages();}catch(e){say("supportError",e.message,true);}},10000);
  }
  async function startAdmin(){
    await sessionOrThrow();await ensureAdmin();
    $("adminSupportForm").addEventListener("submit",e=>{e.preventDefault();sendMessage("adminSupportBody","adminSupportFile","adminSupportSend","adminSupportError",true);});
    setupFileInput("adminSupportFile","adminSupportFileName");
    await loadAdminConversations();
    refreshTimer=setInterval(async()=>{try{await loadAdminConversations();if(currentConversation)await loadAdminMessages();}catch(e){say("adminSupportError",e.message,true);}},10000);
  }
  document.addEventListener("DOMContentLoaded",async()=>{
    try{if(ADMIN_PAGE)await startAdmin();else await startUser();}
    catch(e){const status=ADMIN_PAGE?"adminSupportStatus":"supportStatus";say(status,e?.message||"Unable to initialize support chat.",true);const thread=ADMIN_PAGE?"adminSupportThread":"supportThread";if($(thread))$(thread).replaceChildren(node("div","empty",e?.message||"Unable to initialize support chat."));}
  });
  window.addEventListener("beforeunload",()=>{if(refreshTimer)clearInterval(refreshTimer);});
})();