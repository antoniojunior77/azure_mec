const { app } = require("@azure/functions");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");

const { Readable, Transform } = require("stream");

const CONTAINER_NAME = process.env.BLOB_CONTAINER || "app-package-pnld-4ff16a8";
const SAS_HOURS = Number(process.env.SAS_HOURS || 12);

const UPLOAD_BUFFER_SIZE = Number(process.env.UPLOAD_BUFFER_SIZE || 4 * 1024 * 1024); // 4MB
const UPLOAD_MAX_CONCURRENCY = Number(process.env.UPLOAD_MAX_CONCURRENCY || 5);
const LOG_EVERY_BYTES = Number(process.env.LOG_EVERY_BYTES || 5 * 1024 * 1024); // 5MB

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

function getSharedKeyFromConnStr() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING não definida");

  const parts = parseConnectionString(connStr);
  const accountName = parts.AccountName;
  const accountKey = parts.AccountKey;
  if (!accountName || !accountKey) throw new Error("Falha ao extrair AccountName/AccountKey");

  return { accountName, sharedKey: new StorageSharedKeyCredential(accountName, accountKey) };
}

function resolveFileName(request) {
  return request.query.get("fileName") || `imagem_${Date.now()}.png`;
}

app.http("uploadImage", {
  methods: ["POST", "GET"],
  authLevel: "function",
  route: "uploadImage",
  handler: async (request, context) => {
    context.log("[uploadImage] START", request.method, request.url);

    if (request.method === "GET" && request.query.get("ping") === "1") {
      context.log("[uploadImage] PING OK");
      return { status: 200, jsonBody: { ok: true } };
    }

    const fileName = resolveFileName(request);
    const contentType = request.headers.get("content-type") || "application/octet-stream";

    context.log("[uploadImage] fileName:", fileName);
    context.log("[uploadImage] content-type:", contentType);

    if (!request.body) {
      context.log.error("[uploadImage] request.body vazio (streaming não habilitado ou request sem body).");
      return { status: 400, jsonBody: { error: "Body vazio. Envie binário (octet-stream) no body." } };
    }

    context.log("[uploadImage] [1] creds");
    const { accountName, sharedKey } = getSharedKeyFromConnStr();

    context.log("[uploadImage] [2] clients");
    const bsc = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, sharedKey);
    const blobClient = bsc.getContainerClient(CONTAINER_NAME).getBlockBlobClient(fileName);

    context.log("[uploadImage] [3] node stream");
    const nodeStream = Readable.fromWeb(request.body);

    let loaded = 0;
    let last = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        loaded += chunk.length;
        if (loaded - last >= LOG_EVERY_BYTES) {
          last = loaded;
          context.log(`[uploadImage] received ${(loaded / 1024 / 1024).toFixed(2)} MB`);
        }
        cb(null, chunk);
      },
    });

    context.log("[uploadImage] [4] upload begin", blobClient.url);
    const t0 = Date.now();

    await blobClient.uploadStream(
      nodeStream.pipe(counter),
      UPLOAD_BUFFER_SIZE,
      UPLOAD_MAX_CONCURRENCY,
      {
        blobHTTPHeaders: {
          blobContentType: contentType.includes("image/") ? contentType : "image/png",
        },
      }
    );

    context.log("[uploadImage] [5] upload ok ms=", Date.now() - t0, "bytes=", loaded);

    context.log("[uploadImage] [6] sas");
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
    context.log("[uploadImage] DONE exp=", expiresOn.toISOString());

    return { status: 200, jsonBody: { fileName, sasUrl, bytes: loaded } };
  },
});
