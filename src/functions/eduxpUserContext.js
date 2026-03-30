// eduxpUserContext.js — Azure Functions v4
// Gerencia foto de perfil do usuário: Dataverse (blob URL) → Office 365 Graph → fallback 404
const { app } = require("@azure/functions");
const https = require("https");
const querystring = require("querystring");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");
const { Readable } = require("stream");
const { listRecords, updateRecord } = require("../shared/dataverseCrud");

const TABLE_USUARIO   = "eduxp_usuarios";
const COL_FOTO        = "eduxp_fotoperfil";
const COL_USUARIO_ID  = "eduxp_usuarioid";
const COL_EMAIL       = "eduxp_email";

const CONTAINER_NAME  = process.env.BLOB_CONTAINER || "app-package-pnld-4ff16a8";
const SAS_HOURS       = Number(process.env.SAS_HOURS || 12);

const CORS = { "Access-Control-Allow-Origin": "*" };

// ─── Blob helpers ────────────────────────────────────────────────────────────

function parseConnectionString(connStr) {
  const r = {};
  for (const part of connStr.split(";")) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    r[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return r;
}

function getSharedKey() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING não definida");
  const parts = parseConnectionString(connStr);
  if (!parts.AccountName || !parts.AccountKey) throw new Error("Falha ao extrair AccountName/AccountKey");
  return {
    accountName: parts.AccountName,
    sharedKey: new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey)
  };
}

function buildPermanentUrl(accountName, blobName) {
  return `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${blobName}`;
}

function buildSasUrl(accountName, sharedKey, blobName) {
  const expiresOn = new Date(Date.now() + SAS_HOURS * 60 * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    { containerName: CONTAINER_NAME, blobName, permissions: BlobSASPermissions.parse("r"), expiresOn },
    sharedKey
  ).toString();
  return `${buildPermanentUrl(accountName, blobName)}?${sas}`;
}

// Extrai blobName da URL permanente armazenada
function blobNameFromUrl(url) {
  try {
    const u = new URL(url);
    // pathname = /{container}/{blobName}
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join("/"); // tudo após o container
  } catch { /* noop */ }
  return null;
}

// ─── MS Graph helper ─────────────────────────────────────────────────────────

let graphToken = null;
let graphTokenExpiresOn = 0;

async function getGraphToken() {
  const now = Date.now();
  if (graphToken && now < graphTokenExpiresOn - 60_000) return graphToken;

  const tenantId     = process.env.DATAVERSE_TENANT_ID;
  const clientId     = process.env.DATAVERSE_CLIENT_ID;
  const clientSecret = process.env.DATAVERSE_CLIENT_SECRET;

  const body = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });

  const resp = await new Promise((resolve, reject) => {
    const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`);
    const req = https.request({
      method: "POST",
      hostname: url.hostname,
      path: url.pathname,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) return reject(new Error(`Graph token error ${res.statusCode}: ${text}`));
        resolve(JSON.parse(text));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  graphToken = resp.access_token;
  graphTokenExpiresOn = now + (resp.expires_in || 3600) * 1000;
  return graphToken;
}

// Busca foto do Office 365 via MS Graph. Retorna Buffer ou null.
async function fetchGraphPhoto(email) {
  try {
    const token = await getGraphToken();
    const buf = await new Promise((resolve, reject) => {
      const req = https.request({
        method: "GET",
        hostname: "graph.microsoft.com",
        path: `/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
        headers: { Authorization: `Bearer ${token}`, Accept: "image/jpeg" }
      }, res => {
        const chunks = [];
        res.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          if (res.statusCode === 404 || res.statusCode === 400) return resolve(null);
          if (res.statusCode >= 400) return resolve(null);
          resolve(Buffer.concat(chunks));
        });
      });
      req.on("error", () => resolve(null));
      req.end();
    });
    return buf && buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

// ─── Dataverse helpers ────────────────────────────────────────────────────────

