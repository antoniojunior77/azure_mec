// eduxpFotos.js — Azure Functions v4
// Gerencia álbuns de fotos vinculados a projetos
const { app } = require("@azure/functions");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");
const { Readable } = require("stream");
const { listRecords, getRecordById, createRecord, deleteRecord } = require("../shared/dataverseCrud");

const TABLE_MIDIA           = "eduxp_projetousuariomidiases";
const TABLE_PROJETO_USUARIO = "eduxp_projetousuarios";
const NAV_PROJETO_USUARIO   = "eduxp_projetousuarioid";

const COL = {
  ID:                "eduxp_projetousuariomidiasid",
  NOME:              "eduxp_nomedamidia",
  TITULO:            "eduxp_titulo",
  DESCRICAO:         "eduxp_descricao",
  URL:               "eduxp_urldaimagem",
  ATIVO:             "eduxp_ativo",
  ORDEM:             "eduxp_ordem",
  LK_PROJ_USU_VAL:   "_eduxp_projetousuarioid_value",
};

const PU = {
  ID:          "eduxp_projetousuarioid",
  LK_USU_VAL:  "_eduxp_usuarioid_value",
  LK_PROJ_VAL: "_eduxp_projetoid_value",
};

const CONTAINER_NAME = process.env.BLOB_CONTAINER || "app-package-pnld-4ff16a8";
const SAS_HOURS      = Number(process.env.SAS_HOURS || 12);
const CORS = { "Access-Control-Allow-Origin": "*" };

// ─── Blob helpers ─────────────────────────────────────────────────────────────

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
  return {
    accountName: parts.AccountName,
    sharedKey: new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey),
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

function blobNameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join("/");
  } catch { /* noop */ }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findOrCreateProjetoUsuario(projetoId, usuarioId) {
  // Procura link existente
  const r = await listRecords(TABLE_PROJETO_USUARIO, {
    select: `${PU.ID},${PU.LK_USU_VAL},${PU.LK_PROJ_VAL}`,
    filter: `${PU.LK_USU_VAL} eq '${usuarioId}' and ${PU.LK_PROJ_VAL} eq '${projetoId}'`,
    top: 1,
  });
  if (r?.value?.[0]?.[PU.ID]) return r.value[0][PU.ID];

  // Cria o link
  const created = await createRecord(TABLE_PROJETO_USUARIO, {
    [`eduxp_usuarioid@odata.bind`]: `/eduxp_usuarios(${usuarioId})`,
    [`eduxp_projetoid@odata.bind`]: `/eduxp_projetos(${projetoId})`,
  }, { idField: PU.ID, returnRepresentation: true });
  return created?.id || null;
}

function mapMidia(r, accountName, sharedKey) {
  if (!r) return null;
  let url = null;
  if (r[COL.URL]) {
    const blobName = blobNameFromUrl(r[COL.URL]);
    try {
      url = blobName ? buildSasUrl(accountName, sharedKey, blobName) : r[COL.URL];
    } catch {
      url = r[COL.URL];
    }
  }
  return {
    id: r[COL.ID],
    nome: r[COL.NOME] || null,
    titulo: r[COL.TITULO] || null,
    descricao: r[COL.DESCRICAO] || null,
    url,
    projetoUsuarioId: r[COL.LK_PROJ_USU_VAL] || null,
    criadoEm: r.createdon || null,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

app.http("eduxp-fotos", {
  methods: ["GET", "POST", "DELETE"],
  authLevel: "function",
  route: "eduxp/fotos/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpFotos:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Fotos", detail: err?.message } };
    }
  },
});

