/* Web3Market authentication helpers */
"use strict";
(function(){
 const STORAGE_KEY="web3market_pending_registration";
 const PROFILE_TABLE="profiles";
 const VALID_ROLES=new Set(["buyer","seller"]);
 function getSupabaseClient(){return window.Web3MarketSupabase?.client||window.Web3MarketSupabase?.supabase||window.supabaseClient||null;}
 function normalizeEmail(email){return typeof email==="string"?email.trim().toLowerCase():"";}
 function normalizeRole(role){const value=typeof role==="string"?role.trim().toLowerCase():"";return VALID_ROLES.has(value)?value:"";}
 function isValidEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
 function normalizeWalletAddress(address){return typeof address==="string"?address.trim():"";}
 function isValidWalletAddress(address){return /^0x[a-fA-F0-9]{40}$/.test(address);}
 function savePendingRegistration(data){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({walletAddress:data.walletAddress||"",email:data.email||"",role:normalizeRole(data.role),fullName:data.fullName||"",createdAt:Date.now()}));}catch(_){} }
 function getPendingRegistration(){try{const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw):null;}catch(_){return null;}}
 function clearPendingRegistration(){try{localStorage.removeItem(STORAGE_KEY);}catch(_){}}
 function normalizeAuthError(error){const message=String(error?.message||error?.error_description||error?.msg||"Authentication failed.");const lower=message.toLowerCase();if(lower.includes("rate limit")||lower.includes("too many"))return new Error("Too many verification requests. Please wait and try again.");if(lower.includes("failed to fetch")||lower.includes("network"))return new Error("Unable to connect to Web3Market. Please check your connection and try again.");return new Error(message);}
 async function upsertProfile(client,user,walletAddress,email,role,fullName){const selectedRole=normalizeRole(role);if(!client||!user||!selectedRole)return null;const profileData={id:user.id,email:normalizeEmail(email||user.email||"")||null,wallet_address:normalizeWalletAddress(walletAddress)||null,role:selectedRole,updated_at:new Date().toISOString()};if(fullName)profileData.display_name=String(fullName).trim();const result=await client.from(PROFILE_TABLE).upsert(profileData,{onConflict:"id"}).select("id,email,role,display_name,wallet_address").maybeSingle();if(result.error)throw result.error;return result.data||null;}
 async function updateUserMetadata(client,walletAddress,role,fullName){if(!client?.auth)return null;const selectedRole=normalizeRole(role);if(!selectedRole)throw new Error("A valid Buyer or Seller role is required.");const metadata={wallet_address:normalizeWalletAddress(walletAddress),wallet_verified:Boolean(walletAddress),registration_method:walletAddress?"wallet":"email",role:selectedRole,web3market_account:true};if(fullName)metadata.full_name=String(fullName).trim();const {data,error}=await client.auth.updateUser({data:metadata});if(error)throw error;return data||null;}
 async function persistRegistration(client,user,registration){const pending=registration||getPendingRegistration()||{};const role=normalizeRole(pending.role||user?.user_metadata?.role);if(!role)throw new Error("Your account role could not be determined. Please choose Buyer or Seller.");const walletAddress=normalizeWalletAddress(pending.walletAddress||user?.user_metadata?.wallet_address||"");const email=normalizeEmail(pending.email||user?.email||"");const fullName=String(pending.fullName||user?.user_metadata?.full_name||"").trim();await updateUserMetadata(client,walletAddress,role,fullName);await upsertProfile(client,user,walletAddress,email,role,fullName);clearPendingRegistration();return {success:true,role,user};}
 async function ensureProfileForAuthenticatedUser(){const client=getSupabaseClient();if(!client?.auth)return null;const {data:userData,error:userError}=await client.auth.getUser();if(userError)throw normalizeAuthError(userError);const user=userData?.user;if(!user)return null;const {data:existing,error:profileError}=await client.from(PROFILE_TABLE).select("id,email,role,display_name,wallet_address").eq("id",user.id).maybeSingle();if(profileError)throw profileError;if(existing?.role&&normalizeRole(existing.role))return existing;const pending=getPendingRegistration()||{};const role=normalizeRole(pending.role||user.user_metadata?.role)||"buyer";const profile=await upsertProfile(client,user,pending.walletAddress||user.user_metadata?.wallet_address||"",pending.email||user.email||"",role,pending.fullName||user.user_metadata?.full_name||"");clearPendingRegistration();return profile;}
 async function registerWithWallet(registration){
  const client=getSupabaseClient();if(!client)throw new Error("Supabase client is not initialized.");
  const role=normalizeRole(registration?.role);if(!role)throw new Error("Please choose Buyer or Seller.");
  savePendingRegistration({role,email:normalizeEmail(registration?.email),fullName:registration?.fullName});
  const {data,error}=await client.auth.signInWithWeb3({chain:"ethereum",statement:"I accept the Web3Market Terms of Service and want to use this wallet to access my account."});
  if(error)throw normalizeAuthError(error);
  const user=data?.user;if(!user)throw new Error("Wallet authentication did not return a user session.");
  const identity=user.identities?.find(x=>String(x.provider||"").toLowerCase().includes("ethereum"));
  const walletAddress=normalizeWalletAddress(identity?.identity_data?.address||user.user_metadata?.wallet_address||"");
  if(!isValidWalletAddress(walletAddress))throw new Error("Wallet address could not be verified.");
  await persistRegistration(client,user,{walletAddress,email:normalizeEmail(registration?.email)||user.email||"",role,fullName:String(registration?.fullName||"").trim()});
  return {success:true,requiresEmailVerification:false,walletAddress,role,user,session:data.session||null};
 }
 async function completeRegistration(){const client=getSupabaseClient();if(!client)throw new Error("Supabase client is not initialized.");const {data,error}=await client.auth.getUser();if(error)throw normalizeAuthError(error);const user=data?.user;if(!user)return {success:false,authenticated:false};return persistRegistration(client,user,null);}
 async function getCurrentUser(){const client=getSupabaseClient();if(!client)return null;try{return (await client.auth.getUser()).data?.user||null;}catch(_){return null;}}
 async function getSession(){const client=getSupabaseClient();if(!client)return null;try{return (await client.auth.getSession()).data?.session||null;}catch(_){return null;}}
 async function signOut(){const client=getSupabaseClient();if(!client)return {error:new Error("Supabase client is not initialized.")};return client.auth.signOut();}
 window.Web3MarketAuth={registerWithWallet,completeRegistration,ensureProfileForAuthenticatedUser,getCurrentUser,getSession,signOut,normalizeRole};
})();
