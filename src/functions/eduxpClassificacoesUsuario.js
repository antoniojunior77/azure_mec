// eduxpClassificacoesUsuario.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_CLASSIFICACAO_USUARIO = "eduxp_classificacaousuarios";
const TABLE_USUARIO               = "eduxp_usuarios";
const TABLE_CLASSIFICACAO         = "eduxp_classificacaos";

const CORS = { "Access-Control-Allow-Origin": "*" };

app.http("eduxp-classificacoesUsuario", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/classificacoesUsuario/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpClassificacoesUsuario:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de ClassificacoesUsuario", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const idRaw              = (request.params.id || request.query.get("id") || "").trim();
  const usuarioIdRaw       = (request.query.get("usuarioId") || "").trim();
  const classificacaoIdRaw = (request.query.get("classificacaoId") || "").trim();

  const usuarioId       = usuarioIdRaw.toLowerCase();
  const classificacaoId = classificacaoIdRaw.toLowerCase();

  const selectColsVinculo = [
    "eduxp_classificacaousuarioid",
    "_eduxp_usuarioid_value",
    "_eduxp_classificacaoid_value",
    "eduxp_posicao",
    "eduxp_pontos"
  ].join(",");

  if (idRaw) {
    const vinculo = await getRecordById(TABLE_CLASSIFICACAO_USUARIO, idRaw, { select: selectColsVinculo });

    if (!vinculo) return { status: 404, headers: CORS, jsonBody: { error: "Vínculo ClassificacaoUsuario não encontrado." } };

    const usuarioRefId       = vinculo._eduxp_usuarioid_value;
    const classificacaoRefId = vinculo._eduxp_classificacaoid_value;

    let usuarioNome = null;
    let classificacaoNome = null;

    if (usuarioRefId) {
      const u = await getRecordById(TABLE_USUARIO, usuarioRefId, { select: "eduxp_usuarioid,eduxp_nome" });
      usuarioNome = u?.eduxp_nome || null;
    }

    if (classificacaoRefId) {
      const c = await getRecordById(TABLE_CLASSIFICACAO, classificacaoRefId, { select: "eduxp_classificacaoid,eduxp_nome" });
      classificacaoNome = c?.eduxp_nome || null;
    }

    return { status: 200, headers: CORS, jsonBody: { ...vinculo, usuarioNome, classificacaoNome } };
  }

  const result = await listRecords(TABLE_CLASSIFICACAO_USUARIO, { select: selectColsVinculo, top: 5000 });
  let all = result?.value ?? [];

  if (usuarioId) {
    all = all.filter(r => (r._eduxp_usuarioid_value || "").toLowerCase() === usuarioId);
  }

  if (classificacaoId) {
    all = all.filter(r => (r._eduxp_classificacaoid_value || "").toLowerCase() === classificacaoId);
  }

  if (!all.length) return { status: 200, headers: CORS, jsonBody: [] };

  const usuariosResult = await listRecords(TABLE_USUARIO, { select: "eduxp_usuarioid,eduxp_nome", top: 5000 });
  const usuariosMap = new Map((usuariosResult?.value || [])
    .filter(u => u.eduxp_usuarioid)
    .map(u => [u.eduxp_usuarioid.toLowerCase(), u.eduxp_nome || null]));

  const classifsResult = await listRecords(TABLE_CLASSIFICACAO, { select: "eduxp_classificacaoid,eduxp_nome", top: 5000 });
  const classifsMap = new Map((classifsResult?.value || [])
    .filter(c => c.eduxp_classificacaoid)
    .map(c => [c.eduxp_classificacaoid.toLowerCase(), c.eduxp_nome || null]));

  const payload = all.map(v => {
    const uId = (v._eduxp_usuarioid_value || "").toLowerCase();
    const cId = (v._eduxp_classificacaoid_value || "").toLowerCase();
    return {
      id: v.eduxp_classificacaousuarioid,
      usuarioId: v._eduxp_usuarioid_value,
      classificacaoId: v._eduxp_classificacaoid_value,
      posicao: v.eduxp_posicao,
      pontos: v.eduxp_pontos,
      usuarioNome: usuariosMap.get(uId) || null,
      classificacaoNome: classifsMap.get(cId) || null
    };
  });

  return { status: 200, headers: CORS, jsonBody: payload };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioId       = (body.usuarioId || "").trim();
  const classificacaoId = (body.classificacaoId || "").trim();
  const posicao         = body.posicao;
  const pontos          = body.pontos;

  if (!usuarioId || !classificacaoId) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId e classificacaoId são obrigatórios." } };

  const createBody = {
    eduxp_posicao: posicao ?? 0,
    eduxp_pontos:  pontos  ?? 0,
    "eduxp_Usuario@odata.bind":       `/${TABLE_USUARIO}(${usuarioId})`,
    "eduxp_Classificacao@odata.bind": `/${TABLE_CLASSIFICACAO}(${classificacaoId})`
  };

  await createRecord(TABLE_CLASSIFICACAO_USUARIO, createBody);
  return { status: 201, headers: CORS, jsonBody: { message: "Classificação de usuário registrada com sucesso." } };
}

async function handlePut(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID de ClassificacaoUsuario é obrigatório na query (?id={GUID}) para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.posicao !== undefined) updateBody.eduxp_posicao = body.posicao;
  if (body.pontos !== undefined) updateBody.eduxp_pontos = body.pontos;

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie pelo menos um campo para atualizar (posicao, pontos)." } };

  await updateRecord(TABLE_CLASSIFICACAO_USUARIO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Classificação de usuário atualizada com sucesso." } };
}

async function handleDelete(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID de ClassificacaoUsuario é obrigatório na query (?id={GUID}) para DELETE." } };

  await deleteRecord(TABLE_CLASSIFICACAO_USUARIO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Classificação de usuário excluída com sucesso." } };
}
