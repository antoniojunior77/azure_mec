// src/functions/generateblobsas.js
const { app } = require("@azure/functions");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");

const CONTAINER_NAME = process.env.BLOB_CONTAINER || "app-package-pnld-4ff16a8";
const SAS_HOURS = Number(process.env.SAS_HOURS || 12);

function parseConnectionString(connStr) {
  const r = {};
  for (const part of connStr.split(";")) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    r[part.slice(0, idx)] = part.slice(idx + 1); // preserva '=' da AccountKey
  }
  return r;
}

function resolveFileName(request) {
  // v4: request.query é URLSearchParams
  let fileName = request.query?.get?.("fileName");

  // fallback: se vier como key (?calcario.png&code=...)
  if (!fileName) {
    const url = new URL(request.url);
    for (const [k] of url.searchParams.entries()) {
      if (k !== "code" && !k.startsWith("code")) {
        fileName = k;
        break;
      }
    }
  }

  return fileName || `imagem_${Date.now()}.png`;
}

app.http("generateblobsas", {
  methods: ["GET", "POST"],
  authLevel: "function",
  route: "generateblobsas",
  handler: async (request, context) => {
    // ✅ v4: context.log existe aqui
    context.log("[generateblobsas] START", request.method, request.url);
    context.log("[1] env?", !!process.env.AZURE_STORAGE_CONNECTION_STRING);
    context.log("[2] parse");
    context.log("[3] filename");
    context.log("[4] build clients");
    context.log("[5] sas");
    context.log("[6] return");
    //return { status: 200, jsonBody: { ok: true, stage: "after-start" } };


    try {
      const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING não definida");

      const parts = parseConnectionString(connStr);
      const accountName = parts.AccountName;
      const accountKey = parts.AccountKey;

      if (!accountName || !accountKey) {
        throw new Error("Falha ao extrair AccountName/AccountKey da connection string");
      }

      const fileName = resolveFileName(request);
      context.log("[generateblobsas] fileName:", fileName);

      const sharedKey = new StorageSharedKeyCredential(accountName, accountKey);
      const blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        sharedKey
      );

      const blobClient = blobServiceClient
        .getContainerClient(CONTAINER_NAME)
        .getBlockBlobClient(fileName);

      const expiresOn = new Date(Date.now() + SAS_HOURS * 60 * 60 * 1000);

      const sas = generateBlobSASQueryParameters(
        {
          containerName: CONTAINER_NAME,
          blobName: fileName,
          permissions: BlobSASPermissions.parse("r"),
          expiresOn,
        },
        sharedKey
      ).toString();

      const sasUrl = `${blobClient.url}?${sas}`;
      context.log("[generateblobsas] SAS OK exp:", expiresOn.toISOString());

      // ✅ v4: retorna objeto
      return {
        status: 200,
        jsonBody: { fileName, sasUrl, expiresOn: expiresOn.toISOString() },
      };
    } catch (err) {
      context.log.error("[generateblobsas] ERROR:", err?.message);
      context.log.error(err?.stack);
      return { status: 500, jsonBody: { error: err?.message || "Erro interno" } };
    }
  },
});
