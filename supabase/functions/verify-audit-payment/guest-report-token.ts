export function toBase64(bytes:Uint8Array){let binary="";for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary);}
export function fromBase64(value:string){const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export async function importGuestTokenKey(secret:string){
  if(secret.length<32)throw new Error("Guest report token encryption requires a random secret of at least 32 characters.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
export async function encryptGuestToken(token:string,key:CryptoKey){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(token));
  return {ciphertext:toBase64(new Uint8Array(encrypted)),iv:toBase64(iv)};
}
export async function decryptGuestToken(ciphertext:string,iv:string,key:CryptoKey){
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(iv)},key,fromBase64(ciphertext));
  return new TextDecoder().decode(plain);
}
