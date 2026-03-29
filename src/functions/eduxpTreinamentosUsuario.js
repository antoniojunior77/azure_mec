// eduxpTreinamentosUsuario.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");
const { dataverseRequest } = require("../shared/dataverseClient");

const TABLE_TREINAMENTO_USUARIO = "eduxp_treinamentousuarios";
const TABLE_USUARIO             = "eduxp_usuarios";
const TABLE_TREINAMENTO         = "eduxp_treinamentos";
const TABLE_ATIVIDADE           = "eduxp_atividades";
const TABLE_TIPO_ATIVIDADE      = "eduxp_tipoatividades";
const TABLE_TRANSACAO_MOEDAS    = process.env.TABLE_TRANSACAO_MOEDAS || "eduxp_transacaomoedas";

const ATIV = {
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

const COL = {
  ID: "eduxp_treinamentousuarioid",
  PERC: "eduxp_percentualconclusao",
  STATUS: "eduxp_status",
  LK_USUARIO_VAL: "_eduxp_usuarioid_value",
  LK_TREINAMENTO_VAL: "_eduxp_treinamentoid_value",
  STATE: "statecode",
  DATA_COMPRA: "eduxp_datacompra",
  MOEDAS_PAGAS: "eduxp_moedaspagas",
  STATUS_COMPRA: "eduxp_statuscompra",
  ORIGEM_LIBERACAO: "eduxp_origemliberacao"
};

const TRE = {
  ID: "eduxp_treinamentoid",
  TITULO: "eduxp_titulo",
  STATE: "statecode",
  PERMITE_COMPRA: "eduxp_permitecompra",
  PRECO_MOEDAS: "eduxp_precomoedas"
};

const USR = {
  ID: "eduxp_usuarioid",
  MOEDAS: "eduxp_moedas"
};

const NAV_USUARIO    = "eduxp_UsuarioID";
const NAV_TREINAMENTO = "eduxp_TreinamentoID";

const TX = {
  DATA: "eduxp_datatransacao",
  TIPO: "eduxp_tipo",
  VALOR: "eduxp_valor",
  SALDO_ANTES: "eduxp_saldoantes",
  SALDO_DEPOIS: "eduxp_saldodepois",
  DESCRICAO: "eduxp_descricao",
  ORIGEM_ID: "eduxp_origemid",
  ORIGEM_TIPO: "eduxp_origemtipo",
  NAV_USUARIO: "eduxp_UsuarioID"
};

const TX_TIPO = { CREDITO: 1, DEBITO: 2 };
const ORIGEM_TIPO = { TREINAMENTO: 1, MISSAO: 2, ATIVIDADE: 3, ADMIN: 4 };

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row[COL.ID] ?? null,
    usuarioId: row[COL.LK_USUARIO_VAL] ?? null,
    treinamentoId: row[COL.LK_TREINAMENTO_VAL] ?? null,
    percentualConclusao: row[COL.PERC] ?? 0,
    status: row[COL.STATUS] ?? null,
    ativo: row[COL.STATE] === 0,
    dataCompra: row[COL.DATA_COMPRA] ?? null,
    moedasPagas: row[COL.MOEDAS_PAGAS] ?? null,
    statusCompra: row[COL.STATUS_COMPRA] ?? null,
    origemLiberacao: row[COL.ORIGEM_LIBERACAO] ?? null
  };
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

