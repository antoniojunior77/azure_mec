// eduxpMissoesUsuario.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");
const { dataverseRequest } = require("../shared/dataverseClient");

const TABLE_MISSAO_USUARIO = "eduxp_missaousuarios";
const TABLE_USUARIO        = "eduxp_usuarios";
const TABLE_MISSAO         = "eduxp_missaos";
const TABLE_ATIVIDADE      = "eduxp_atividadess";
const TABLE_TIPO_ATIVIDADE = "eduxp_tipoatividadess";

const NAV_USUARIO = "eduxp_UsuarioID";
const NAV_MISSAO  = "eduxp_MissaoID";

const ATIV = {
  ID: "eduxp_atividadeid",
  DESCR: "eduxp_descricao",
  XP: "eduxp_xpganho",
  PONTOS: "eduxp_pontosganhos",
  DATA: "eduxp_dataatividade",
  TOKEN: "eduxp_token"
};

const ATIV_NAV = {
  USUARIO: "eduxp_UsuarioID",
  TIPO: "eduxp_TipoAtividadeID"
};

const TIPO_MISSAO = {
  Normal:   100000000,
  Diaria:   100000001,
  Semanal:  100000002,
  Campanha: 100000003
};

const DAILY = {
  DATAREF: "eduxp_dataref",
  RESGATADA: "eduxp_recompensaresgatada",
  DATARESGATE: "eduxp_dataresgate"
};

const COL = {
  ID: "eduxp_missaousuarioid",
  OBJ: "eduxp_objetivosconcluidos",
  PERC: "eduxp_percentualconclusao",
  STATUS: "eduxp_status",
  LK_USUARIO_VAL: "_eduxp_usuarioid_value",
  LK_MISSAO_VAL: "_eduxp_missaoid_value"
};

const STATUS = {
  EM_ANDAMENTO: 100000000,
  CONCLUIDA:    100000001,
  PENDENTE:     100000002,
  EXPIRADA:     100000003
};

const STATUS_LABEL_TO_VALUE = {
  "Em andamento": STATUS.EM_ANDAMENTO,
  "Concluída": STATUS.CONCLUIDA,
  "Concluida": STATUS.CONCLUIDA,
  "Pendente": STATUS.PENDENTE,
  "Expirada": STATUS.EXPIRADA
};

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

function toStatusValue(input) {
  if (typeof input === "number") return input;
  const label = (input ?? "").toString().trim();
  return STATUS_LABEL_TO_VALUE[label] ?? null;
}

function getStatusLabel(statusValue) {
  switch (statusValue) {
    case STATUS.EM_ANDAMENTO: return "Em andamento";
    case STATUS.CONCLUIDA: return "Concluída";
    case STATUS.PENDENTE: return "Pendente";
    case STATUS.EXPIRADA: return "Expirada";
    default: return null;
  }
}

function getTipoMissaoLabel(tipo) {
  switch (tipo) {
    case TIPO_MISSAO.Normal: return "Normal";
    case TIPO_MISSAO.Diaria: return "Diária";
    case TIPO_MISSAO.Semanal: return "Semanal";
    case TIPO_MISSAO.Campanha: return "Campanha";
    default: return "Missão";
  }
}

function parseDateRef(input) {
  const s = String(input || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseStatusList(input) {
  if (!input) return [];
  const parts = String(input).split(",").map(s => s.trim()).filter(Boolean);
  const values = [];
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= 100000000) { values.push(num); continue; }
    const val = toStatusValue(part);
    if (val !== null) values.push(val);
  }
  return values;
}

async function resolveUsuarioByEmail(email) {
  const r = await listRecords(TABLE_USUARIO, {
    select: "eduxp_usuarioid,eduxp_email",
    filter: `eduxp_email eq '${email.replace(/'/g, "''")}'`,
    top: 1
  });
  const u = r?.value?.[0];
  if (!u) return { error: `Usuário com email '${email}' não encontrado.` };
  return { usuarioId: u.eduxp_usuarioid };
}

