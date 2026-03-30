const https = require("https");
const querystring = require("querystring");

const tenantId = process.env.DATAVERSE_TENANT_ID;
const clientId = process.env.DATAVERSE_CLIENT_ID;
const clientSecret = process.env.DATAVERSE_CLIENT_SECRET;
const dataverseUrl = process.env.DATAVERSE_URL;

let cachedToken = null;
let cachedExpiresOn = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresOn - 60 * 1000) return cachedToken;

  const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${dataverseUrl}/.default`,
    grant_type: "client_credentials"
  });

  const tokenResponse = await httpPostForm(tokenEndpoint, body);

  cachedToken = tokenResponse.access_token;
  cachedExpiresOn = now + (tokenResponse.expires_in || 3600) * 1000;

  return cachedToken;
}

function httpPostForm(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options = {
      method: "POST",
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Token request failed: ${res.statusCode} - ${text}`));
        }
        try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function dataverseRequest(path, options = {}) {
  const token = await getToken();

  // base sanitizado
  const base = new URL(dataverseUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";

  const url = new URL(path, base.toString());
  const method = (options.method || "GET").toUpperCase();

  // suporta JSON (options.body) OU binário upload (options.bodyBuffer)
  let payloadBuffer = null;

  if (options.bodyBuffer) {
    payloadBuffer = Buffer.isBuffer(options.bodyBuffer)
      ? options.bodyBuffer
      : Buffer.from(options.bodyBuffer);
  } else if (options.body !== undefined) {
    payloadBuffer = Buffer.from(JSON.stringify(options.body), "utf8");
  }

  const dvPath = (method === "GET") ? (url.pathname + url.search) : url.pathname;

  if (method !== "GET" && dvPath.includes("?")) {
    throw new Error(`WRITE com query detectada: ${method} ${dvPath}`);
  }

  console.log("DV REQ:", method, dvPath);

  const preferGet = [
    'odata.include-annotations="Microsoft.Dynamics.CRM.associatednavigationproperty"',
    'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
  ].join(",");

  const returnBuffer = !!options.returnBuffer;
  const returnMeta = !!options.returnMeta;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: returnBuffer ? "*/*" : "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    ...(options.headers || {})
  };

  // Só aplica Prefer em GET JSON (não em binário)
  if (method === "GET" && !returnBuffer) {
    headers.Prefer = preferGet;
  }

  // Content-Type (quando tem payload)
  if (payloadBuffer) {
    headers["Content-Type"] = options.contentType
      ? options.contentType
      : (options.bodyBuffer ? "application/octet-stream" : "application/json; charset=utf-8");

    headers["Content-Length"] = payloadBuffer.length;
  }

  // upload File Column usa x-ms-file-name
  if (options.fileName) {
    headers["x-ms-file-name"] = options.fileName;
  }

  const requestOptions = {
    method,
    hostname: url.hostname,
    path: dvPath,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const dbg = {
            method,
            rawInputPath: path,
            dvPathSent: requestOptions.path,
            hasQueryInWrite: method !== "GET" && (requestOptions.path || "").includes("?"),
            baseUrlEnv: process.env.DATAVERSE_URL
          };
          return reject(new Error(`Dataverse error ${res.statusCode}: ${text} | DVDBG=${JSON.stringify(dbg)}`));
        }

        // retorno binário (file $value)
        if (returnBuffer) {
          if (returnMeta) {
            return resolve({ status: res.statusCode, headers: res.headers, buffer: buf });
          }
          return resolve(buf);
        }

        // retorno JSON
        let data = null;
        if (text) {
          try { data = JSON.parse(text); } catch { data = null; }
        }

        if (returnMeta) {
          return resolve({ status: res.statusCode, headers: res.headers, data });
        }

        return resolve(data);

      });
    });

    req.on("error", reject);
    if (payloadBuffer) req.write(payloadBuffer);
    req.end();
  });
}

function dataverseRequestRaw(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  let bodyBuffer = options.bodyBuffer;
  if (!bodyBuffer && options.body !== undefined) {
    bodyBuffer = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
  }

  return dataverseRequest(path, {
    method,
    bodyBuffer,
    headers: options.headers || {},
    contentType: options.contentType,
    fileName: options.fileName,
    returnBuffer: options.returnBuffer
  });
}


async function dataverseRequestBinary(path, options = {}) {
  const token = await getToken();

  const base = new URL(dataverseUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";

  const url = new URL(path, base.toString());
  const method = (options.method || "GET").toUpperCase();

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: options.accept || "application/octet-stream",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    ...(options.headers || {})
  };

  const requestOptions = {
    method,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const text = buffer.toString("utf8");
          const dbg = {
            method,
            rawInputPath: path,
            dvPathSent: requestOptions.path,
            baseUrlEnv: process.env.DATAVERSE_URL
          };
          return reject(new Error(`Dataverse binary error ${res.statusCode}: ${text} | DVDBG=${JSON.stringify(dbg)}`));
        }

        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer
        });
      });
    });

    req.on("error", reject);
    req.end();
  });
}


module.exports = { dataverseRequest, dataverseRequestRaw, dataverseRequestBinary };
