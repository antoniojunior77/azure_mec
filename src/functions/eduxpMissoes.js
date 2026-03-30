// eduxpMissoes.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_MISSAO         = "eduxp_missaos";
const TABLE_USUARIO        = "eduxp_usuarios";
const TABLE_MISSAO_USUARIO = "eduxp_missaousuarios";

const NAV_USUARIO = "eduxp_usuarioid";
const NAV_MISSAO  = "eduxp_missaoid";

const TIPO_MISSAO = {
  Normal:   100000000,
  Diaria:   100000001,
  Semanal:  100000002,
  Campanha: 100000003
};

const STATUS = {
  EM_ANDAMENTO: 100000000,
  CONCLUIDA:    100000001,
  PENDENTE:     100000002,
  EXPIRADA:     100000003
};

const COL_MU = {
  ID: "eduxp_missaousuarioid",
  OBJ: "eduxp_objetivosconcluidos",
  PERC: "eduxp_percentualconclusao",
  STATUS: "eduxp_status",
  DATAREF: "eduxp_dataref",
  RESGATADA: "eduxp_recompensaresgatada"
};

const MISS = {
  ID: "eduxp_missaoid",
  TITULO: "eduxp_titulo",
  DESCRICAO: "eduxp_descricao",
  XP: "eduxp_xprecompensa",
  MOEDAS: "eduxp_moedasrecompensa",
  TOTAL_OBJ: "eduxp_totalobjetivos",
  TIPO: "eduxp_tipomissao",
  CONQUISTA_RECOMPENSA_VAL: "_eduxp_conquistarecompensaid_value"
};

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

function normTipoKey(input) {
  const s = String(input || "").trim().toLowerCase();
  if (s === "diaria" || s === "diária" || s === "100000001") return "Diaria";
  if (s === "normal" || s === "100000000") return "Normal";
  if (s === "semanal" || s === "100000002") return "Semanal";
  if (s === "campanha" || s === "100000003") return "Campanha";
  return null;
}

function getTipoLabel(tipoValue) {
  switch (tipoValue) {
    case TIPO_MISSAO.Normal: return "Normal";
    case TIPO_MISSAO.Diaria: return "Diária";
    case TIPO_MISSAO.Semanal: return "Semanal";
    case TIPO_MISSAO.Campanha: return "Campanha";
    default: return null;
  }
}

function getTodayDateRef() {
  return new Date().toISOString().slice(0, 10);
}

app.http("eduxp-missoes", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/missoes/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpMissoes:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Missões", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  const tipo = String(request.query.get("tipo") || "").trim().toLowerCase();

  const selectCols = [
    MISS.ID, MISS.TITULO, MISS.DESCRICAO,
    MISS.XP, MISS.MOEDAS, MISS.TOTAL_OBJ,
    MISS.TIPO, MISS.CONQUISTA_RECOMPENSA_VAL
  ].join(",");

  if (id) {
    const result = await getRecordById(TABLE_MISSAO, id, { select: selectCols });
    if (!result) return { status: 404, headers: CORS, jsonBody: { error: "Missão não encontrada" } };

    return {
      status: 200, headers: CORS, jsonBody: {
        id: result[MISS.ID],
        titulo: result[MISS.TITULO],
        descricao: result[MISS.DESCRICAO],
        xpRecompensa: result[MISS.XP],
        moedasRecompensa: result[MISS.MOEDAS],
        totalObjetivos: result[MISS.TOTAL_OBJ],
        tipoMissao: result[MISS.TIPO],
        tipoMissaoLabel: getTipoLabel(result[MISS.TIPO]),
        conquistaRecompensaId: result[MISS.CONQUISTA_RECOMPENSA_VAL] || null
      }
    };
  }

  let filter = null;
  if (tipo) {
    const key = normTipoKey(tipo);
    if (!key) return { status: 400, headers: CORS, jsonBody: { error: "tipo inválido. Use: diaria|normal|semanal|campanha" } };
    filter = `${MISS.TIPO} eq ${TIPO_MISSAO[key]}`;
  }

  const result = await listRecords(TABLE_MISSAO, { select: selectCols, filter, top: 500 });

  const items = (result?.value || []).map(m => ({
    id: m[MISS.ID],
    titulo: m[MISS.TITULO],
    descricao: m[MISS.DESCRICAO],
    xpRecompensa: m[MISS.XP],
    moedasRecompensa: m[MISS.MOEDAS],
    totalObjetivos: m[MISS.TOTAL_OBJ],
    tipoMissao: m[MISS.TIPO],
    tipoMissaoLabel: getTipoLabel(m[MISS.TIPO]),
    conquistaRecompensaId: m[MISS.CONQUISTA_RECOMPENSA_VAL] || null
  }));

  return { status: 200, headers: CORS, jsonBody: { items, count: items.length } };
}

