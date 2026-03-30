// eduxpTransacaoMoedas.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_TX = process.env.TABLE_TRANSACAO_MOEDAS || "eduxp_transacaomoedas";
const TABLE_USUARIO = "eduxp_usuarios";

const COL = {
  ID: "eduxp_transacaomoedasid",
  DATA: "eduxp_datatransacao",
  TIPO: "eduxp_tipo",
  VALOR: "eduxp_valor",
  ORIGEM_ID: "eduxp_origemid",
  ORIGEM_TIPO: "eduxp_origemtipo",
  SALDO_ANTES: "eduxp_saldoantes",
  SALDO_DEPOIS: "eduxp_saldodepois",
  DESCRICAO: "eduxp_descricao",
  LK_USUARIO_VAL: "_eduxp_usuarioid_value"
};

const NAV_USUARIO = "eduxp_usuarioid";

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

app.http("eduxp-transacaoMoedas", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/transacaoMoedas/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpTransacaoMoedas:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de TransacaoMoedas", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  const usuarioId = String(request.query.get("usuarioId") || "").trim();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);

  const selectCols = Object.values(COL).join(",");

  if (id) {
    const v = await getRecordById(TABLE_TX, id, { select: selectCols });
    return { status: v ? 200 : 404, headers: CORS, jsonBody: v || { error: "Transação não encontrada" } };
  }

  const filters = [];
  if (usuarioId) filters.push(`${COL.LK_USUARIO_VAL} eq ${normGuid(usuarioId)}`);

  const result = await listRecords(TABLE_TX, {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top
  });

  return { status: 200, headers: CORS, jsonBody: { items: result?.value || [], nextLink: result?.["@odata.nextLink"] || null } };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioId = String(body.usuarioId || "").trim();

  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId é obrigatório." } };

  const createBody = {
    [COL.DATA]: body.dataTransacao || new Date().toISOString(),
    [COL.TIPO]: Number(body.tipo),
    [COL.VALOR]: Number(body.valor),
    [COL.SALDO_ANTES]: Number(body.saldoAntes || 0),
    [COL.SALDO_DEPOIS]: Number(body.saldoDepois || 0),
    [COL.DESCRICAO]: body.descricao ? String(body.descricao) : null,
    [COL.ORIGEM_ID]: body.origemId ? String(body.origemId) : null,
    ...(body.origemTipo !== undefined ? { [COL.ORIGEM_TIPO]: Number(body.origemTipo) } : {}),
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`
  };

  await createRecord(TABLE_TX, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Transação criada." } };
}

async function handlePut(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.descricao !== undefined) updateBody[COL.DESCRICAO] = body.descricao ? String(body.descricao) : null;

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  await updateRecord(TABLE_TX, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Transação atualizada." } };
}

async function handleDelete(request, context) {
  const id = String(request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_TX, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Transação excluída." } };
}
