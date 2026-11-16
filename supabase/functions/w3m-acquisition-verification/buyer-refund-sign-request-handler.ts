// W3M Protocol V1 — isolated, fail-closed buyer-refund Safe SIGN boundary.
// Separate from seller-release SIGN. All identity, role, Safe owners, request and
// decision bindings are freshly loaded by trusted server dependencies. No broadcast.
export interface BuyerRefundSignContext {
  action: "refund_to_buyer";
  dealId: string;
  disputeId: string;
  requestId: string;
  decisionId: string;
  decisionHash: string;
  termsHash: string;
  safeTransactionHash: string;
  safeAddress: string;
  chainId: 56;
  safeNonce: string;
  currentOwners: string[];
  threshold: number;
  verifiedWallet: string;
  buyerWallet: string;
  w3mAuthorization: { authorized: true; phase: "SIGN"; requestId: string; safeTransactionHash: string; issues: [] };
  signerRole: "buyer" | "seller";
  status: "awaiting_signatures" | "signed" | "executed" | "cancelled";
}
export interface BuyerRefundSignDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  loadFreshContext(input: { actorId: string; dealId: string; requestId: string; decisionId: string; safeTransactionHash: string }): Promise<BuyerRefundSignContext>;
  verifySafeDigest(input: { digest: string; signature: string; expectedWallet: string }): Promise<boolean>;
  persistSignatureAtomically(input: {
    actorId: string; dealId: string; requestId: string; decisionId: string; decisionHash: string;
    termsHash: string; safeTransactionHash: string; safeAddress: string; buyerWallet: string;
    authorization: { authorized: true; phase: "SIGN"; requestId: string; safeTransactionHash: string; issues: [] };
    safeNonce: string; signature: string; verifiedWallet: string;
    signerRole: "buyer" | "seller";
  }): Promise<{ recorded: boolean; idempotentReplay: boolean; confirmationsCount: number; requiredSignatures: 2; status: "awaiting_signatures" | "signed" }>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const SIGNATURE=/^0x[0-9a-f]{130}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export function createBuyerRefundSignRequestHandler(deps:BuyerRefundSignDependencies) {
 return async (request:Request):Promise<Response>=>{
  if(request.method!=="POST")return json(405,{ok:false,error:"POST_REQUIRED"});
  let actor:{userId:string}|null;
  try{actor=await deps.authenticate(request)}catch{return json(401,{ok:false,error:"AUTHENTICATION_FAILED"})}
  if(!actor||!UUID.test(actor.userId))return json(401,{ok:false,error:"AUTHENTICATION_REQUIRED"});
  let body:Record<string,unknown>;
  try{const value:unknown=await request.json();if(!value||typeof value!=="object"||Array.isArray(value))throw 0;body=value as Record<string,unknown>}catch{return json(400,{ok:false,error:"INVALID_JSON"})}
  const allowedKeys=["deal_id","request_id","decision_id","safe_tx_hash","signature"];
  if(Object.keys(body).length!==allowedKeys.length||Object.keys(body).some(key=>!allowedKeys.includes(key)))return json(400,{ok:false,error:"ONLY_REFUND_SIGN_FIELDS_ARE_ACCEPTED"});
  const dealId=body.deal_id,requestId=body.request_id,decisionId=body.decision_id,txHash=body.safe_tx_hash,signature=body.signature;
  if(typeof dealId!=="string"||!UUID.test(dealId)||typeof requestId!=="string"||!UUID.test(requestId)||typeof decisionId!=="string"||!UUID.test(decisionId)||typeof txHash!=="string"||!HASH.test(txHash)||typeof signature!=="string"||!SIGNATURE.test(signature))return json(400,{ok:false,error:"INVALID_BUYER_REFUND_SIGN_REQUEST"});
  try{
   const c=await deps.loadFreshContext({actorId:actor.userId,dealId,requestId,decisionId,safeTransactionHash:txHash});
   if(c.action!=="refund_to_buyer"||c.dealId!==dealId||c.requestId!==requestId||c.decisionId!==decisionId||c.safeTransactionHash.toLowerCase()!==txHash.toLowerCase()||c.chainId!==56||c.status!=="awaiting_signatures")return json(409,{ok:false,error:"REFUND_REQUEST_CONTEXT_MISMATCH"});
   if(!HASH.test(c.decisionHash)||!/^([0-9a-f]{64})$/i.test(c.termsHash)||!ADDRESS.test(c.safeAddress)||!ADDRESS.test(c.verifiedWallet)||!ADDRESS.test(c.buyerWallet)||!/^([0-9]+)$/.test(c.safeNonce))return json(409,{ok:false,error:"REFUND_SIGN_CONTEXT_INVALID"});
   if(c.signerRole!=="buyer"&&c.signerRole!=="seller")return json(403,{ok:false,error:"REFUND_SIGNER_ROLE_INVALID"});
   if((c.signerRole==="buyer"&&c.verifiedWallet.toLowerCase()!==c.buyerWallet.toLowerCase())||
      (c.signerRole==="seller"&&c.verifiedWallet.toLowerCase()===c.buyerWallet.toLowerCase()))return json(403,{ok:false,error:"REFUND_SIGNER_WALLET_ROLE_MISMATCH"});
   const owners=c.currentOwners.map(x=>x.toLowerCase());
   if(owners.length!==3||new Set(owners).size!==3||owners.some(x=>!ADDRESS.test(x))||!owners.includes(c.verifiedWallet.toLowerCase())||c.threshold!==2)return json(409,{ok:false,error:"LIVE_SAFE_OWNER_SET_OR_THRESHOLD_INVALID"});
   if(await deps.verifySafeDigest({digest:txHash.slice(2),signature,expectedWallet:c.verifiedWallet})!==true)return json(403,{ok:false,error:"SAFE_SIGNATURE_INVALID"});
   const auth=c.w3mAuthorization;
   if(!auth||auth.authorized!==true||auth.phase!=="SIGN"||auth.requestId!==requestId||auth.safeTransactionHash.toLowerCase()!==txHash.toLowerCase()||!Array.isArray(auth.issues)||auth.issues.length!==0)return json(409,{ok:false,error:"W3M_REFUND_SIGN_AUTHORIZATION_INVALID"});
   const saved=await deps.persistSignatureAtomically({actorId:actor.userId,dealId,requestId,decisionId,decisionHash:c.decisionHash,termsHash:c.termsHash,safeTransactionHash:txHash.toLowerCase(),safeAddress:c.safeAddress.toLowerCase(),safeNonce:c.safeNonce,signature:signature.toLowerCase(),verifiedWallet:c.verifiedWallet.toLowerCase(),signerRole:c.signerRole,buyerWallet:c.buyerWallet.toLowerCase(),authorization:auth});
   if(!saved||saved.recorded!==true||typeof saved.idempotentReplay!=="boolean"||saved.requiredSignatures!==2||!Number.isInteger(saved.confirmationsCount)||saved.confirmationsCount<1||saved.confirmationsCount>2||(saved.status!=="awaiting_signatures"&&saved.status!=="signed"))return json(502,{ok:false,error:"ATOMIC_REFUND_SIGN_PERSISTENCE_INVALID"});
   return json(200,{ok:true,recorded:true,idempotent_replay:saved.idempotentReplay,confirmations_count:saved.confirmationsCount,required_signatures:2,status:saved.status});
  }catch{return json(409,{ok:false,error:"BUYER_REFUND_SIGN_FAIL_CLOSED"})}
 };
}
