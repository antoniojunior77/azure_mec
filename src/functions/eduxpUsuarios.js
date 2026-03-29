// eduxpUsuarios.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_USUARIO   = "eduxp_usuarios";
const TABLE_FORNECEDOR = "eduxp_fornecedors";

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) {
  return String(x || "").trim().replace(/[{}]/g, "");
}

function normEmail(x) {
  return String(x || "").trim().toLowerCase();
}

function calcLevelFromXp(xp) {
  // Threshold por nível (índice = nível, valor = XP mínimo para entrar no nível)
  const thresholds = [0, 100, 250, 500, 900, 1400, 2000, 2800, 3800, 5000, 6500];
  let nivelAtual = 1;
  for (let i = thresholds.length - 1; i >= 1; i--) {
    if (xp >= thresholds[i]) { nivelAtual = i + 1; break; }
  }
  if (nivelAtual < 1) nivelAtual = 1;

  const xpMinNivelAtual = thresholds[nivelAtual - 1] ?? 0;
  const xpMinProximoNivel = thresholds[nivelAtual] ?? null;

  const xpDentroDoNivel = xp - xpMinNivelAtual;
  const xpParaProximoNivel = xpMinProximoNivel !== null ? xpMinProximoNivel - xp : null;
  const range = xpMinProximoNivel !== null ? xpMinProximoNivel - xpMinNivelAtual : null;
  const progressoProximoNivel = range ? Math.min(100, Math.round((xpDentroDoNivel / range) * 100)) : 100;

  return { nivelAtual, xpTotal: xp, xpMinNivelAtual, xpMinProximoNivel, xpDentroDoNivel, xpParaProximoNivel, progressoProximoNivel };
}

function enrichUser(u) {
  if (!u) return null;
  const xpInfo = calcLevelFromXp(u?.eduxp_pontos || 0);
  return {
    ...u,
    xpInfo,
    fornecedorId: u._eduxp_fornecedorid_value || null,
    fornecedorNomeFantasia: u.eduxp_fornecedorid?.eduxp_nomefantasia || null
  };
}

function isDataverse404(err) {
  const msg = String(err?.message || "");
  return msg.includes("Dataverse error 404") || msg.includes("0x80040217");
}

app.http("eduxp-usuarios", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/usuarios/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpUsuarios:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Usuários", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || request.query.get("Id") || "");
  const emailParam = normEmail(request.query.get("email") || request.query.get("Email") || "");

  const selectCols = [
    "eduxp_usuarioid",
    "eduxp_nome",
    "eduxp_email",
    "eduxp_nivel",
    "eduxp_pontos",
    "eduxp_moedas",
    "eduxp_perfil",
    "_eduxp_fornecedorid_value"
  ].join(",");

  const expand = "eduxp_fornecedorid($select=eduxp_fornecedorid,eduxp_nomefantasia)";

  if (id) {
    try {
      const result = await getRecordById(TABLE_USUARIO, id, { select: selectCols, expand });
      if (!result) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };
      return { status: 200, headers: CORS, jsonBody: enrichUser(result) };
    } catch (err) {
      if (isDataverse404(err)) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };
      throw err;
    }
  }

  if (emailParam) {
    try {
      const r = await listRecords(TABLE_USUARIO, {
        select: selectCols,
        expand,
        top: 1,
        filter: `eduxp_email eq '${emailParam.replace(/'/g, "''")}'`
      });
      const usuario = r?.value?.[0] || null;
      return { status: 200, headers: CORS, jsonBody: enrichUser(usuario) };
    } catch {
      const r = await listRecords(TABLE_USUARIO, { select: selectCols, expand, top: 5000 });
      const all = r?.value || [];
      const usuario = all.find(u => normEmail(u.eduxp_email) === emailParam) || null;
      return { status: 200, headers: CORS, jsonBody: enrichUser(usuario) };
    }
  }

  const result = await listRecords(TABLE_USUARIO, { select: selectCols, expand, top: 5000 });
  return { status: 200, headers: CORS, jsonBody: (result?.value || []).map(enrichUser) };
}

async function handlePost(request, context) {
  const body = await request.json();

  const nome = String(body.nome ?? body.eduxp_nome ?? "").trim();
  const email = normEmail(body.email ?? body.eduxp_email ?? "");
  const fornecedorId = normGuid(body.fornecedorId ?? body.eduxp_fornecedor ?? "");

  if (!email) return { status: 400, headers: CORS, jsonBody: { error: "email é obrigatório." } };

  const createBody = {
    eduxp_nome: nome || null,
    eduxp_email: email,
    eduxp_nivel: body.nivel ?? body.eduxp_nivel ?? 1,
    eduxp_pontos: body.pontos ?? body.eduxp_pontos ?? 0,
    eduxp_moedas: body.moedas ?? body.eduxp_moedas ?? 0,
    eduxp_perfil: body.perfil ?? body.eduxp_perfil ?? 4
  };

  if (fornecedorId) {
    createBody["eduxp_fornecedorid@odata.bind"] = `/${TABLE_FORNECEDOR}(${fornecedorId})`;
  }

  await createRecord(TABLE_USUARIO, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Usuário criado com sucesso." } };
}

async function handlePut(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || request.query.get("Id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID é obrigatório. Use /eduxp/usuarios/{id} ou ?id={GUID}" } };

  const body = await request.json();
  const updateBody = {};

  if (body.nome !== undefined || body.eduxp_nome !== undefined) {
    updateBody.eduxp_nome = String(body.nome ?? body.eduxp_nome ?? "").trim() || null;
  }
  if (body.email !== undefined || body.eduxp_email !== undefined) {
    updateBody.eduxp_email = normEmail(body.email ?? body.eduxp_email);
  }
  if (body.nivel !== undefined || body.eduxp_nivel !== undefined) {
    updateBody.eduxp_nivel = body.nivel ?? body.eduxp_nivel;
  }
  if (body.pontos !== undefined || body.eduxp_pontos !== undefined) {
    updateBody.eduxp_pontos = body.pontos ?? body.eduxp_pontos;
  }
  if (body.moedas !== undefined || body.eduxp_moedas !== undefined) {
    updateBody.eduxp_moedas = body.moedas ?? body.eduxp_moedas;
  }
  if (body.perfil !== undefined || body.eduxp_perfil !== undefined) {
    updateBody.eduxp_perfil = body.perfil ?? body.eduxp_perfil;
  }
  if (body.fornecedorId !== undefined) {
    const fId = normGuid(body.fornecedorId);
    if (fId) {
      updateBody["eduxp_fornecedorid@odata.bind"] = `/${TABLE_FORNECEDOR}(${fId})`;
    } else {
      updateBody["eduxp_fornecedorid@odata.bind"] = null;
    }
  }

  if (!Object.keys(updateBody).length) {
    return { status: 400, headers: CORS, jsonBody: { error: "Envie pelo menos um campo para atualizar (nome, email, nivel, pontos, moedas, fornecedorId)." } };
  }

  await updateRecord(TABLE_USUARIO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Usuário atualizado com sucesso." } };
}

async function handleDelete(request, context) {
  const id = normGuid(request.params.id || request.query.get("id") || request.query.get("Id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID é obrigatório. Use /eduxp/usuarios/{id} ou ?id={GUID}" } };

  await deleteRecord(TABLE_USUARIO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Usuário excluído com sucesso." } };
}
