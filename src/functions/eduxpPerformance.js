// eduxpPerformance.js
const { app } = require("@azure/functions");
const { listRecords, getRecordById, createRecord, updateRecord, deleteRecord } = require("../shared/dataverseCrud");

const TABLE = "eduxp_performances";

const COL = {
  ID:                "eduxp_performanceid",
  COMUNICACAO:       "eduxp_comunicacao",
  INICIATIVA:        "eduxp_iniciativa",
  QUALIDADE:         "eduxp_qualidade",
  TRABALHO_EQUIPE:   "eduxp_trabalhoequipe",
  PONTUALIDADE:      "eduxp_pontualidade",
  RESOLUCAO_PROBLEMA:"eduxp_resolucaoproblema",
  MEDIA_GERAL:       "eduxp_mediageral",
  DATA_AVALIACAO:    "eduxp_dataavaliacao",
  PERIODO_REF:       "eduxp_periodoreferencia",
  LK_USUARIO_VAL:    "_eduxp_usuarioid_value",
};

const SEL = Object.values(COL).join(",");

function normGuid(x) { return String(x || "").trim().replace(/[{}]/g, "").toLowerCase(); }
function q(req, key) { return req.query?.get?.(key) || req.query?.[key] || ""; }
function odataStr(v) { return `'${String(v).replace(/'/g, "''")}'`; }

function normalize(r) {
  if (!r) return null;
  return {
    id:                r[COL.ID] ?? null,
    usuarioId:         r[COL.LK_USUARIO_VAL] ?? null,
    comunicacao:       r[COL.COMUNICACAO] ?? null,
    iniciativa:        r[COL.INICIATIVA] ?? null,
    qualidade:         r[COL.QUALIDADE] ?? null,
    trabalhoEquipe:    r[COL.TRABALHO_EQUIPE] ?? null,
    pontualidade:      r[COL.PONTUALIDADE] ?? null,
    resolucaoProblema: r[COL.RESOLUCAO_PROBLEMA] ?? null,
    mediaGeral:        r[COL.MEDIA_GERAL] ?? null,
    dataAvaliacao:     r[COL.DATA_AVALIACAO] ?? null,
    periodoReferencia: r[COL.PERIODO_REF] ?? null,
  };
}

async function handleGet(request) {
  const id       = normGuid(request.params?.id || q(request, "id"));
  const usuarioId = normGuid(q(request, "usuarioId") || q(request, "usuarioid"));
  const periodo   = q(request, "periodoReferencia") || q(request, "periodoreferencia");
  const top       = Math.min(parseInt(q(request, "top") || "50", 10) || 50, 5000);

  if (id) {
    const r = await getRecordById(TABLE, id, { select: SEL });
    return r ? { jsonBody: normalize(r) } : { status: 404, jsonBody: { error: "Não encontrado." } };
  }

  const filters = [];
  if (usuarioId) filters.push(`${COL.LK_USUARIO_VAL} eq ${usuarioId}`);
  if (periodo)   filters.push(`${COL.PERIODO_REF} eq ${odataStr(periodo)}`);

  const result = await listRecords(TABLE, { select: SEL, filter: filters.join(" and ") || undefined, top });
  return { jsonBody: { items: (result?.value || []).map(normalize), nextLink: result?.["@odata.nextLink"] || null } };
}

async function handlePost(request) {
  const body = await request.json().catch(() => ({}));
  const usuarioId = normGuid(body.usuarioId);
  if (!usuarioId) return { status: 400, jsonBody: { error: "usuarioId é obrigatório." } };

  await createRecord(TABLE, {
    "eduxp_usuarioid@odata.bind":  `/eduxp_usuarios(${usuarioId})`,
    [COL.COMUNICACAO]:        body.comunicacao       ?? null,
    [COL.INICIATIVA]:         body.iniciativa        ?? null,
    [COL.QUALIDADE]:          body.qualidade         ?? null,
    [COL.TRABALHO_EQUIPE]:    body.trabalhoEquipe    ?? null,
    [COL.PONTUALIDADE]:       body.pontualidade      ?? null,
    [COL.RESOLUCAO_PROBLEMA]: body.resolucaoProblema ?? null,
    [COL.MEDIA_GERAL]:        body.mediaGeral        ?? null,
    [COL.DATA_AVALIACAO]:     body.dataAvaliacao     ?? null,
    [COL.PERIODO_REF]:        body.periodoReferencia ?? null,
  });
  return { status: 201, jsonBody: { message: "Performance criada com sucesso." } };
}

async function handlePut(request) {
  const id = normGuid(request.params?.id || q(request, "id"));
  if (!id) return { status: 400, jsonBody: { error: "ID obrigatório." } };

  const body = await request.json().catch(() => ({}));
  const upd  = {};
  if (body.comunicacao       !== undefined) upd[COL.COMUNICACAO]        = body.comunicacao;
  if (body.iniciativa        !== undefined) upd[COL.INICIATIVA]         = body.iniciativa;
  if (body.qualidade         !== undefined) upd[COL.QUALIDADE]          = body.qualidade;
  if (body.trabalhoEquipe    !== undefined) upd[COL.TRABALHO_EQUIPE]    = body.trabalhoEquipe;
  if (body.pontualidade      !== undefined) upd[COL.PONTUALIDADE]       = body.pontualidade;
  if (body.resolucaoProblema !== undefined) upd[COL.RESOLUCAO_PROBLEMA] = body.resolucaoProblema;
  if (body.mediaGeral        !== undefined) upd[COL.MEDIA_GERAL]        = body.mediaGeral;
  if (body.dataAvaliacao     !== undefined) upd[COL.DATA_AVALIACAO]     = body.dataAvaliacao;
  if (body.periodoReferencia !== undefined) upd[COL.PERIODO_REF]        = body.periodoReferencia;
  if (body.usuarioId         !== undefined) {
    const uid = normGuid(body.usuarioId);
    upd["eduxp_usuarioid@odata.bind"] = uid ? `/eduxp_usuarios(${uid})` : null;
  }

  if (!Object.keys(upd).length) return { status: 400, jsonBody: { error: "Envie ao menos um campo." } };
  await updateRecord(TABLE, id, upd);
  return { jsonBody: { message: "Performance atualizada.", id } };
}

async function handleDelete(request) {
  const id = normGuid(request.params?.id || q(request, "id"));
  if (!id) return { status: 400, jsonBody: { error: "ID obrigatório." } };
  await deleteRecord(TABLE, id);
  return { jsonBody: { message: "Registro excluído.", id } };
}

app.http("eduxp-performance", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/performance/{id?}",
  handler: async (request, context) => {
    try {
      const m = request.method.toUpperCase();
      if (m === "GET")    return await handleGet(request);
      if (m === "POST")   return await handlePost(request);
      if (m === "PUT")    return await handlePut(request);
      if (m === "DELETE") return await handleDelete(request);
      return { status: 405, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro Performance:", err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
