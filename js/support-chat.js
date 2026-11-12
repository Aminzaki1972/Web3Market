(function () {
  "use strict";
  const ADMIN_PAGE = /(?:^|\/)admin-support\.html$/.test(location.pathname);
  const BUCKET = "support-attachments";
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const ALLOWED = new Set(["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"]);
  let db, currentUser, currentConversation = null, selectedFile = null, refreshTimer = null, renderSequence = 0, supportAgent = false, typingChannel = null, typingTopic = null, typingTimeout = null, lastTypingSent = 0;
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
    const {data,error}=await db.from("profiles").select("id,role").eq("id",currentUser.id).maybeSingle();
    if(error)throw new Error("Support access verification failed. "+error.message);
    const role=String(data?.role||"").toLowerCase();
    if(role==="admin"){
      const {data:aal,error:ae}=await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if(ae)throw ae;
      if(aal?.currentLevel!=="aal2")throw new Error("For security, complete administrator two-factor verification in Admin Review Center, then open this inbox again.");
      supportAgent=false;
      return;
    }
    const {data:assignment,error:assignmentError}=await db.from("support_agents").select("user_id").eq("user_id",currentUser.id).maybeSingle();
    if(assignmentError)throw new Error("Limited support access could not be verified. "+assignmentError.message);
    if(!assignment)throw new Error("This account is not authorized to view the support inbox.");
    // Assigned support agents are deliberately limited to reading and replying.
    // They do not need AAL2; database RLS still blocks status changes and call signaling.
    supportAgent=true;
  }
  async function ensureUserRole(){
    const {data,error}=await db.from("profiles").select("id,role").eq("id",currentUser.id).maybeSingle();
    if(error)throw new Error("Could not verify your dashboard account. "+error.message);
    const role=String(data?.role||"").toLowerCase();
    if(!["buyer","seller"].includes(role))throw new Error("This page is only for signed-in buyer and seller dashboard accounts.");
  }
  async function getOrCreateConversation(){
    // Reuse the latest conversation, including a closed one; never silently create a new thread.
    const {data,error}=await db.from("support_conversations").select("id,user_id,subject,status,last_message_at").eq("user_id",currentUser.id).order("last_message_at",{ascending:false}).limit(1);
    if(error)throw error;
    if(data?.length)return data[0];
    const {data:created,error:ce}=await db.from("support_conversations").insert({user_id:currentUser.id,subject:"Web3Market Support"}).select("id,user_id,subject,status,last_message_at").single();
    if(ce)throw ce;return created;
  }
  async function requestNewConversation(){
    if(!currentConversation || currentConversation.status!=="closed")return;
    const button=$("supportNewConversation");button.disabled=true;
    try{
      const {data:created,error}=await db.from("support_conversations").insert({user_id:currentUser.id,subject:"Web3Market Support"}).select("id,user_id,subject,status,last_message_at").single();
      if(error)throw error;
      currentConversation=created;
      await loadUserMessages();
      if(button)button.hidden=true;
    }catch(e){say("supportError",e?.message||"Could not open a new conversation.",true);}
    finally{if(button)button.disabled=false;}
  }
  function publishSupportCallContext(){
    window.dispatchEvent(new CustomEvent("web3market:support-context",{detail:{
      conversationId:currentConversation?.id||null,
      role:supportAgent?"support-agent":(ADMIN_PAGE?"admin":"user"),
      status:currentConversation?.status||"closed"
    }}));
  }
  function clearThread(id){const el=$(id);if(el)el.replaceChildren();}
  async function signedAttachment(path){
    const {data,error}=await db.storage.from(BUCKET).createSignedUrl(path,300);
    if(error)throw error;return data?.signedUrl||null;
  }
  function ensureTypingIndicator(){
    const id=ADMIN_PAGE?"adminSupportTyping":"supportTyping";
    let indicator=$(id);if(indicator)return indicator;
    const form=$(ADMIN_PAGE?"adminSupportForm":"supportForm");if(!form)return null;
    indicator=node("div","support-typing","");indicator.id=id;indicator.hidden=true;indicator.setAttribute("role","status");indicator.setAttribute("aria-live","polite");
    form.insertAdjacentElement("beforebegin",indicator);
    if(!document.getElementById("supportReadTypingStyles")){
      const style=node("style");style.id="supportReadTypingStyles";
      style.textContent=".support-read-state{display:inline-flex;align-items:center;gap:5px;margin-left:6px;font-size:12px}.support-read-dot{display:inline-block;width:8px;height:8px;border-radius:50%;vertical-align:middle}.support-read-dot.unread{background:#dc2626}.support-read-dot.read{background:#16a34a}.support-typing{min-height:20px;padding:4px 2px;color:#64748b;font-size:13px}.support-typing[hidden]{display:none}.support-typing:after{content:' ';display:inline-block;width:14px;animation:supportDots 1s steps(4,end) infinite}@keyframes supportDots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:''}}";
      document.head.append(style);
    }
    return indicator;
  }
  function showTyping(active){
    const indicator=ensureTypingIndicator();if(!indicator)return;
    indicator.hidden=!active;
    indicator.textContent=active?(ADMIN_PAGE?"Dashboard user is typing":"Web3Market Administration is typing"):"";
  }
  async function setupTypingChannel(conversationId){
    if(typingTopic==="support-chat:"+conversationId&&typingChannel)return;
    if(typingTimeout)clearTimeout(typingTimeout);typingTimeout=null;showTyping(false);
    if(typingChannel){try{await db.removeChannel(typingChannel);}catch(_){}typingChannel=null;typingTopic=null;}
    if(!conversationId)return;
    const topic="support-chat:"+conversationId;
    const ch=db.channel(topic,{config:{private:true}});
    ch.on("broadcast",{event:"typing"},({payload})=>{
      if(!payload||payload.from===currentUser?.id)return;
      showTyping(payload.typing===true);
      if(typingTimeout)clearTimeout(typingTimeout);
      if(payload.typing===true)typingTimeout=setTimeout(()=>showTyping(false),2500);
    });
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("Typing indicator connection timed out.")),8000);
      ch.subscribe(state=>{
        if(state==="SUBSCRIBED"){clearTimeout(timeout);typingChannel=ch;typingTopic=topic;resolve();}
        else if(state==="CHANNEL_ERROR"||state==="TIMED_OUT"){clearTimeout(timeout);reject(new Error("Typing indicator is unavailable right now."));}
      });
    }).catch(async e=>{try{await db.removeChannel(ch);}catch(_){}console.warn("Support typing channel:",e.message);});
  }
  async function sendTyping(active){
    if(!typingChannel||!currentConversation)return;
    if(active&&Date.now()-lastTypingSent<900)return;
    lastTypingSent=Date.now();
    try{await typingChannel.send({type:"broadcast",event:"typing",payload:{from:currentUser.id,typing:!!active}});}catch(e){console.warn("Typing update failed:",e?.message||e);}
  }
  async function markMessagesRead(rows,conversationId){
    const incoming=(rows||[]).filter(m=>m.sender_id!==currentUser.id);
    for(const m of incoming){
      try{
        const {error}=await db.from("support_message_reads").insert({message_id:m.id,reader_id:currentUser.id});
        if(error&&error.code!=="23505")console.warn("Support read receipt failed:",error.message||error);
      }catch(e){console.warn("Support read receipt failed:",e?.message||e);}
    }
    const mine=(rows||[]).filter(m=>m.sender_id===currentUser.id).map(m=>m.id);
    if(!mine.length)return rows||[];
    const {data,error}=await db.from("support_message_reads").select("message_id,reader_id,read_at").in("message_id",mine);
    if(error){console.warn("Could not load support read receipts:",error.message||error);return rows||[];}
    const readSet=new Set((data||[]).filter(r=>r.reader_id!==currentUser.id).map(r=>r.message_id));
    return (rows||[]).map(m=>({...m,readByRecipient:readSet.has(m.id)}));
  }
  async function renderMessages(rows, threadId){
    const thread=$(threadId);if(!thread)return;
    // Ignore an older render if another conversation refresh starts while a signed URL is loading.
    const renderId=++renderSequence;
    thread.replaceChildren();
    if(!rows?.length){thread.append(node("div","empty","No messages yet. Send a message to contact Web3Market administration."));return;}
    for(const m of rows){
      const mine=m.sender_id===currentUser.id;
      const bubble=node("article","msg"+(mine?" mine":""));
      bubble.append(node("div","",m.body||""));
      if(m.attachment_path){
        try{
          const url=await signedAttachment(m.attachment_path);
          if(renderId!==renderSequence)return;
          if(url){
            const mime=String(m.attachment_mime||"");
            const link=node("a","",m.attachment_name||"Open attachment");link.href=url;link.target="_blank";link.rel="noopener noreferrer";
            if(mime.startsWith("image/")){const img=node("img","attachment");img.src=url;img.alt=m.attachment_name||"Support attachment";img.loading="lazy";bubble.append(img);}
            else if(mime.startsWith("video/")){const video=node("video","attachment attachment-video");video.src=url;video.controls=true;video.preload="metadata";bubble.append(video);}
            bubble.append(link);
          }else bubble.append(node("div","", "Attachment is unavailable."));
        }catch(_){if(renderId!==renderSequence)return;bubble.append(node("div","", "Attachment could not be opened."));}
      }
      if(renderId!==renderSequence)return;
      const senderLabel = mine ? "You" : (ADMIN_PAGE ? (currentConversation?.user_display_name || currentConversation?.user_email || "Dashboard account") : "Web3Market Administration");
      const meta=node("small","",senderLabel+" · "+dateText(m.created_at));
      if(mine){
        const receipt=node("span","support-read-state");
        const dot=node("span","support-read-dot "+(m.readByRecipient?"read":"unread"));
        dot.setAttribute("aria-label",m.readByRecipient?"Read":"Unread");
        const label=node("span","",m.readByRecipient?"Read":"Unread");
        receipt.append(dot,label);meta.append(receipt);
      }
      bubble.append(meta);
      thread.append(bubble);
    }
    thread.scrollTop=thread.scrollHeight;
  }
  async function loadUserMessages(){
    if(!currentConversation)return;
    const conversationId=currentConversation.id;
    // Refresh status so an open dashboard reflects admin close/reopen actions without a reload.
    const {data:latest,error:statusError}=await db.from("support_conversations").select("id,subject,status,last_message_at").eq("id",conversationId).maybeSingle();
    if(statusError)throw statusError;
    if(currentConversation?.id!==conversationId)return;
    if(!latest)throw new Error("This support conversation is no longer available.");
    currentConversation={...currentConversation,...latest};
    publishSupportCallContext();
    const {data,error}=await db.from("support_messages").select("id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_mime,created_at").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    if(currentConversation?.id!==conversationId)return;
    await setupTypingChannel(conversationId);
    const rowsWithReads=await markMessagesRead(data,conversationId);
    await renderMessages(rowsWithReads,"supportThread");
    if(currentConversation?.id!==conversationId)return;
    say("supportStatus","Private conversation · "+(currentConversation.status==="closed"?"Closed":"Open")+" · only you and authorized administrators can access it.");
    const closed=currentConversation.status==="closed";
    $("supportBody").disabled=closed;$("supportFile").disabled=closed;$("supportSend").disabled=closed;
    if(closed)say("supportStatus","This conversation is closed. Use “Request new conversation” if you need further help.");
    const newButton=$("supportNewConversation");if(newButton)newButton.hidden=!closed;
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
  function syncAdminConversationControls(){
    const chosen=!!currentConversation, closed=currentConversation?.status==="closed";
    const state=$("adminConversationState"), close=$("adminCloseConversation"), reopen=$("adminReopenConversation");
    if(state)state.textContent=supportAgent?"Support agent mode · replies only; administrators manage conversation status.":(!chosen?"Choose a conversation to manage its status.":(closed?"Status: Closed · replies disabled":"Status: Open · replies enabled"));
    if(close)close.disabled=supportAgent||!chosen||closed;
    if(reopen)reopen.disabled=supportAgent||!chosen||!closed;
    $("adminSupportBody").disabled=!chosen||closed;
    $("adminSupportFile").disabled=!chosen||closed;
    $("adminSupportSend").disabled=!chosen||closed;
  }
  async function setAdminConversationStatus(nextStatus){
    if(supportAgent||!currentConversation||!["open","closed"].includes(nextStatus))return;
    const conversationId=currentConversation.id;
    const close=$("adminCloseConversation"), reopen=$("adminReopenConversation");
    if(close)close.disabled=true;if(reopen)reopen.disabled=true;
    say("adminSupportError","");
    try{
      const {data,error}=await db.from("support_conversations").update({status:nextStatus}).eq("id",conversationId).select("id,user_id,subject,user_email,user_display_name,status,last_message_at").single();
      if(error)throw error;
      if(!data)throw new Error("The conversation status was not updated.");
      // Do not switch the administrator back if they selected another thread during the update.
      if(currentConversation?.id!==conversationId)return;
      currentConversation=data;
      $("adminThreadTitle").textContent=(data.user_display_name||data.user_email||shortId(data.user_id))+" · "+(data.subject||"Support conversation");
      syncAdminConversationControls();
      await loadAdminConversations();
      if(currentConversation?.id!==conversationId)return;
      await loadAdminMessages();
    }catch(e){if(currentConversation?.id===conversationId){say("adminSupportError",e?.message||"Could not update conversation status.",true);syncAdminConversationControls();}}
  }
  async function openAdminConversation(c){
    // A pending attachment must never follow the administrator into a different conversation.
    if(currentConversation?.id!==c.id){
      selectedFile=null;
      const fileInput=$("adminSupportFile");
      if(fileInput)fileInput.value="";
      say("adminSupportFileName","No file selected");
    }
    currentConversation=c;
    $("adminThreadTitle").textContent=(c.user_display_name||c.user_email||shortId(c.user_id))+" · "+(c.subject||"Support conversation");
    $("adminSupportError").textContent="";
    syncAdminConversationControls();
    await loadAdminMessages();await loadAdminConversations();
  }
  async function loadAdminMessages(){
    if(!currentConversation)return;
    // Capture the target before awaiting; discard stale query results after a thread switch.
    const conversationId=currentConversation.id;
    const ownerId=currentConversation.user_id;
    publishSupportCallContext();
    const {data,error}=await db.from("support_messages").select("id,conversation_id,sender_id,body,attachment_path,attachment_name,attachment_mime,created_at").eq("conversation_id",conversationId).order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    if(currentConversation?.id!==conversationId)return;
    await setupTypingChannel(conversationId);
    const rowsWithReads=await markMessagesRead(data,conversationId);
    const thread=$("adminSupportThread");await renderMessages(rowsWithReads,"adminSupportThread");
    if(currentConversation?.id!==conversationId)return;
    thread.querySelectorAll(".msg").forEach((el,i)=>{if(data?.[i]&&data[i].sender_id===ownerId)el.classList.add("user-message");});
    say("adminSupportStatus",supportAgent?"Support agent access verified · replies only.":"Administrator access verified · private support inbox.");
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
      // Pin the destination before any upload/network await so a fast conversation switch
      // cannot pair an attachment path from one thread with a message in another.
      const conversation=currentConversation;
      let attachment_path=null,attachment_name=null,attachment_mime=null;
      if(file){
        const convId=conversation.id;
        const safe=escName(file.name);
        attachment_path=convId+"/"+conversation.user_id+"/"+crypto.randomUUID()+"-"+safe;
        attachment_name=file.name;attachment_mime=file.type;
        const {error:upErr}=await db.storage.from(BUCKET).upload(attachment_path,file,{contentType:file.type,upsert:false});
        if(upErr)throw new Error("Attachment upload failed: "+upErr.message);
      }
      const payload={conversation_id:conversation.id,sender_id:currentUser.id,body,attachment_path,attachment_name,attachment_mime};
      const {data:insertedMessage,error}=await db.from("support_messages").insert(payload).select("id").single();if(error)throw error;
      // Notify the platform owner when a buyer/seller sends support a message. Email failure must not undo the saved message.
      if(!admin&&insertedMessage?.id){
        try{
          const {error:notifyError}=await db.functions.invoke("admin-support-email-notification",{body:{message_id:insertedMessage.id,conversation_id:conversation.id}});
          if(notifyError)console.warn("Web3Market support email notification failed:",notifyError.message||notifyError);
        }catch(notifyError){console.warn("Web3Market support email notification failed:",notifyError);}
      }
      // Clear the draft only if the sender is still viewing the conversation that received it.
      // Switching threads during an upload must not erase a different thread's draft.
      if(currentConversation?.id===conversation.id){
        $(bodyId).value="";
        if(selectedFile===file){selectedFile=null;$(fileId).value="";const fileLabel=$(fileId+"Name");if(fileLabel)fileLabel.textContent="No file selected";}
        if(admin)await loadAdminMessages();else await loadUserMessages();
      }else if(selectedFile===file){
        selectedFile=null;$(fileId).value="";const fileLabel=$(fileId+"Name");if(fileLabel)fileLabel.textContent="No file selected";
      }
      // Refresh the inbox list independently; never redraw a different selected thread.
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
    $("supportForm").addEventListener("submit",e=>{e.preventDefault();void sendTyping(false);sendMessage("supportBody","supportFile","supportSend","supportError",false);});
    $("supportBody").addEventListener("input",()=>{void sendTyping(!!$("supportBody").value.trim());});
    $("supportNewConversation").addEventListener("click",requestNewConversation);
    setupFileInput("supportFile","supportFileName");
    await loadUserMessages();
    refreshTimer=setInterval(async()=>{try{await loadUserMessages();}catch(e){say("supportError",e.message,true);}},10000);
  }
  async function startAdmin(){
    await sessionOrThrow();await ensureAdmin();
    if(supportAgent){
      const eyebrow=document.querySelector(".head > div > p");
      if(eyebrow)eyebrow.textContent="WEB3MARKET · SUPPORT TEAM";
      const heading=document.querySelector(".head h1");
      if(heading)heading.textContent="Support Inbox";
      const description=document.querySelector(".head .muted");
      if(description)description.textContent="Limited access: read support conversations and reply only. Conversation status and all other administration remain restricted.";
      const adminLink=document.querySelector('.head a[href="admin-review.html"]');
      if(adminLink)adminLink.hidden=true;
      const stateRow=$("adminConversationState")?.parentElement;
      if(stateRow)stateRow.querySelectorAll("button").forEach(button=>button.hidden=true);
      if($("adminConversationState"))$("adminConversationState").textContent="Support agent mode · replies only; administrators manage conversation status.";
    }
    $("adminSupportForm").addEventListener("submit",e=>{e.preventDefault();void sendTyping(false);sendMessage("adminSupportBody","adminSupportFile","adminSupportSend","adminSupportError",true);});
    $("adminSupportBody").addEventListener("input",()=>{void sendTyping(!!$("adminSupportBody").value.trim());});
    setupFileInput("adminSupportFile","adminSupportFileName");
    $("adminCloseConversation").addEventListener("click",()=>setAdminConversationStatus("closed"));
    $("adminReopenConversation").addEventListener("click",()=>setAdminConversationStatus("open"));
    syncAdminConversationControls();
    await loadAdminConversations();
    refreshTimer=setInterval(async()=>{try{await loadAdminConversations();const conversationId=currentConversation?.id;if(conversationId){const {data,error}=await db.from("support_conversations").select("id,user_id,subject,user_email,user_display_name,status,last_message_at").eq("id",conversationId).maybeSingle();if(error)throw error;if(data&&currentConversation?.id===conversationId){currentConversation=data;syncAdminConversationControls();await loadAdminMessages();}}}catch(e){say("adminSupportError",e.message,true);}},10000);
  }
  async function bootSupportChat(){
    window.__web3marketSupportBootStarted=true;
    const status=ADMIN_PAGE?"adminSupportStatus":"supportStatus";
    const thread=ADMIN_PAGE?"adminSupportThread":"supportThread";
    try{
      say(status,"Connecting to the private support inbox…");
      if(ADMIN_PAGE) await startAdmin(); else await startUser();
    }catch(e){
      const message=e?.message||"Unable to initialize support chat.";
      console.error("Web3Market support initialization failed:",e);
      say(status,message,true);
      if($(thread))$(thread).replaceChildren(node("div","empty",message));
    }finally{
      window.__web3marketSupportBootFinished=true;
    }
  }
  // Scripts may execute after DOMContentLoaded on slow/cached navigations.
  // Start immediately when the document is already ready; otherwise wait once.
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bootSupportChat,{once:true});
  }else{
    bootSupportChat();
  }
  window.addEventListener("beforeunload",()=>{if(refreshTimer)clearInterval(refreshTimer);if(typingTimeout)clearTimeout(typingTimeout);if(typingChannel)try{void db?.removeChannel(typingChannel);}catch(_){};});
})();