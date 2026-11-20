const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePem(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error("GitHub App private key is not valid PEM.");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function derLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 255);
    value >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, value: Uint8Array): Uint8Array {
  return new Uint8Array([tag, ...derLength(value.length), ...value]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toPkcs8(pem: string): Uint8Array {
  const keyBytes = decodePem(pem);
  if (pem.includes("BEGIN PRIVATE KEY")) return keyBytes;
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("Expected an RSA GitHub App private key.");
  const rsaAlgorithm = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  return der(0x30, concat(version, rsaAlgorithm, der(0x04, keyBytes)));
}

export function buildAppJwtClaims(appId: string, nowSeconds: number) {
  if (!/^\d+$/.test(appId)) throw new Error("GitHub App ID must be numeric.");
  return { iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId };
}

export async function createGitHubAppJwt(appId: string, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify(buildAppJwtClaims(appId, nowSeconds))));
  const signingInput = header + "." + claims;
  const pkcs8 = toPkcs8(privateKeyPem);
  const keyData = new ArrayBuffer(pkcs8.byteLength);
  new Uint8Array(keyData).set(pkcs8);
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  return signingInput + "." + base64Url(signature);
}

async function githubRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error("GitHub App API request failed (" + response.status + ").");
  return payload as T;
}

export async function getGitHubInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: number;
  repositoryId: number;
}): Promise<string> {
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) throw new Error("Invalid GitHub installation ID.");
  if (!Number.isSafeInteger(input.repositoryId) || input.repositoryId <= 0) throw new Error("Invalid GitHub repository ID.");
  const jwt = await createGitHubAppJwt(input.appId, input.privateKey);
  const result = await githubRequest<{ token?: string }>(
    jwt,
    "/app/installations/" + input.installationId + "/access_tokens",
    "POST",
    {
      repository_ids: [input.repositoryId],
      permissions: { contents: "write", pull_requests: "write", metadata: "read" },
    },
  );
  if (!result.token) throw new Error("GitHub did not return an installation token.");
  return result.token;
}

export async function fetchInstallationRepositories(appJwt: string, installationId: number): Promise<any[]> {
  const installation = await githubRequest<{ token?: string }>(
    appJwt,
    "/app/installations/" + installationId + "/access_tokens",
    "POST",
    { permissions: { metadata: "read" } },
  );
  if (!installation.token) throw new Error("Unable to obtain a GitHub installation token.");
  const repositories: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await githubRequest<{ repositories?: any[]; total_count?: number }>(
      installation.token,
      "/installation/repositories?per_page=100&page=" + page,
    );
    const batch = result.repositories || [];
    repositories.push(...batch);
    if (batch.length < 100 || repositories.length >= Number(result.total_count || 0)) break;
  }
  if (repositories.length > 2000) throw new Error("Installation repository list exceeds the supported safety limit.");
  return repositories;
}

export async function fetchGitHubInstallation(appJwt: string, installationId: number): Promise<any> {
  return await githubRequest<any>(appJwt, "/app/installations/" + installationId);
}

export async function createGitHubAppJwtForServer(appId: string, privateKey: string): Promise<string> {
  return await createGitHubAppJwt(appId, privateKey);
}