// GET ?projetoId=xxx → lista fotos do projeto (todas as midias dos projetousuarios)
async function handleGet(request, context) {
  const projetoId = (request.query.get("projetoId") || "").trim();
  if (!projetoId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe projetoId." } };
  }

  // 1. Obter todos os projetousuario IDs para este projeto
  const puRes = await listRecords(TABLE_PROJETO_USUARIO, {
    select: PU.ID,
    filter: `${PU.LK_PROJ_VAL} eq '${projetoId}'`,
    top: 200,
  });
  const puIds = (puRes?.value || []).map(r => r[PU.ID]).filter(Boolean);

  if (puIds.length === 0) {
    return { status: 200, headers: CORS, jsonBody: { items: [] } };
  }

  // 2. Buscar midias para esses projetousuarios (batch by first 20 to avoid huge OData filter)
  const batchIds = puIds.slice(0, 20);
  const filter = batchIds.map(id => `${COL.LK_PROJ_USU_VAL} eq '${id}'`).join(" or ");

  const midiaRes = await listRecords(TABLE_MIDIA, {
    select: `${COL.ID},${COL.NOME},${COL.TITULO},${COL.DESCRICAO},${COL.URL},${COL.LK_PROJ_USU_VAL},createdon`,
    filter,
    orderby: "createdon desc",
    top: 100,
  });

  let accountName, sharedKey;
  try {
    const keys = getSharedKey();
    accountName = keys.accountName;
    sharedKey = keys.sharedKey;
  } catch { /* sem blob config */ }

  const items = (midiaRes?.value || [])
    .map(r => mapMidia(r, accountName, sharedKey))
    .filter(Boolean);

  return { status: 200, headers: CORS, jsonBody: { items } };
}

// POST ?projetoId=xxx&usuarioId=yyy  [body = image bytes, Content-Type: image/*]
async function handlePost(request, context) {
  const projetoId = (request.query.get("projetoId") || "").trim();
  const usuarioId = (request.query.get("usuarioId") || "").trim();
  const titulo    = (request.query.get("titulo") || "").trim() || null;

  if (!projetoId || !usuarioId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe projetoId e usuarioId." } };
  }
  if (!request.body) {
    return { status: 400, headers: CORS, jsonBody: { error: "Body vazio. Envie a imagem no body." } };
  }

  // Encontra ou cria o vínculo projetousuario
  const projetoUsuarioId = await findOrCreateProjetoUsuario(projetoId, usuarioId);
  if (!projetoUsuarioId) {
    return { status: 500, headers: CORS, jsonBody: { error: "Não foi possível criar o vínculo projeto-usuário." } };
  }

  // Upload para blob
  const { accountName, sharedKey } = getSharedKey();
  const contentType = request.headers.get("content-type") || "image/png";
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const blobName = `fotos/${projetoId}/${usuarioId}_${Date.now()}.${ext}`;

  const bsc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, sharedKey);
  const blobClient = bsc.getContainerClient(CONTAINER_NAME).getBlockBlobClient(blobName);
  const nodeStream = Readable.fromWeb(request.body);
  await blobClient.uploadStream(nodeStream, 4 * 1024 * 1024, 5, {
    blobHTTPHeaders: { blobContentType: contentType.includes("image/") ? contentType : "image/png" },
  });

  const permanentUrl = buildPermanentUrl(accountName, blobName);
  const nomeMidia = titulo || `foto_${Date.now()}`;

  // Cria registro no Dataverse
  const created = await createRecord(TABLE_MIDIA, {
    eduxp_nomedamidia: nomeMidia,
    eduxp_titulo: titulo || null,
    eduxp_urldaimagem: permanentUrl,
    eduxp_ativo: true,
    [`${NAV_PROJETO_USUARIO}@odata.bind`]: `/${TABLE_PROJETO_USUARIO}(${projetoUsuarioId})`,
  }, { idField: COL.ID, returnRepresentation: true });

  const sasUrl = buildSasUrl(accountName, sharedKey, blobName);
  return {
    status: 201,
    headers: CORS,
    jsonBody: {
      message: "Foto enviada com sucesso.",
      id: created?.id || null,
      url: sasUrl,
    },
  };
}

// DELETE /{id} → remove registro de midia
async function handleDelete(request, context) {
  const id = (request.params.id || "").trim();
  if (!id) {
    return { status: 400, headers: CORS, jsonBody: { error: "Informe o id da foto." } };
  }

  // Busca para verificar e obter URL do blob (para info, não deletamos o blob)
  await getRecordById(TABLE_MIDIA, id, { select: COL.ID });
  await deleteRecord(TABLE_MIDIA, id);

  return { status: 200, headers: CORS, jsonBody: { message: "Foto removida." } };
}