async function creditarUsuario(usuarioId, xp, moedas) {
  const user = await getRecordById(TABLE_USUARIO, usuarioId, {
    select: "eduxp_usuarioid,eduxp_pontos,eduxp_moedas,eduxp_nivel"
  });
  if (!user) return null;

  const novosPontos = Number(user.eduxp_pontos || 0) + xp;
  const novasMoedas = Number(user.eduxp_moedas || 0) + moedas;
  await updateRecord(TABLE_USUARIO, usuarioId, { eduxp_pontos: novosPontos, eduxp_moedas: novasMoedas });

  return { xpInfo: { xpTotal: novosPontos, moedasTotal: novasMoedas } };
}

async function ensureConquistaUsuario(usuarioId, conquistaId) {
  const existing = await listRecords("eduxp_conquistausuarios", {
    select: "eduxp_conquistausuarioid",
    filter: `_eduxp_usuarioid_value eq ${normGuid(usuarioId)} and _eduxp_conquistaid_value eq ${normGuid(conquistaId)}`,
    top: 1
  });

  if ((existing?.value || []).length > 0) return { created: false };

  await createRecord("eduxp_conquistausuarios", {
    [DAILY.DATAREF]: new Date().toISOString().slice(0, 10),
    "eduxp_UsuarioID@odata.bind": `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
    "eduxp_ConquistaID@odata.bind": `/eduxp_conquistas(${normGuid(conquistaId)})`
  });

  return { created: true, pontosCreditos: 0 };
}

async function getTipoAtividadeIdByNome(nome) {
  const r = await listRecords(TABLE_TIPO_ATIVIDADE, {
    select: "eduxp_tipoatividadeid,eduxp_nome",
    top: 5000
  });
  const found = (r?.value || []).find(
    x => String(x.eduxp_nome || "").trim().toLowerCase() === nome.toLowerCase()
  );
  if (found?.eduxp_tipoatividadeid) return found.eduxp_tipoatividadeid;

  try {
    const created = await createRecord(TABLE_TIPO_ATIVIDADE, { eduxp_nome: nome }, {
      idField: "eduxp_tipoatividadeid",
      returnRepresentation: true
    });
    return created?.id || null;
  } catch { return null; }
}

async function criarAtividade({ usuarioId, tipoNome, descricao, xp, moedas, token }) {
  try {
    const tipoAtividadeId = await getTipoAtividadeIdByNome(tipoNome);
    if (!tipoAtividadeId) return null;

    const now = new Date().toISOString();
    const atividadeBody = {
      [ATIV.DESCR]: descricao,
      [ATIV.XP]: xp || 0,
      [ATIV.PONTOS]: moedas || 0,
      [ATIV.DATA]: now,
      [`${ATIV_NAV.USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
      [`${ATIV_NAV.TIPO}@odata.bind`]: `/${TABLE_TIPO_ATIVIDADE}(${tipoAtividadeId})`
    };
    if (token) atividadeBody[ATIV.TOKEN] = token;

    const created = await createRecord(TABLE_ATIVIDADE, atividadeBody, {
      idField: ATIV.ID,
      returnRepresentation: true
    });
    return created?.id || null;
  } catch (err) {
    console.error("Erro ao criar atividade:", err?.message);
    return null;
  }
}

async function atividadeJaRegistrada(usuarioId, token) {
  if (!token) return false;
  try {
    const r = await listRecords(TABLE_ATIVIDADE, {
      select: ATIV.ID,
      filter: `_eduxp_usuarioid_value eq ${normGuid(usuarioId)} and ${ATIV.TOKEN} eq '${token.replace(/'/g, "''")}'`,
      top: 1
    });
    return (r?.value || []).length > 0;
  } catch { return false; }
}

function getRewardForMission(missao) {
  const xpConfigurado = Number(missao?.eduxp_xprecompensa ?? 0);
  const moedasConfiguradas = Number(missao?.eduxp_moedasrecompensa ?? 0);
  if (xpConfigurado > 0 || moedasConfiguradas > 0) {
    return { xp: xpConfigurado, moedas: moedasConfiguradas };
  }
  const tipo = missao?.eduxp_tipomissao;
  if (tipo === TIPO_MISSAO.Diaria) return { xp: 50, moedas: 5 };
  if (tipo === TIPO_MISSAO.Semanal) return { xp: 150, moedas: 15 };
  if (tipo === TIPO_MISSAO.Campanha) return { xp: 500, moedas: 50 };
  return { xp: 0, moedas: 0 };
}

app.http("eduxp-missoesUsuario", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/missoesUsuario/{scope?}/{action?}/{id?}",
  handler: async (request, context) => {
    try {
      if (request.query.get("health") === "1") {
        return { status: 200, headers: CORS, jsonBody: { ok: true, fn: "eduxpMissoesUsuario" } };
      }

      const method = request.method.toUpperCase();
      const scope  = String(request.params.scope || "").toLowerCase();
      const action = String(request.params.action || "").toLowerCase();
      const idFromRoute = String(request.params.id || "").trim();

      if (scope === "diarias") {
        if (method === "GET" && !action) return await handleDiariasGet(request, context);
        if (method === "POST" && action === "gerar") return await handleDiariasGerar(request, context);
        if (method === "POST" && action === "expirar") return await handleDiariasExpirar(request, context);
        if (method === "POST" && action === "claim") return await handleDiariasClaim(request, context, idFromRoute);
        return { status: 405, headers: CORS, jsonBody: { error: "Método/ação não suportado em diarias" } };
      }

      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);

      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpMissoesUsuario:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro em eduxpMissoesUsuario", message: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = (request.query.get("id") || "").trim();
  const usuarioIdParam = (request.query.get("usuarioId") || "").trim();
  const emailParam = (request.query.get("email") || "").trim();
  const missaoId = (request.query.get("missaoId") || "").trim();
  const statusParam = (request.query.get("status") || "").trim();
  const excluirStatusParam = (request.query.get("excluirStatus") || request.query.get("excludeStatus") || "").trim();
  const tipoParam = (request.query.get("tipo") || request.query.get("tipoMissao") || "").trim().toLowerCase();

  const selectCols = [COL.ID, COL.LK_USUARIO_VAL, COL.LK_MISSAO_VAL, COL.OBJ, COL.PERC, COL.STATUS].join(",");

  if (id) {
    const v = await getRecordById(TABLE_MISSAO_USUARIO, id, { select: selectCols });
    if (!v) return { status: 404, headers: CORS, jsonBody: { error: "Vínculo não encontrado" } };
    return {
      status: 200, headers: CORS, jsonBody: {
        id: v[COL.ID], usuarioId: v[COL.LK_USUARIO_VAL], missaoId: v[COL.LK_MISSAO_VAL],
        objetivosConcluidos: v[COL.OBJ], percentualConclusao: v[COL.PERC],
        status: v[COL.STATUS], statusLabel: getStatusLabel(v[COL.STATUS])
      }
    };
  }

  let usuarioId = usuarioIdParam;
  let resolvedVia = null;

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  const filters = [];
  if (usuarioId) filters.push(`${COL.LK_USUARIO_VAL} eq ${normGuid(usuarioId)}`);
  if (missaoId) filters.push(`${COL.LK_MISSAO_VAL} eq ${normGuid(missaoId)}`);

  if (statusParam) {
    const statusValues = parseStatusList(statusParam);
    if (statusValues.length === 1) filters.push(`${COL.STATUS} eq ${statusValues[0]}`);
    else if (statusValues.length > 1) filters.push(`(${statusValues.map(s => `${COL.STATUS} eq ${s}`).join(" or ")})`);
  }

  if (excluirStatusParam) {
    const excludeValues = parseStatusList(excluirStatusParam);
    for (const sv of excludeValues) filters.push(`${COL.STATUS} ne ${sv}`);
  }

  let missaoIdsPorTipo = null;
  if (tipoParam) {
    const tipoMap = { "normal": TIPO_MISSAO.Normal, "diaria": TIPO_MISSAO.Diaria, "diária": TIPO_MISSAO.Diaria, "semanal": TIPO_MISSAO.Semanal, "campanha": TIPO_MISSAO.Campanha };
    const tipoValue = tipoMap[tipoParam] ?? parseInt(tipoParam, 10);
    if (tipoValue && !isNaN(tipoValue)) {
      const missoesDoTipo = await listRecords(TABLE_MISSAO, {
        select: "eduxp_missaoid",
        filter: `eduxp_tipomissao eq ${tipoValue}`,
        top: 5000
      });
      missaoIdsPorTipo = (missoesDoTipo?.value || []).map(m => m.eduxp_missaoid?.toLowerCase()).filter(Boolean);
      if (missaoIdsPorTipo.length === 0) {
        return { status: 200, headers: CORS, jsonBody: { items: [], count: 0, filtroTipo: tipoParam } };
      }
    }
  }

  const pageSize = Math.min(parseInt(request.query.get("top") || request.query.get("limit") || request.query.get("pageSize") || "50", 10) || 50, 5000);
  const page = parseInt(request.query.get("page") || "1", 10) || 1;
  const skipCount = parseInt(request.query.get("skip") || "0", 10) || ((page - 1) * pageSize);

  const listOptions = {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top: pageSize,
    orderby: `${COL.STATUS} asc`
  };
  if (skipCount > 0) listOptions.skip = skipCount;

  const result = await listRecords(TABLE_MISSAO_USUARIO, listOptions);

  let items = (result?.value || []).map(v => ({
    id: v[COL.ID], usuarioId: v[COL.LK_USUARIO_VAL], missaoId: v[COL.LK_MISSAO_VAL],
    objetivosConcluidos: v[COL.OBJ], percentualConclusao: v[COL.PERC],
    status: v[COL.STATUS], statusLabel: getStatusLabel(v[COL.STATUS])
  }));

  if (missaoIdsPorTipo) {
    items = items.filter(item => missaoIdsPorTipo.includes((item.missaoId || "").toLowerCase()));
  }

  const hasMore = items.length === pageSize;

  return {
    status: 200, headers: CORS, jsonBody: {
      items, count: items.length, page, pageSize, skip: skipCount,
      hasMore, nextPage: hasMore ? page + 1 : null, resolvedVia,
      ...(tipoParam ? { filtroTipo: tipoParam } : {})
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioIdParam = (body.usuarioId || "").trim();
  const emailParam = (body.email || "").trim();
  const missaoId = (body.missaoId || "").trim();

  if (!missaoId) return { status: 400, headers: CORS, jsonBody: { error: "missaoId é obrigatório" } };

  let usuarioId = usuarioIdParam;
  let resolvedVia = "direct";

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "Informe usuarioId OU email" } };

  const uNorm = normGuid(usuarioId);
  const mNorm = normGuid(missaoId);

  const missao = await getRecordById(TABLE_MISSAO, mNorm, { select: "eduxp_missaoid,eduxp_tipomissao" });
  const tipoMissao = missao?.eduxp_tipomissao ?? null;
  const isDiaria = tipoMissao === TIPO_MISSAO.Diaria;

  let filterDuplicidade = `_eduxp_usuarioid_value eq ${uNorm} and _eduxp_missaoid_value eq ${mNorm}`;
  let dataRef = null;

  if (isDiaria) {
    dataRef = new Date().toISOString().slice(0, 10);
    filterDuplicidade += ` and ${DAILY.DATAREF} eq '${dataRef}'`;
  }

  const existente = await listRecords(TABLE_MISSAO_USUARIO, {
    select: `${COL.ID},${DAILY.DATAREF}`,
    filter: filterDuplicidade,
    top: 1
  });

  const vinculoExistente = (existente?.value || [])[0];

  if (vinculoExistente) {
    return {
      status: 200, headers: CORS, jsonBody: {
        message: isDiaria ? "Vínculo já existe para esta missão diária hoje." : "Vínculo já existe.",
        id: vinculoExistente[COL.ID], usuarioId: uNorm, missaoId: mNorm,
        resolvedVia, jaExistia: true,
        ...(isDiaria ? { dataRef } : {})
      }
    };
  }

  const statusValue = (body.status !== undefined) ? toStatusValue(body.status) : STATUS.PENDENTE;
  if (statusValue === null) return { status: 400, headers: CORS, jsonBody: { error: `Status inválido.` } };

  const createBody = {
    [COL.OBJ]: body.objetivosConcluidos ?? 0,
    [COL.PERC]: body.percentualConclusao ?? 0,
    [COL.STATUS]: statusValue,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${uNorm})`,
    [`${NAV_MISSAO}@odata.bind`]: `/${TABLE_MISSAO}(${mNorm})`
  };

  if (isDiaria && dataRef) createBody[DAILY.DATAREF] = dataRef;

  const created = await createRecord(TABLE_MISSAO_USUARIO, createBody, { idField: COL.ID, returnRepresentation: true });

  return {
    status: 201, headers: CORS, jsonBody: {
      message: "Vínculo criado com sucesso.", id: created?.id || null,
      usuarioId: uNorm, missaoId: mNorm, resolvedVia, jaExistia: false,
      ...(isDiaria ? { dataRef, tipoMissao: "Diária" } : {})
    }
  };
}

async function handlePut(request, context) {
  const id = (request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT" } };

  const body = await request.json();

  const selectBefore = [COL.ID, COL.LK_USUARIO_VAL, COL.LK_MISSAO_VAL, COL.STATUS, DAILY.RESGATADA].join(",");
  const before = await getRecordById(TABLE_MISSAO_USUARIO, id, { select: selectBefore });

  if (!before) return { status: 404, headers: CORS, jsonBody: { error: "MissaoUsuario não encontrada" } };

  const beforeStatus = before[COL.STATUS];
  const usuarioIdAtual = before[COL.LK_USUARIO_VAL];
  const missaoIdAtual = before[COL.LK_MISSAO_VAL];
  const beforeResgatada = before?.[DAILY.RESGATADA] === true;

  const updateBody = {};

  if (body.objetivosConcluidos !== undefined) updateBody[COL.OBJ] = body.objetivosConcluidos;
  if (body.percentualConclusao !== undefined) updateBody[COL.PERC] = body.percentualConclusao;

  let newStatusValue = null;
  if (body.status !== undefined) {
    const st = toStatusValue(body.status);
    if (st === null) return { status: 400, headers: CORS, jsonBody: { error: "Status inválido" } };
    newStatusValue = st;
    updateBody[COL.STATUS] = st;
  }

  if (body.usuarioId !== undefined || body.email !== undefined) {
    let resId = body.usuarioId;
    if (!resId && body.email) {
      const resolved = await resolveUsuarioByEmail(body.email);
      if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
      resId = resolved.usuarioId;
    }
    if (resId) updateBody[`${NAV_USUARIO}@odata.bind`] = `/${TABLE_USUARIO}(${normGuid(resId)})`;
  }

  if (body.missaoId !== undefined) {
    const mId = (body.missaoId || "").trim();
    if (mId) updateBody[`${NAV_MISSAO}@odata.bind`] = `/${TABLE_MISSAO}(${normGuid(mId)})`;
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar" } };

  await updateRecord(TABLE_MISSAO_USUARIO, id, updateBody);

  let rewardApplied = false;
  let xpInfo = null;
  let conquista = null;
  let atividadeId = null;

  const virouConcluida = newStatusValue === STATUS.CONCLUIDA && beforeStatus !== STATUS.CONCLUIDA;

  if (virouConcluida) {
    const missao = await getRecordById(TABLE_MISSAO, missaoIdAtual, {
      select: "eduxp_missaoid,eduxp_titulo,eduxp_tipomissao,eduxp_xprecompensa,eduxp_moedasrecompensa,_eduxp_conquistarecompensaid_value"
    });

    const tipoMissao = missao?.eduxp_tipomissao ?? null;
    const missaoTitulo = missao?.eduxp_titulo || "Missão";
    const isAutoReward = (tipoMissao === TIPO_MISSAO.Normal || tipoMissao === TIPO_MISSAO.Semanal || tipoMissao === TIPO_MISSAO.Campanha);

    if (isAutoReward && !beforeResgatada) {
      const reward = getRewardForMission(missao);
      const tipoLabel = getTipoMissaoLabel(tipoMissao);
      const token = `MU:${id}`;
      const jaRegistrada = await atividadeJaRegistrada(usuarioIdAtual, token);

      if (!jaRegistrada) {
        await updateRecord(TABLE_MISSAO_USUARIO, id, {
          [DAILY.RESGATADA]: true,
          [DAILY.DATARESGATE]: new Date().toISOString()
        });

        const credit = await creditarUsuario(usuarioIdAtual, reward.xp, reward.moedas);
        xpInfo = credit?.xpInfo;
        rewardApplied = true;

        atividadeId = await criarAtividade({
          usuarioId: usuarioIdAtual,
          tipoNome: `Conclusao${tipoLabel.replace(/[^a-zA-Z]/g, "")}`,
          descricao: `Missão ${tipoLabel} concluída: ${missaoTitulo} (+${reward.xp} XP, +${reward.moedas} moedas)`,
          xp: reward.xp, moedas: reward.moedas, token
        });

        if (tipoMissao === TIPO_MISSAO.Campanha) {
          const conquistaId = missao?._eduxp_conquistarecompensaid_value || null;
          if (conquistaId) {
            const r = await ensureConquistaUsuario(usuarioIdAtual, conquistaId);
            conquista = { created: r.created, conquistaId, pontosCreditos: r.pontosCreditos || 0 };
          }
        }
      }
    }
  }

  return {
    status: 200, headers: CORS, jsonBody: {
      message: "Vínculo atualizado com sucesso.", rewardApplied,
      ...(xpInfo ? { xpInfo } : {}),
      ...(conquista ? { conquista } : {}),
      ...(atividadeId ? { atividadeId } : {})
    }
  };
}

async function handleDelete(request, context) {
  const id = (request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE" } };

  await deleteRecord(TABLE_MISSAO_USUARIO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Vínculo excluído com sucesso." } };
}

// ===== DIÁRIAS =====
async function handleDiariasGet(request, context) {
  const usuarioIdParam = (request.query.get("usuarioId") || "").trim();
  const emailParam = (request.query.get("email") || "").trim();
  const dataRef = parseDateRef(request.query.get("data") || "");

  let usuarioId = usuarioIdParam;
  let resolvedVia = null;

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId || !dataRef) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId (ou email) e data=YYYY-MM-DD são obrigatórios" } };

  const userGuid = normGuid(usuarioId);
  const filter = `_eduxp_usuarioid_value eq ${userGuid} and ${DAILY.DATAREF} eq '${dataRef}'`;

  const r = await listRecords(TABLE_MISSAO_USUARIO, {
    select: `eduxp_missaousuarioid,_eduxp_usuarioid_value,_eduxp_missaoid_value,eduxp_objetivosconcluidos,eduxp_percentualconclusao,eduxp_status,${DAILY.DATAREF},${DAILY.RESGATADA},${DAILY.DATARESGATE}`,
    filter, top: 5000
  });

  const items = r?.value || [];
  if (!items.length) return { status: 200, headers: CORS, jsonBody: { items: [], resolvedVia } };

  const missoes = await listRecords(TABLE_MISSAO, {
    select: "eduxp_missaoid,eduxp_titulo,eduxp_descricao,eduxp_xprecompensa,eduxp_moedasrecompensa,eduxp_totalobjetivos",
    filter: `eduxp_tipomissao eq ${TIPO_MISSAO.Diaria}`,
    top: 5000
  });

  const missoesMap = new Map((missoes?.value || []).map(m => [String(m.eduxp_missaoid).toLowerCase(), m]));

  const payload = items.map(v => {
    const mid = String(v["_eduxp_missaoid_value"] || "").toLowerCase();
    const m = missoesMap.get(mid) || null;
    return {
      id: v["eduxp_missaousuarioid"],
      usuarioId: v["_eduxp_usuarioid_value"],
      missaoId: v["_eduxp_missaoid_value"],
      dataRef: v[DAILY.DATAREF],
      objetivosConcluidos: v["eduxp_objetivosconcluidos"],
      percentualConclusao: v["eduxp_percentualconclusao"],
      status: v["eduxp_status"],
      recompensaResgatada: v[DAILY.RESGATADA] ?? false,
      dataResgate: v[DAILY.DATARESGATE] ?? null,
      missao: m ? {
        titulo: m.eduxp_titulo, descricao: m.eduxp_descricao,
        xpRecompensa: m.eduxp_xprecompensa, moedasRecompensa: m.eduxp_moedasrecompensa,
        totalObjetivos: m.eduxp_totalobjetivos
      } : null
    };
  });

  return { status: 200, headers: CORS, jsonBody: { items: payload, resolvedVia } };
}

async function handleDiariasGerar(request, context) {
  const body = await request.json();
  const usuarioIdParam = (body.usuarioId || "").trim();
  const emailParam = (body.email || "").trim();
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dataRef = parseDateRef(body.data || todayUtc);

  let usuarioId = usuarioIdParam;
  let resolvedVia = null;

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId || !dataRef) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId (ou email) é obrigatório" } };

  const userGuid = normGuid(usuarioId);

  const templates = await listRecords(TABLE_MISSAO, {
    select: "eduxp_missaoid,eduxp_titulo",
    filter: `eduxp_tipomissao eq ${TIPO_MISSAO.Diaria}`,
    top: 5000
  });

  const dailyTemplates = templates?.value || [];
  if (!dailyTemplates.length) {
    return { status: 200, headers: CORS, jsonBody: { message: "Nenhuma missão diária cadastrada.", created: 0, dataRef, resolvedVia } };
  }

  const existing = await listRecords(TABLE_MISSAO_USUARIO, {
    select: "eduxp_missaousuarioid,_eduxp_missaoid_value",
    filter: `_eduxp_usuarioid_value eq ${userGuid} and ${DAILY.DATAREF} eq '${dataRef}'`,
    top: 5000
  });

  const existSet = new Set((existing?.value || []).map(x => String(x["_eduxp_missaoid_value"] || "").toLowerCase()));

  let created = 0;
  for (const m of dailyTemplates) {
    const midLower = String(m.eduxp_missaoid || "").toLowerCase();
    if (!midLower || existSet.has(midLower)) continue;

    await createRecord(TABLE_MISSAO_USUARIO, {
      [COL.OBJ]: 0,
      [COL.PERC]: 0,
      [COL.STATUS]: STATUS.PENDENTE,
      [DAILY.DATAREF]: dataRef,
      [DAILY.RESGATADA]: false,
      [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${userGuid})`,
      [`${NAV_MISSAO}@odata.bind`]: `/${TABLE_MISSAO}(${normGuid(m.eduxp_missaoid)})`
    });
    created++;
  }

  return { status: 200, headers: CORS, jsonBody: { message: "Missões diárias geradas com sucesso.", dataRef, created, resolvedVia } };
}

