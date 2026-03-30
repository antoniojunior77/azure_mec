// eduxpClassificacoes.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_CLASSIFICACAO = "eduxp_classificacaos";
const CORS = { "Access-Control-Allow-Origin": "*" };

app.http("eduxp-classificacoes", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/classificacoes/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpClassificacoes:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Classificações", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  const tipo = (request.query.get("tipo") || "").trim();
  const ativaParam = (request.query.get("ativa") || "").trim().toLowerCase();

  const selectCols = [
    "eduxp_classificacaoid",
    "eduxp_nome",
    "eduxp_tipo",
    "eduxp_ativa"
  ].join(",");

  if (id) {
    const result = await getRecordById(TABLE_CLASSIFICACAO, id, { select: selectCols });
    return { status: 200, headers: CORS, jsonBody: result || null };
  }

  const result = await listRecords(TABLE_CLASSIFICACAO, { select: selectCols, top: 200 });
  let all = result?.value ?? [];

  if (tipo) {
    all = all.filter(c => (c.eduxp_tipo || "").trim().toLowerCase() === tipo.toLowerCase());
  }

  if (ativaParam === "true" || ativaParam === "false") {
    const ativaBool = ativaParam === "true";
    all = all.filter(c => !!c.eduxp_ativa === ativaBool);
  }

  return { status: 200, headers: CORS, jsonBody: all };
}

async function handlePost(request, context) {
  const body = await request.json();
  const nome = (body.nome || "").trim();
  const tipo = (body.tipo || "").trim();
  const ativa = body.ativa;

  if (!nome) return { status: 400, headers: CORS, jsonBody: { error: "nome é obrigatório." } };

  const createBody = {
    eduxp_nome: nome,
    eduxp_tipo: tipo || null,
    eduxp_ativa: ativa !== undefined ? !!ativa : true
  };

  await createRecord(TABLE_CLASSIFICACAO, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Classificação criada com sucesso." } };
}

async function handlePut(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID da classificação é obrigatório na query (?id={GUID}) para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.nome !== undefined) updateBody.eduxp_nome = (body.nome || "").trim();
  if (body.tipo !== undefined) updateBody.eduxp_tipo = (body.tipo || "").trim();
  if (body.ativa !== undefined) updateBody.eduxp_ativa = !!body.ativa;

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie pelo menos um campo para atualizar (nome, tipo, ativa)." } };

  await updateRecord(TABLE_CLASSIFICACAO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Classificação atualizada com sucesso." } };
}

async function handleDelete(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID da classificação é obrigatório na query (?id={GUID}) para DELETE." } };

  await deleteRecord(TABLE_CLASSIFICACAO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Classificação excluída com sucesso." } };
}
