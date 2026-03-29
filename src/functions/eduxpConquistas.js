// eduxpConquistas.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_CONQUISTA = "eduxp_conquistas";

const COL = {
  ID: "eduxp_conquistaid",
  NOME: "eduxp_nome",
  DESCR: "eduxp_descricao",
  TIPO: "eduxp_tipo",
  PONTOS: "eduxp_pontosrequeridos",
  ATIVA: "statecode"
};

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row[COL.ID] ?? null,
    nome: row[COL.NOME] ?? null,
    descricao: row[COL.DESCR] ?? null,
    tipo: row[COL.TIPO] ?? null,
    pontosRequeridos: row[COL.PONTOS] ?? 0,
    ativa: row[COL.ATIVA] === 0
  };
}

app.http("eduxp-conquistas", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/conquistas/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpConquistas:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Conquistas", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || request.query.get("conquistaId") || request.query.get("conquistaid") || "");
  const tipoParam = (request.query.get("tipo") || "").trim();
  const ativaParam = (request.query.get("ativa") || "").trim().toLowerCase();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);

  const selectCols = [COL.ID, COL.NOME, COL.DESCR, COL.TIPO, COL.PONTOS, COL.ATIVA].join(",");

  if (id) {
    const result = await getRecordById(TABLE_CONQUISTA, id, { select: selectCols });
    return {
      status: result ? 200 : 404,
      headers: CORS,
      jsonBody: result ? normalizeItem(result) : { error: "Conquista não encontrada." }
    };
  }

  const filters = [];
  if (tipoParam) filters.push(`${COL.TIPO} eq '${tipoParam.replace(/'/g, "''")}'`);
  if (ativaParam === "true" || ativaParam === "1") filters.push(`${COL.ATIVA} eq 0`);
  else if (ativaParam === "false" || ativaParam === "0") filters.push(`${COL.ATIVA} eq 1`);

  const result = await listRecords(TABLE_CONQUISTA, {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top,
    orderby: `${COL.NOME} asc`
  });

  return {
    status: 200,
    headers: CORS,
    jsonBody: {
      items: (result?.value ?? []).map(normalizeItem).filter(Boolean),
      count: (result?.value ?? []).length
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const nome = (body.nome || "").trim();

  if (!nome) return { status: 400, headers: CORS, jsonBody: { error: "nome é obrigatório." } };

  const createBody = {
    [COL.NOME]: nome,
    [COL.DESCR]: (body.descricao || "").trim() || null,
    [COL.TIPO]: (body.tipo || "").trim() || null,
    [COL.PONTOS]: body.pontosRequeridos !== undefined ? Number(body.pontosRequeridos) : 0
  };

  const created = await createRecord(TABLE_CONQUISTA, createBody, { idField: COL.ID, returnRepresentation: true });

  return {
    status: 201,
    headers: CORS,
    jsonBody: {
      message: "Conquista criada com sucesso.",
      id: created.id || null,
      data: normalizeItem(created.record) || { nome }
    }
  };
}

async function handlePut(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.nome !== undefined) updateBody[COL.NOME] = String(body.nome || "").trim();
  if (body.descricao !== undefined) updateBody[COL.DESCR] = String(body.descricao || "").trim();
  if (body.tipo !== undefined) updateBody[COL.TIPO] = String(body.tipo || "").trim();
  if (body.pontosRequeridos !== undefined) updateBody[COL.PONTOS] = Number(body.pontosRequeridos);

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  await updateRecord(TABLE_CONQUISTA, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Conquista atualizada com sucesso.", id } };
}

async function handleDelete(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_CONQUISTA, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Conquista excluída com sucesso.", id } };
}