async function createReturnRepresentation(entitySet, body) {
  const path = `/api/data/v9.2/${entitySet}`;
  return dataverseRequest(path, {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" }
  });
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

async function atividadeJaRegistradaParaTreinamento(usuarioId, treinamentoUsuarioId) {
  const token = `TU:${String(treinamentoUsuarioId).trim()}`;
  const filter = [
    `_eduxp_usuarioid_value eq ${normGuid(usuarioId)}`,
    `${ATIV.TOKEN} ne null`,
    `${ATIV.TOKEN} eq '${token.replace(/'/g, "''")}'`
  ].join(" and ");

  const r = await listRecords(TABLE_ATIVIDADE, { select: "eduxp_atividadeid", filter, top: 1 });
  return (r?.value || []).length > 0;
}

app.http("eduxp-treinamentosUsuario", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/treinamentosUsuario/{action?}",
  handler: async (request, context) => {
    if (request.query.get("health") === "1") {
      return { status: 200, headers: CORS, jsonBody: { ok: true, fn: "eduxpTreinamentosUsuario" } };
    }

    try {
      const method = request.method.toUpperCase();
      const action = String(request.params.action || request.query.get("action") || "").toLowerCase();
      const routeId = String(request.params.id || "").trim();

      if (method === "POST" && action === "comprar") return await handleComprar(request, context);

      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);

      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpTreinamentosUsuario:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de TreinamentosUsuario", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = String(request.query.get("id") || "").trim();
  const usuarioIdParam = String(request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();
  const emailParam = String(request.query.get("email") || "").trim();
  const treinamentoId = String(request.query.get("treinamentoId") || request.query.get("treinamentoid") || "").trim();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);

  const selectCols = [
    COL.ID, COL.PERC, COL.STATUS, COL.LK_USUARIO_VAL, COL.LK_TREINAMENTO_VAL, COL.STATE,
    COL.DATA_COMPRA, COL.MOEDAS_PAGAS, COL.STATUS_COMPRA, COL.ORIGEM_LIBERACAO
  ].join(",");

  if (id) {
    const v = await getRecordById(TABLE_TREINAMENTO_USUARIO, id, { select: selectCols });
    return { status: v ? 200 : 404, headers: CORS, jsonBody: v ? normalizeItem(v) : { error: "Registro não encontrado" } };
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
  if (treinamentoId) filters.push(`${COL.LK_TREINAMENTO_VAL} eq ${normGuid(treinamentoId)}`);

  const result = await listRecords(TABLE_TREINAMENTO_USUARIO, {
    select: selectCols,
    filter: filters.length ? filters.join(" and ") : undefined,
    top
  });

  return {
    status: 200, headers: CORS, jsonBody: {
      items: (result?.value || []).map(normalizeItem).filter(Boolean),
      count: (result?.value || []).length,
      resolvedVia,
      nextLink: result?.["@odata.nextLink"] || null
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioIdParam = String(body.usuarioId || "").trim();
  const emailParam = String(body.email || "").trim();
  const treinamentoId = String(body.treinamentoId || "").trim();

  if (!treinamentoId) return { status: 400, headers: CORS, jsonBody: { error: "treinamentoId é obrigatório." } };

  let usuarioId = usuarioIdParam;
  let resolvedVia = "direct";

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "Informe usuarioId OU email." } };

  const createBody = {
    [COL.PERC]: body.percentualConclusao ?? 0,
    [COL.STATUS]: body.status ?? null,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
    [`${NAV_TREINAMENTO}@odata.bind`]: `/${TABLE_TREINAMENTO}(${normGuid(treinamentoId)})`
  };

  const created = await createRecord(TABLE_TREINAMENTO_USUARIO, createBody, { idField: COL.ID, returnRepresentation: true });

  return {
    status: 201, headers: CORS, jsonBody: {
      message: "Treinamento vinculado ao usuário com sucesso.",
      id: created?.id || null,
      usuarioId: normGuid(usuarioId),
      treinamentoId: normGuid(treinamentoId),
      resolvedVia
    }
  };
}

async function handleComprar(request, context) {
  const body = await request.json();
  const usuarioIdParam = (body.usuarioId || "").trim();
  const emailParam = (body.email || "").trim();
  const treinamentoId = normGuid(body.treinamentoId);

  if (!treinamentoId) return { status: 400, headers: CORS, jsonBody: { error: "treinamentoId é obrigatório." } };

  let usuarioId = usuarioIdParam ? normGuid(usuarioIdParam) : null;
  let resolvedVia = "direct";

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "Informe usuarioId OU email." } };

  const treinamento = await getRecordById(TABLE_TREINAMENTO, treinamentoId, {
    select: [TRE.ID, TRE.TITULO, TRE.STATE, TRE.PERMITE_COMPRA, TRE.PRECO_MOEDAS].join(",")
  });

  if (!treinamento || treinamento[TRE.STATE] !== 0) {
    return { status: 404, headers: CORS, jsonBody: { error: "Treinamento não encontrado ou inativo." } };
  }

  const permiteCompra = !!treinamento[TRE.PERMITE_COMPRA];
  const preco = Number(treinamento[TRE.PRECO_MOEDAS] || 0);

  if (!permiteCompra) return { status: 409, headers: CORS, jsonBody: { error: "Este treinamento não está habilitado para compra." } };
  if (!preco || preco < 1) return { status: 409, headers: CORS, jsonBody: { error: "Preço inválido para compra." } };

  const jaTem = await listRecords(TABLE_TREINAMENTO_USUARIO, {
    select: COL.ID,
    filter: `${COL.LK_USUARIO_VAL} eq ${usuarioId} and ${COL.LK_TREINAMENTO_VAL} eq ${treinamentoId} and ${COL.STATE} eq 0`,
    top: 1
  });

  if ((jaTem?.value || []).length) return { status: 409, headers: CORS, jsonBody: { error: "Usuário já possui este treinamento." } };

  const user = await getRecordById(TABLE_USUARIO, usuarioId, {
    select: [USR.ID, USR.MOEDAS].join(",")
  });

  if (!user) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };

  const saldoAntes = Number(user[USR.MOEDAS] || 0);
  if (saldoAntes < preco) {
    return { status: 409, headers: CORS, jsonBody: { error: "Saldo de moedas insuficiente.", saldoAtual: saldoAntes, preco } };
  }

  const saldoDepois = saldoAntes - preco;
  const now = new Date().toISOString();

  await updateRecord(TABLE_USUARIO, usuarioId, { [USR.MOEDAS]: saldoDepois });

  const tuBody = {
    [COL.PERC]: 0,
    [COL.DATA_COMPRA]: now,
    [COL.MOEDAS_PAGAS]: preco,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`,
    [`${NAV_TREINAMENTO}@odata.bind`]: `/${TABLE_TREINAMENTO}(${treinamentoId})`
  };

  const tuCreated = await createReturnRepresentation(TABLE_TREINAMENTO_USUARIO, tuBody);
  const treinamentoUsuarioId = tuCreated?.[COL.ID] || null;

  const desc = `Compra treinamento: ${treinamento[TRE.TITULO] || treinamentoId}`;
  const txBody = {
    [TX.DATA]: now,
    [TX.TIPO]: TX_TIPO.DEBITO,
    [TX.VALOR]: preco,
    [TX.SALDO_ANTES]: saldoAntes,
    [TX.SALDO_DEPOIS]: saldoDepois,
    [TX.DESCRICAO]: desc,
    [TX.ORIGEM_ID]: treinamentoUsuarioId || `TREINAMENTO:${treinamentoId}`,
    [TX.ORIGEM_TIPO]: ORIGEM_TIPO.TREINAMENTO,
    [`${TX.NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`
  };

  await createRecord(TABLE_TRANSACAO_MOEDAS, txBody);

  const tipoAtividadeId = await getTipoAtividadeIdByNome("CompraTreinamento");
  if (tipoAtividadeId) {
    await createRecord(TABLE_ATIVIDADE, {
      [ATIV.DESCR]: `Compra do treinamento: ${treinamento[TRE.TITULO] || treinamentoId} (-${preco} moedas)`,
      [ATIV.XP]: 0,
      [ATIV.PONTOS]: 0,
      [ATIV.DATA]: now,
      [`${ATIV_NAV.USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`,
      [`${ATIV_NAV.TIPO}@odata.bind`]: `/${TABLE_TIPO_ATIVIDADE}(${tipoAtividadeId})`
    });
  }

  return {
    status: 200, headers: CORS, jsonBody: {
      message: "Compra realizada com sucesso.",
      usuarioId, treinamentoId, treinamentoUsuarioId, preco, saldoAntes, saldoDepois, resolvedVia
    }
  };
}

async function handlePut(request, context) {
  const id = normGuid(request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.percentualConclusao !== undefined) updateBody[COL.PERC] = body.percentualConclusao;
  if (body.status !== undefined) updateBody[COL.STATUS] = body.status;

  if (body.usuarioId !== undefined || body.email !== undefined) {
    let resId = body.usuarioId;
    if (!resId && body.email) {
      const resolved = await resolveUsuarioByEmail(body.email);
      if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
      resId = resolved.usuarioId;
    }
    if (resId) updateBody[`${NAV_USUARIO}@odata.bind`] = `/${TABLE_USUARIO}(${normGuid(resId)})`;
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  const before = await getRecordById(TABLE_TREINAMENTO_USUARIO, id, {
    select: [COL.ID, COL.PERC, COL.STATUS, COL.LK_USUARIO_VAL, COL.LK_TREINAMENTO_VAL].join(",")
  });

  if (!before) return { status: 404, headers: CORS, jsonBody: { error: "TreinamentoUsuario não encontrado." } };

  const usuarioId = before[COL.LK_USUARIO_VAL];
  const treinamentoId = before[COL.LK_TREINAMENTO_VAL];
  const beforePerc = Number(before[COL.PERC] || 0);

  await updateRecord(TABLE_TREINAMENTO_USUARIO, id, updateBody);

  const afterPerc = body.percentualConclusao !== undefined ? Number(body.percentualConclusao || 0) : beforePerc;
  const virouConcluido = beforePerc < 100 && afterPerc >= 100;

  let rewardApplied = false;
  let xpInfo = null;
  let conquista = null;

  if (virouConcluido) {
    const jaRegistrada = await atividadeJaRegistradaParaTreinamento(usuarioId, id);

    if (!jaRegistrada) {
      const xp = 200;
      const moedas = 20;

      const user = await getRecordById(TABLE_USUARIO, usuarioId, {
        select: "eduxp_usuarioid,eduxp_pontos,eduxp_moedas"
      });

      if (user) {
        const novosPontos = Number(user.eduxp_pontos || 0) + xp;
        const novasMoedas = Number(user.eduxp_moedas || 0) + moedas;
        await updateRecord(TABLE_USUARIO, usuarioId, { eduxp_pontos: novosPontos, eduxp_moedas: novasMoedas });
        xpInfo = { xpTotal: novosPontos, moedasTotal: novasMoedas };
        rewardApplied = true;
      }

      let tipoAtividadeId = await getTipoAtividadeIdByNome("ConclusaoTreinamento");
      if (!tipoAtividadeId) {
        const created = await createRecord(TABLE_TIPO_ATIVIDADE, { eduxp_nome: "ConclusaoTreinamento" });
        tipoAtividadeId = created?.id || null;
      }

      if (tipoAtividadeId) {
        const now = new Date().toISOString();
        const token = `TU:${id}`;
        await createRecord(TABLE_ATIVIDADE, {
          [ATIV.DESCR]: `Conclusão do treinamento (+${xp} XP, +${moedas} moedas)`,
          [ATIV.TOKEN]: token,
          [ATIV.XP]: xp,
          [ATIV.PONTOS]: moedas,
          [ATIV.DATA]: now,
          [`${ATIV_NAV.USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
          [`${ATIV_NAV.TIPO}@odata.bind`]: `/${TABLE_TIPO_ATIVIDADE}(${tipoAtividadeId})`
        });
      }

      if (treinamentoId) {
        try {
          const tre = await getRecordById(TABLE_TREINAMENTO, normGuid(treinamentoId));
          const key = Object.keys(tre || {}).find(k => /conquistarecompensa.*_value$/i.test(k));
          const conquistaId = key ? tre[key] : null;

          if (conquistaId) {
            const existing = await listRecords("eduxp_conquistausuarios", {
              select: "eduxp_conquistausuarioid",
              filter: `_eduxp_usuarioid_value eq ${normGuid(usuarioId)} and _eduxp_conquistaid_value eq ${normGuid(conquistaId)}`,
              top: 1
            });
            if ((existing?.value || []).length === 0) {
              await createRecord("eduxp_conquistausuarios", {
                "eduxp_dataconquista": new Date().toISOString().slice(0, 10),
                "eduxp_UsuarioID@odata.bind": `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
                "eduxp_ConquistaID@odata.bind": `/eduxp_conquistas(${normGuid(conquistaId)})`
              });
              conquista = { created: true, conquistaId };
            } else {
              conquista = { created: false, conquistaId };
            }
          }
        } catch (e) {
          conquista = { created: false, skipped: true, reason: e?.message };
        }
      }
    }
  }

  return {
    status: 200, headers: CORS, jsonBody: {
      message: "TreinamentoUsuario atualizado com sucesso.",
      virouConcluido, rewardApplied,
      ...(xpInfo ? { xpInfo } : {}),
      ...(conquista ? { conquista } : {})
    }
  };
}

async function handleDelete(request, context) {
  const id = String(request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_TREINAMENTO_USUARIO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Registro excluído com sucesso." } };
}
