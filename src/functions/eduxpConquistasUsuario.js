// eduxpConquistasUsuario.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_CONQUISTA_USUARIO = "eduxp_conquistausuarios";
const TABLE_USUARIO           = "eduxp_usuarios";
const TABLE_CONQUISTA         = "eduxp_conquistas";

const COL = {
  ID: "eduxp_conquistausuarioid",
  DATA: "eduxp_dataconquista",
  LK_USUARIO_VAL: "_eduxp_usuarioid_value",
  LK_CONQUISTA_VAL: "_eduxp_conquistaid_value"
};

const NAV_USUARIO   = "eduxp_UsuarioID";
const NAV_CONQUISTA = "eduxp_ConquistaID";

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "").toLowerCase();
}

function normalizeItem(row) {
  if (!row) return null;
  return {
    id: row[COL.ID] ?? null,
    usuarioId: row[COL.LK_USUARIO_VAL] ?? null,
    conquistaId: row[COL.LK_CONQUISTA_VAL] ?? null,
    dataConquista: row[COL.DATA] ?? null
  };
}

function toDateOnly(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

app.http("eduxp-conquistasUsuario", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/conquistasUsuario/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpConquistasUsuario:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de ConquistasUsuario", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  const usuarioIdParam = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();
  const emailParam = (request.query.get("email") || "").trim();
  const conquistaId = (request.query.get("conquistaId") || request.query.get("conquistaid") || "").trim();
  const top = Math.min(parseInt(request.query.get("top") || "100", 10) || 100, 5000);
  const selectCols = [COL.ID, COL.DATA, COL.LK_USUARIO_VAL, COL.LK_CONQUISTA_VAL].join(",");

  if (id) {
    const v = await getRecordById(TABLE_CONQUISTA_USUARIO, id, { select: selectCols });
    return { status: v ? 200 : 404, headers: CORS, jsonBody: v ? normalizeItem(v) : { error: "Registro não encontrado." } };
  }

  let usuarioId = usuarioIdParam;
  let resolvedVia = null;

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId && !conquistaId) {
    const result = await listRecords(TABLE_CONQUISTA_USUARIO, {
      select: selectCols, top, orderby: `${COL.DATA} desc`
    });
    return {
      status: 200, headers: CORS, jsonBody: {
        items: (result?.value ?? []).map(normalizeItem).filter(Boolean),
        count: (result?.value ?? []).length,
        nextLink: result?.["@odata.nextLink"] || null
      }
    };
  }

  const filters = [];
  if (usuarioId) filters.push(`${COL.LK_USUARIO_VAL} eq ${normGuid(usuarioId)}`);
  if (conquistaId) filters.push(`${COL.LK_CONQUISTA_VAL} eq ${normGuid(conquistaId)}`);

  const result = await listRecords(TABLE_CONQUISTA_USUARIO, {
    select: selectCols, filter: filters.join(" and "), top, orderby: `${COL.DATA} desc`
  });

  return {
    status: 200, headers: CORS, jsonBody: {
      items: (result?.value ?? []).map(normalizeItem).filter(Boolean),
      count: (result?.value ?? []).length,
      resolvedVia, nextLink: result?.["@odata.nextLink"] || null
    }
  };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioIdParam = (body.usuarioId || "").trim();
  const emailParam = (body.email || "").trim();
  const conquistaId = (body.conquistaId || "").trim();

  if (!conquistaId) return { status: 400, headers: CORS, jsonBody: { error: "conquistaId é obrigatório." } };

  let usuarioId = usuarioIdParam;
  let resolvedVia = "direct";

  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
    resolvedVia = "email";
  }

  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "Informe usuarioId OU email." } };

  const existingCheck = await listRecords(TABLE_CONQUISTA_USUARIO, {
    select: COL.ID,
    filter: `${COL.LK_USUARIO_VAL} eq ${normGuid(usuarioId)} and ${COL.LK_CONQUISTA_VAL} eq ${normGuid(conquistaId)}`,
    top: 1
  });

  if ((existingCheck?.value || []).length > 0) {
    return {
      status: 200, headers: CORS, jsonBody: {
        message: "Conquista já registrada para este usuário.",
        id: existingCheck.value[0][COL.ID],
        alreadyExists: true, resolvedVia
      }
    };
  }

  const dateOnly = toDateOnly(body.dataConquista) || new Date().toISOString().slice(0, 10);

  const createBody = {
    [COL.DATA]: dateOnly,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${normGuid(usuarioId)})`,
    [`${NAV_CONQUISTA}@odata.bind`]: `/${TABLE_CONQUISTA}(${normGuid(conquistaId)})`
  };

  const created = await createRecord(TABLE_CONQUISTA_USUARIO, createBody, { idField: COL.ID, returnRepresentation: true });

  return {
    status: 201, headers: CORS, jsonBody: {
      message: "Conquista registrada para o usuário com sucesso.",
      id: created?.id || null,
      usuarioId: normGuid(usuarioId), conquistaId: normGuid(conquistaId),
      dataConquista: dateOnly, resolvedVia
    }
  };
}

async function handlePut(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.dataConquista !== undefined) {
    const d = toDateOnly(body.dataConquista);
    if (!d) return { status: 400, headers: CORS, jsonBody: { error: "dataConquista inválida. Use YYYY-MM-DD." } };
    updateBody[COL.DATA] = d;
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

  if (body.conquistaId !== undefined) {
    const c = (body.conquistaId || "").trim();
    if (!c) return { status: 400, headers: CORS, jsonBody: { error: "conquistaId veio vazio." } };
    updateBody[`${NAV_CONQUISTA}@odata.bind`] = `/${TABLE_CONQUISTA}(${normGuid(c)})`;
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  await updateRecord(TABLE_CONQUISTA_USUARIO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "ConquistaUsuario atualizada com sucesso.", id } };
}

async function handleDelete(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || "");

  if (id) {
    await deleteRecord(TABLE_CONQUISTA_USUARIO, id);
    return { status: 200, headers: CORS, jsonBody: { message: "Registro excluído com sucesso.", id } };
  }

  const usuarioIdParam = (request.query.get("usuarioId") || request.query.get("usuarioid") || "").trim();
  const emailParam = (request.query.get("email") || "").trim();
  const conquistaId = (request.query.get("conquistaId") || request.query.get("conquistaid") || "").trim();

  let usuarioId = usuarioIdParam;
  if (!usuarioId && emailParam) {
    const resolved = await resolveUsuarioByEmail(emailParam);
    if (resolved.error) return { status: 400, headers: CORS, jsonBody: { error: resolved.error } };
    usuarioId = resolved.usuarioId;
  }

  if (!usuarioId || !conquistaId) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} OU (usuarioId/email e conquistaId) para DELETE." } };

  const r = await listRecords(TABLE_CONQUISTA_USUARIO, {
    select: COL.ID,
    filter: `${COL.LK_USUARIO_VAL} eq ${normGuid(usuarioId)} and ${COL.LK_CONQUISTA_VAL} eq ${normGuid(conquistaId)}`,
    top: 5000
  });

  const items = r?.value ?? [];
  for (const it of items) {
    if (it?.[COL.ID]) await deleteRecord(TABLE_CONQUISTA_USUARIO, normGuid(it[COL.ID]));
  }

  return { status: 200, headers: CORS, jsonBody: { message: "Registros excluídos com sucesso.", deleted: items.length } };
}
