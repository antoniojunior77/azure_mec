const { dataverseRequest } = require("./dataverseClient");

// Obter registro por ID
async function getRecordById(entitySetName, id, { select } = {}) {
  const query = select ? `?$select=${encodeURIComponent(select)}` : "";
  const path = `/api/data/v9.2/${entitySetName}(${id})${query}`;

  return dataverseRequest(path);
}

// Listar registros com select/filter/top/expand/skip/orderby opcionais
async function listRecords(entitySetName, { select, filter, top, expand, skip, orderby } = {}) {
  const params = [];
  if (select) params.push(`$select=${encodeURIComponent(select)}`);
  if (filter) params.push(`$filter=${encodeURIComponent(filter)}`);
  if (top) params.push(`$top=${top}`);
  if (expand) params.push(`$expand=${encodeURIComponent(expand)}`);
  if (skip) params.push(`$skip=${skip}`);
  if (orderby) params.push(`$orderby=${encodeURIComponent(orderby)}`);

  const query = params.length ? `?${params.join("&")}` : "";
  const path = `/api/data/v9.2/${entitySetName}${query}`;

  return dataverseRequest(path);
}


// Criar registro (retorna id e record quando possível)
async function createRecord(entitySetName, body, options = {}) {
  const path = `/api/data/v9.2/${entitySetName}`;

  const preferRepresentation = options.returnRepresentation !== false;

  const resp = await dataverseRequest(path, {
    method: "POST",
    body,
    returnMeta: true,
    headers: {
      ...(preferRepresentation ? { Prefer: "return=representation" } : {}),
      ...(options.headers || {})
    }
  });

  const data = resp?.data || null;

  // 1) tenta pegar id do body (se veio return=representation)
  const idField = options.idField; // ex: "eduxp_projetoid"
  let id = null;
  if (data && typeof data === "object" && idField && data[idField]) {
    id = data[idField];
  }

  // 2) fallback: pega do header OData-EntityId / Location
  if (!id) {
    const h = resp?.headers || {};
    const entityId = h["odata-entityid"] || h["location"] || null;

    if (entityId) {
      const match = String(entityId).match(/\(([0-9a-fA-F-]{36})\)/);
      if (match) id = match[1];
    }
  }

  return { id, record: data, status: resp?.status, headers: resp?.headers };
}



// Atualizar registro
async function updateRecord(entitySetName, id, body) {
  const path = `/api/data/v9.2/${entitySetName}(${id})`;
  return dataverseRequest(path, { method: "PATCH", body });
}

// Deletar registro
async function deleteRecord(entitySetName, id) {
  const path = `/api/data/v9.2/${entitySetName}(${id})`;
  return dataverseRequest(path, { method: "DELETE" });
}

async function uploadFile(entitySetName, id, fileColumn, buffer, filename, contentType = "application/octet-stream") {
  const path = `/api/data/v9.2/${entitySetName}(${id})/${fileColumn}`;

  return dataverseRequest(path, {
    method: "PUT",
    bodyBuffer: buffer,
    fileName: filename,
    contentType
  });
}

module.exports = {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord,
  uploadFile
};