async function handlePost(request, context) {
  const body = await request.json();
  const titulo = (body.titulo || "").trim();

  if (!titulo) return { status: 400, headers: CORS, jsonBody: { error: "titulo é obrigatório." } };

  const tipoKey = normTipoKey(body.tipoMissao);
  if (!tipoKey) {
    return {
      status: 400, headers: CORS, jsonBody: {
        error: "tipoMissao é obrigatório. Use: Normal, Diaria, Semanal ou Campanha",
        valoresAceitos: Object.keys(TIPO_MISSAO)
      }
    };
  }

  const tipoVal = TIPO_MISSAO[tipoKey];

  const createMissaoBody = {
    [MISS.TITULO]: titulo,
    [MISS.DESCRICAO]: (body.descricao || "").trim() || null,
    [MISS.XP]: body.xpRecompensa ?? 0,
    [MISS.MOEDAS]: body.moedasRecompensa ?? 0,
    [MISS.TOTAL_OBJ]: body.totalObjetivos ?? 0,
    [MISS.TIPO]: tipoVal
  };

  const createdMissao = await createRecord(TABLE_MISSAO, createMissaoBody, {
    idField: MISS.ID,
    returnRepresentation: true
  });

  const missaoId = createdMissao?.id || createdMissao?.record?.[MISS.ID];

  if (!missaoId) return { status: 500, headers: CORS, jsonBody: { error: "Falha ao criar missão - ID não retornado" } };

  // Vincular a todos os usuários
  const usuariosResult = await listRecords(TABLE_USUARIO, {
    select: "eduxp_usuarioid",
    filter: "statecode eq 0",
    top: 5000
  });

  const usuarios = usuariosResult?.value || [];

  if (!usuarios.length) {
    return {
      status: 201, headers: CORS, jsonBody: {
        message: "Missão criada com sucesso (sem usuários para vincular).",
        id: missaoId, tipoMissao: tipoVal, tipoMissaoLabel: tipoKey, usuariosVinculados: 0
      }
    };
  }

  let vinculados = 0;
  let erros = 0;
  const isDiaria = tipoVal === TIPO_MISSAO.Diaria;
  const dataRef = isDiaria ? getTodayDateRef() : null;

  for (const u of usuarios) {
    const usuarioId = u.eduxp_usuarioid;
    if (!usuarioId) continue;

    try {
      const vinculoBody = {
        [COL_MU.OBJ]: 0,
        [COL_MU.PERC]: 0,
        [COL_MU.STATUS]: STATUS.PENDENTE,
        [COL_MU.RESGATADA]: false,
        [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
        [`${NAV_MISSAO}@odata.bind`]: `/${TABLE_MISSAO}(${normGuid(missaoId)})`
      };

      if (isDiaria && dataRef) vinculoBody[COL_MU.DATAREF] = dataRef;

      await createRecord(TABLE_MISSAO_USUARIO, vinculoBody);
      vinculados++;
    } catch (err) {
      context.warn(`Erro ao vincular usuário ${usuarioId} à missão ${missaoId}:`, err?.message);
      erros++;
    }
  }

  return {
    status: 201, headers: CORS, jsonBody: {
      message: "Missão criada e vinculada a todos os usuários.",
      id: missaoId, titulo, tipoMissao: tipoVal, tipoMissaoLabel: tipoKey,
      usuariosVinculados: vinculados,
      erros: erros > 0 ? erros : undefined,
      ...(isDiaria ? { dataRef } : {})
    }
  };
}

async function handlePut(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID da missão é obrigatório (rota /missoes/{id} ou ?id=...)." } };

  const body = await request.json();
  const updateBody = {};

  if (body.titulo !== undefined) updateBody[MISS.TITULO] = (body.titulo || "").trim();
  if (body.descricao !== undefined) updateBody[MISS.DESCRICAO] = (body.descricao || "").trim();
  if (body.xpRecompensa !== undefined) updateBody[MISS.XP] = body.xpRecompensa;
  if (body.moedasRecompensa !== undefined) updateBody[MISS.MOEDAS] = body.moedasRecompensa;
  if (body.totalObjetivos !== undefined) updateBody[MISS.TOTAL_OBJ] = body.totalObjetivos;

  if (body.tipoMissao !== undefined) {
    const tipoKey = normTipoKey(body.tipoMissao);
    if (tipoKey) {
      updateBody[MISS.TIPO] = TIPO_MISSAO[tipoKey];
    } else {
      return { status: 400, headers: CORS, jsonBody: { error: "tipoMissao inválido. Use: Normal, Diaria, Semanal ou Campanha" } };
    }
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie pelo menos um campo para atualizar." } };

  await updateRecord(TABLE_MISSAO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Missão atualizada com sucesso.", id } };
}

async function handleDelete(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID da missão é obrigatório." } };

  await deleteRecord(TABLE_MISSAO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Missão excluída com sucesso.", id } };
}
