// eduxpTreinamentos.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_TREINAMENTO = "eduxp_treinamentos";

const COL = {
  ID: "eduxp_treinamentoid",
  TITULO: "eduxp_titulo",
  TIPO: "eduxp_tipo",
  MOEDAS_RECOMPENSA: "eduxp_moedasrecompensa",
  DURACAO_HORAS: "eduxp_duracaohoras",
  PERMITE_COMPRA: "eduxp_permitecompra",
  PRECO_MOEDAS: "eduxp_precomoedas",
  STATE: "statecode",
  STATUS: "statuscode"
};

const CORS = { "Access-Control-Allow-Origin": "*" };

function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row[COL.ID] ?? null,
    titulo: row[COL.TITULO] ?? null,
    tipo: row[COL.TIPO] ?? null,
    moedasRecompensa: row[COL.MOEDAS_RECOMPENSA] ?? 0,
    duracaoHoras: row[COL.DURACAO_HORAS] ?? 0,
    permiteCompra: row[COL.PERMITE_COMPRA] ?? false,
    precoMoedas: row[COL.PRECO_MOEDAS] ?? 0,
    ativo: row[COL.STATE] === 0
  };
}

app.http("eduxp-treinamentos", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/treinamentos/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpTreinamentos:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Treinamentos", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);
  const ativo = String(request.query.get("ativo") || "").trim();
  const tipo = String(request.query.get("tipo") || "").trim();

  const selectCols = [
    COL.ID, COL.TITULO, COL.TIPO,
    COL.MOEDAS_RECOMPENSA, COL.DURACAO_HORAS,
    COL.PERMITE_COMPRA, COL.PRECO_MOEDAS,
    COL.STATE, COL.STATUS
  ].join(",");

  if (id) {
    const v = await getRecordById(TABLE_TREINAMENTO, id, { select: selectCols });
    return { status: v ? 200 : 404, headers: CORS, jsonBody: v ? normalizeItem(v) : { error: "Treinamento não encontrado" } };
  }

  const filters = [];
  if (ativo === "1") filters.push(`${COL.STATE} eq 0`);
  if (tipo) filters.push(`${COL.TIPO} eq '${tipo.replace(/'/g, "''")}'`);

  const result = await listRecords(TABLE_TREINAMENTO, {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top
  });

  return {
    status: 200,
    headers: CORS,
    jsonBody: {
      items: (result?.value || []).map(normalizeItem).filter(Boolean),
      nextLink: result?.["@odata.nextLink"] || null
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const titulo = String(body.titulo || "").trim();
  if (!titulo) return { status: 400, headers: CORS, jsonBody: { error: "titulo é obrigatório." } };

  const createBody = {
    [COL.TITULO]: titulo,
    [COL.TIPO]: String(body.tipo || "").trim() || null,
    [COL.MOEDAS_RECOMPENSA]: Number(body.moedasRecompensa || 0),
    [COL.DURACAO_HORAS]: Number(body.duracaoHoras || 0),
    ...(body.permiteCompra !== undefined ? { [COL.PERMITE_COMPRA]: !!body.permiteCompra } : {}),
    ...(body.precoMoedas !== undefined ? { [COL.PRECO_MOEDAS]: Number(body.precoMoedas || 0) } : {})
  };

  await createRecord(TABLE_TREINAMENTO, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Treinamento criado com sucesso." } };
}

async function handlePut(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.titulo !== undefined) updateBody[COL.TITULO] = String(body.titulo || "").trim();
  if (body.tipo !== undefined) updateBody[COL.TIPO] = String(body.tipo || "").trim() || null;
  if (body.moedasRecompensa !== undefined) updateBody[COL.MOEDAS_RECOMPENSA] = Number(body.moedasRecompensa || 0);
  if (body.duracaoHoras !== undefined) updateBody[COL.DURACAO_HORAS] = Number(body.duracaoHoras || 0);
  if (body.permiteCompra !== undefined) updateBody[COL.PERMITE_COMPRA] = !!body.permiteCompra;
  if (body.precoMoedas !== undefined) updateBody[COL.PRECO_MOEDAS] = Number(body.precoMoedas || 0);

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  await updateRecord(TABLE_TREINAMENTO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Treinamento atualizado com sucesso." } };
}

async function handleDelete(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_TREINAMENTO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Treinamento excluído com sucesso." } };
}