async function findUserByEmailOrId(email, usuarioId) {
  if (usuarioId) {
    const { getRecordById } = require("../shared/dataverseCrud");
    const row = await getRecordById(TABLE_USUARIO, usuarioId, {
      select: `${COL_USUARIO_ID},${COL_EMAIL},${COL_FOTO}`
    });
    return row || null;
  }
  if (email) {
    const result = await listRecords(TABLE_USUARIO, {
      select: `${COL_USUARIO_ID},${COL_EMAIL},${COL_FOTO}`,
      filter: `${COL_EMAIL} eq '${email.replace(/'/g, "''")}'`,
      top: 1
    });
    return result?.value?.[0] || null;
  }
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

app.http("eduxp-usercontext", {
  methods: ["GET", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/usercontext/photo",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpUserContext:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de UserContext", detail: err?.message } };
    }
  }
});

// GET — retorna URL de foto (Dataverse SAS → Graph buffer → 404)
async function handleGet(request, context) {
  const email      = (request.query.get("email") || "").trim();
  const usuarioId  = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();

  if (!email && !usuarioId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe email ou usuarioId." } };
  }

  const user = await findUserByEmailOrId(email || null, usuarioId || null);

  // 1) Foto customizada no blob
  if (user?.[COL_FOTO]) {
    try {
      const { accountName, sharedKey } = getSharedKey();
      const blobName = blobNameFromUrl(user[COL_FOTO]);
      if (blobName) {
        const sasUrl = buildSasUrl(accountName, sharedKey, blobName);
        return { status: 200, headers: CORS, jsonBody: { source: "dataverse", url: sasUrl } };
      }
    } catch (err) {
      context.warn("Falha ao gerar SAS para foto do Dataverse:", err?.message);
    }
  }

  // 2) Foto do Office 365 via Graph (retorna como data URL base64)
  const userEmail = email || user?.[COL_EMAIL] || null;
  if (userEmail) {
    const photoBuffer = await fetchGraphPhoto(userEmail);
    if (photoBuffer) {
      const b64 = photoBuffer.toString("base64");
      return {
        status: 200,
        headers: CORS,
        jsonBody: { source: "office365", url: `data:image/jpeg;base64,${b64}` }
      };
    }
  }

  // 3) Sem foto
  return { status: 200, headers: CORS, jsonBody: { source: "none", url: null } };
}

// PUT — faz upload da imagem e salva URL permanente no Dataverse
async function handlePut(request, context) {
  const email     = (request.query.get("email") || "").trim();
  const usuarioId = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();

  if (!email && !usuarioId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe email ou usuarioId." } };
  }

  if (!request.body) {
    return { status: 400, headers: CORS, jsonBody: { error: "Body vazio. Envie a imagem no body." } };
  }

  const user = await findUserByEmailOrId(email || null, usuarioId || null);
  if (!user) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };

  const userId = user[COL_USUARIO_ID];
  const contentType = request.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const blobName = `avatars/avatar_${userId}_${Date.now()}.${ext}`;

  const { accountName, sharedKey } = getSharedKey();
  const bsc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, sharedKey);
  const blobClient = bsc.getContainerClient(CONTAINER_NAME).getBlockBlobClient(blobName);

  const nodeStream = Readable.fromWeb(request.body);
  await blobClient.uploadStream(nodeStream, 4 * 1024 * 1024, 5, {
    blobHTTPHeaders: { blobContentType: contentType.includes("image/") ? contentType : "image/png" }
  });

  const permanentUrl = buildPermanentUrl(accountName, blobName);
  await updateRecord(TABLE_USUARIO, userId, { [COL_FOTO]: permanentUrl });

  const sasUrl = buildSasUrl(accountName, sharedKey, blobName);
  return { status: 200, headers: CORS, jsonBody: { message: "Foto atualizada com sucesso.", url: sasUrl } };
}

// DELETE — remove foto customizada do Dataverse (não deleta o blob)
async function handleDelete(request, context) {
  const email     = (request.query.get("email") || "").trim();
  const usuarioId = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();

  if (!email && !usuarioId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe email ou usuarioId." } };
  }

  const user = await findUserByEmailOrId(email || null, usuarioId || null);
  if (!user) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };

  await updateRecord(TABLE_USUARIO, user[COL_USUARIO_ID], { [COL_FOTO]: null });
  return { status: 200, headers: CORS, jsonBody: { message: "Foto removida. Sistema usará foto do Office 365." } };
}
