// eduxpAtividades.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_ATIVIDADE      = "eduxp_atividades";
const TABLE_USUARIO        = "eduxp_usuarios";
const TABLE_TIPO_ATIVIDADE = "eduxp_tipoatividades";

const COL = {
  ID: "eduxp_atividadeid",
  USUARIO_VAL: "_eduxp_usuarioid_value",
  TIPO_VAL: "_eduxp_tipoatividadeid_value",
  DESCR: "eduxp_descricao",
  XP: "eduxp_xpganho",
  PONTOS: "eduxp_pontosganhos",
  DATA: "eduxp_dataatividade"
};

const NAV = {
  USUARIO: "eduxp_usuarioid",
  TIPO: "eduxp_tipoatividadeid"
};

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "");
}

function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row[COL.ID] ?? null,
    usuarioId: row[COL.USUARIO_VAL] ?? null,
    tipoAtividadeId: row[COL.TIPO_VAL] ?? null,
    descricao: row[COL.DESCR] ?? null,
    xpGanho: row[COL.XP] ?? 0,
    pontosGanhos: row[COL.PONTOS] ?? 0,
    dataAtividade: row[COL.DATA] ?? null
  };
}

function toIsoDateTime(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

app.http("eduxp-atividades", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/atividades/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpAtividades:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Atividades", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id              = (request.params.id || request.query.get("id") || "").trim();
  const usuarioId       = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();
  const tipoAtividadeId = (request.query.get("tipoAtividadeId") || request.query.get("tipoatividadeid") || "").trim();
  const dataDe          = (request.query.get("dataDe") || request.query.get("datade") || "").trim();
  const dataAte         = (request.query.get("dataAte") || request.query.get("dataate") || "").trim();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);

  const selectCols = [COL.ID, COL.USUARIO_VAL, COL.TIPO_VAL, COL.DESCR, COL.XP, COL.PONTOS, COL.DATA].join(",");

  if (id) {
    const result = await getRecordById(TABLE_ATIVIDADE, normGuid(id), { select: selectCols });
    return {
      status: result ? 200 : 404,
      headers: CORS,
      jsonBody: result ? normalizeItem(result) : { error: "Registro não encontrado." }
    };
  }

  const filters = [];
  if (usuarioId) {
    const u = normGuid(usuarioId);
    if (!u) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId inválido." } };
    filters.push(`${COL.USUARIO_VAL} eq ${u}`);
  }
  if (tipoAtividadeId) {
    const t = normGuid(tipoAtividadeId);
    if (!t) return { status: 400, headers: CORS, jsonBody: { error: "tipoAtividadeId inválido." } };
    filters.push(`${COL.TIPO_VAL} eq ${t}`);
  }
  if (dataDe) filters.push(`${COL.DATA} ge ${dataDe}T00:00:00Z`);
  if (dataAte) filters.push(`${COL.DATA} le ${dataAte}T23:59:59Z`);

  const result = await listRecords(TABLE_ATIVIDADE, {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top,
    orderby: `${COL.DATA} desc`
  });

  return {
    status: 200,
    headers: CORS,
    jsonBody: {
      items: (result?.value ?? []).map(normalizeItem).filter(Boolean),
      nextLink: result?.["@odata.nextLink"] || null
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioId       = normGuid(body.usuarioId || "");
  const tipoAtividadeId = normGuid(body.tipoAtividadeId || "");

  if (!usuarioId || !tipoAtividadeId) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId e tipoAtividadeId são obrigatórios." } };

  const createBody = {
    [COL.DESCR]: (body.descricao || "").trim() || null,
    [COL.XP]: body.xpGanho ?? 0,
    [COL.PONTOS]: body.pontosGanhos ?? 0,
    [COL.DATA]: toIsoDateTime(body.dataAtividade) || null,
    [`${NAV.USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`,
    [`${NAV.TIPO}@odata.bind`]: `/${TABLE_TIPO_ATIVIDADE}(${tipoAtividadeId})`
  };

  await createRecord(TABLE_ATIVIDADE, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Atividade registrada com sucesso." } };
}

async function handlePut(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.descricao !== undefined) updateBody[COL.DESCR] = (body.descricao || "").trim() || null;
  if (body.xpGanho !== undefined) updateBody[COL.XP] = body.xpGanho ?? 0;
  if (body.pontosGanhos !== undefined) updateBody[COL.PONTOS] = body.pontosGanhos ?? 0;

  if (body.dataAtividade !== undefined) {
    const iso = toIsoDateTime(body.dataAtividade);
    if (!iso && body.dataAtividade) return { status: 400, headers: CORS, jsonBody: { error: "dataAtividade inválida. Use ISO ou YYYY-MM-DD." } };
    updateBody[COL.DATA] = iso || null;
  }

  if (body.usuarioId !== undefined) {
    const u = normGuid(body.usuarioId || "");
    if (u) updateBody[`${NAV.USUARIO}@odata.bind`] = `/${TABLE_USUARIO}(${u})`;
  }

  if (body.tipoAtividadeId !== undefined) {
    const t = normGuid(body.tipoAtividadeId || "");
    if (t) updateBody[`${NAV.TIPO}@odata.bind`] = `/${TABLE_TIPO_ATIVIDADE}(${t})`;
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie ao menos um campo para atualizar." } };

  await updateRecord(TABLE_ATIVIDADE, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Atividade atualizada com sucesso.", id } };
}

async function handleDelete(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_ATIVIDADE, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Atividade excluída com sucesso.", id } };
}