async function handleDiariasClaim(request, context, vinculoId) {
  const id = String(vinculoId || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe o id do vínculo: /missoesUsuario/diarias/claim/{id}" } };

  const v = await getRecordById(TABLE_MISSAO_USUARIO, id, {
    select: `eduxp_missaousuarioid,_eduxp_usuarioid_value,_eduxp_missaoid_value,eduxp_status,${DAILY.RESGATADA},${DAILY.DATARESGATE},${DAILY.DATAREF}`
  });

  if (!v) return { status: 404, headers: CORS, jsonBody: { error: "Vínculo não encontrado" } };
  if (v["eduxp_status"] !== STATUS.CONCLUIDA) return { status: 409, headers: CORS, jsonBody: { error: "Missão ainda não concluída" } };
  if (v[DAILY.RESGATADA] === true) return { status: 409, headers: CORS, jsonBody: { error: "Recompensa já resgatada" } };

  const usuarioId = v["_eduxp_usuarioid_value"];
  const missaoId = v["_eduxp_missaoid_value"];
  const dataRef = v[DAILY.DATAREF] || null;

  const m = await getRecordById(TABLE_MISSAO, missaoId, {
    select: "eduxp_missaoid,eduxp_titulo,eduxp_xprecompensa,eduxp_moedasrecompensa,eduxp_tipomissao,_eduxp_conquistarecompensaid_value"
  });

  const missaoTitulo = m?.eduxp_titulo || "Missão Diária";
  const tipoMissao = m?.eduxp_tipomissao ?? TIPO_MISSAO.Diaria;
  const conquistaIdVinculada = m?._eduxp_conquistarecompensaid_value || null;

  const reward = getRewardForMission(m);
  const xp = Number(reward?.xp ?? 0);
  const moedas = Number(reward?.moedas ?? 0);

  const token = `MU:${id}`;
  const jaRegistrada = await atividadeJaRegistrada(usuarioId, token);
  if (jaRegistrada) return { status: 409, headers: CORS, jsonBody: { error: "Atividade já registrada para este claim" } };

  await updateRecord(TABLE_MISSAO_USUARIO, id, {
    [DAILY.RESGATADA]: true,
    [DAILY.DATARESGATE]: new Date().toISOString()
  });

  const credit = await creditarUsuario(usuarioId, xp, moedas);
  let xpInfoFinal = credit?.xpInfo ?? null;

  const tipoLabel = getTipoMissaoLabel(tipoMissao);
  const atividadeId = await criarAtividade({
    usuarioId, tipoNome: `ConclusaoMissao${tipoLabel.replace(/[^a-zA-Z]/g, "")}`,
    descricao: `${tipoLabel} concluída: ${missaoTitulo} (+${xp} XP, +${moedas} moedas)`,
    xp, moedas, token
  });

  let conquista = null;
  if (conquistaIdVinculada) {
    const r = await ensureConquistaUsuario(usuarioId, conquistaIdVinculada);
    conquista = { created: r.created, conquistaId: conquistaIdVinculada, pontosCreditos: r.pontosCreditos || 0 };
  }

  return {
    status: 200, headers: CORS, jsonBody: {
      message: "Recompensa resgatada com sucesso.",
      missaoTitulo, tipoMissao: tipoLabel, dataRef, xpGanho: xp, moedasGanhas: moedas,
      xpInfo: xpInfoFinal, atividadeId,
      ...(conquista ? { conquista } : {})
    }
  };
}

async function handleDiariasExpirar(request, context) {
  const body = await request.json();
  const todayUtc = new Date().toISOString().slice(0, 10);
  const ateData = parseDateRef(body.ateData || body.data || todayUtc);
  const dryRun = body.dryRun === true;

  if (!ateData) return { status: 400, headers: CORS, jsonBody: { error: "ateData (YYYY-MM-DD) inválida" } };

  const filter = [
    `${DAILY.DATAREF} lt '${ateData}'`,
    `(${COL.STATUS} eq ${STATUS.EM_ANDAMENTO} or ${COL.STATUS} eq ${STATUS.PENDENTE})`,
    `(${DAILY.RESGATADA} eq false or ${DAILY.RESGATADA} eq null)`
  ].join(" and ");

  const r = await listRecords(TABLE_MISSAO_USUARIO, { select: COL.ID, filter, top: 5000 });
  const toExpireIds = (r?.value || []).map(x => x[COL.ID]).filter(Boolean);

  if (!toExpireIds.length) return { status: 200, headers: CORS, jsonBody: { message: "Nada para expirar", found: 0, expired: 0, dryRun } };

  let expired = 0;
  if (!dryRun) {
    for (const expId of toExpireIds) {
      await updateRecord(TABLE_MISSAO_USUARIO, expId, { [COL.STATUS]: STATUS.EXPIRADA });
      expired++;
    }
  }

  return {
    status: 200, headers: CORS, jsonBody: {
      message: dryRun ? "DryRun: nada foi atualizado" : "Missões expiradas com sucesso",
      ateData, found: toExpireIds.length, expired, dryRun
    }
  };
}
