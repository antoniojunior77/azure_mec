// eduxpProjetos.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_PROJETO         = "eduxp_projetos";
const TABLE_FORNECEDOR      = "eduxp_fornecedors";
const TABLE_USUARIO         = "eduxp_usuarios";
const TABLE_PROJETO_USUARIO = "eduxp_projetousuarios";

const NAV_USUARIO = "eduxp_usuarioid";
const NAV_PROJETO = "eduxp_projetoid";

const CORS = { "Access-Control-Allow-Origin": "*" };

function normalizeGuid(value) {
  return String(value || "").trim().replace(/[{}]/g, "");
}

function mapProjeto(r) {
  if (!r) return null;
  return {
    id: r.eduxp_projetoid,
    nome: r.eduxp_nome,
    cliente: r.eduxp_cliente,
    descricao: r.eduxp_descricao,
    fornecedorId: r._eduxp_fornecedorid_value || null,
    fornecedorNomeFantasia: r.eduxp_Fornecedor?.eduxp_nomefantasia || null
  };
}

app.http("eduxp-projetos", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/projetos/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpProjetos:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de Projetos", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  const id = normalizeGuid(request.params.id || request.query.get("id") || "");
  const usuarioId = normalizeGuid(request.query.get("usuarioId") || "");

  const selectCols = [
    "eduxp_projetoid",
    "eduxp_nome",
    "eduxp_cliente",
    "eduxp_descricao",
    "_eduxp_fornecedorid_value"
  ].join(",");

  const expand = "eduxp_Fornecedor($select=eduxp_fornecedorid,eduxp_nomefantasia)";

  if (id) {
    const raw = await getRecordById(TABLE_PROJETO, id, { select: selectCols, expand });
    return { status: 200, headers: CORS, jsonBody: mapProjeto(raw) || null };
  }

  if (usuarioId) {
    const usuario = await getRecordById(TABLE_USUARIO, usuarioId, {
      select: "eduxp_usuarioid,_eduxp_fornecedorid_value"
    });

    if (!usuario) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };

    const fornecedorId = usuario._eduxp_fornecedorid_value;
    if (!fornecedorId) return { status: 200, headers: CORS, jsonBody: [] };

    const top = Math.min(parseInt(request.query.get("top") || "500", 10) || 500, 5000);
    const result = await listRecords(TABLE_PROJETO, {
      select: selectCols, expand, top,
      filter: `_eduxp_fornecedorid_value eq ${fornecedorId}`
    });

    return { status: 200, headers: CORS, jsonBody: (result?.value || []).map(mapProjeto) };
  }

  const top = Math.min(parseInt(request.query.get("top") || "500", 10) || 500, 5000);
  const result = await listRecords(TABLE_PROJETO, { select: selectCols, expand, top });
  return { status: 200, headers: CORS, jsonBody: (result?.value || []).map(mapProjeto) };
}

async function handlePost(request, context) {
  const body = await request.json();
  const nome      = (body.nome || "").trim();
  const cliente   = (body.cliente || "").trim();
  const descricao = (body.descricao || "").trim();
  const usuarioId = normalizeGuid(body.usuarioId || "");
  const papel     = (body.papel || "").trim();

  if (!nome) return { status: 400, headers: CORS, jsonBody: { error: "nome é obrigatório." } };
  if (!usuarioId) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId é obrigatório." } };

  let usuario;
  try {
    usuario = await getRecordById(TABLE_USUARIO, usuarioId, {
      select: "eduxp_usuarioid,eduxp_nome,_eduxp_fornecedorid_value"
    });
  } catch (err) {
    return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado.", detail: err?.message } };
  }

  if (!usuario) return { status: 404, headers: CORS, jsonBody: { error: "Usuário não encontrado." } };

  const fornecedorId = usuario._eduxp_fornecedorid_value;
  if (!fornecedorId) {
    return { status: 400, headers: CORS, jsonBody: { error: "Usuário não possui fornecedor vinculado." } };
  }

  const createProjetoBody = {
    eduxp_nome: nome,
    eduxp_cliente: cliente || null,
    eduxp_descricao: descricao || null,
    "eduxp_Fornecedor@odata.bind": `/${TABLE_FORNECEDOR}(${fornecedorId})`
  };

  const createdProjeto = await createRecord(TABLE_PROJETO, createProjetoBody, {
    idField: "eduxp_projetoid",
    returnRepresentation: true
  });

  const projetoId = createdProjeto.id;
  if (!projetoId) return { status: 500, headers: CORS, jsonBody: { error: "Falha ao criar projeto - ID não retornado." } };

  const createVinculoBody = {
    eduxp_papel: papel || null,
    eduxp_ativo: true,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`,
    [`${NAV_PROJETO}@odata.bind`]: `/${TABLE_PROJETO}(${projetoId})`
  };

  let projetoUsuarioId = null;
  try {
    const createdVinculo = await createRecord(TABLE_PROJETO_USUARIO, createVinculoBody, {
      idField: "eduxp_projetousuarioid",
      returnRepresentation: true
    });
    projetoUsuarioId = createdVinculo.id;
  } catch (err) {
    context.error("Erro ao criar ProjetoUsuario:", err);
    return {
      status: 201, headers: CORS, jsonBody: {
        message: "Projeto criado, mas falha ao criar vínculo com usuário.",
        projetoId, projetoUsuarioId: null, fornecedorId, vinculoError: err?.message,
        data: mapProjeto(createdProjeto.record) || { id: projetoId, nome, cliente, descricao, fornecedorId }
      }
    };
  }

  let projetoData = null;
  if (createdProjeto.record) {
    projetoData = mapProjeto(createdProjeto.record);
  } else {
    const raw = await getRecordById(TABLE_PROJETO, projetoId, {
      select: "eduxp_projetoid,eduxp_nome,eduxp_cliente,eduxp_descricao,_eduxp_fornecedorid_value"
    });
    projetoData = mapProjeto(raw);
  }

  return {
    status: 201, headers: CORS, jsonBody: {
      message: "Projeto criado com sucesso.",
      projetoId, projetoUsuarioId, fornecedorId, data: projetoData
    }
  };
}

async function handlePut(request, context) {
  const id = normalizeGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID do projeto é obrigatório na query (?id={GUID}) para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.nome !== undefined) updateBody.eduxp_nome = (body.nome || "").trim();
  if (body.cliente !== undefined) updateBody.eduxp_cliente = (body.cliente || "").trim();
  if (body.descricao !== undefined) updateBody.eduxp_descricao = (body.descricao || "").trim();

  if (body.fornecedorId !== undefined) {
    return { status: 400, headers: CORS, jsonBody: { error: "Não é permitido alterar o fornecedor de um projeto." } };
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie ao menos um campo para atualizar (nome, cliente, descricao)." } };

  await updateRecord(TABLE_PROJETO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Projeto atualizado com sucesso." } };
}

async function handleDelete(request, context) {
  const id = normalizeGuid(request.params.id || request.query.get("id") || "");
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "ID do projeto é obrigatório na query (?id={GUID}) para DELETE." } };

  const vinculos = await listRecords(TABLE_PROJETO_USUARIO, {
    select: "eduxp_projetousuarioid",
    filter: `_eduxp_projetoid_value eq ${id}`,
    top: 5000
  });

  const vinculoIds = (vinculos?.value || []).map(v => v.eduxp_projetousuarioid).filter(Boolean);
  let vinculosRemovidos = 0;

  for (const vinculoId of vinculoIds) {
    try {
      await deleteRecord(TABLE_PROJETO_USUARIO, vinculoId);
      vinculosRemovidos++;
    } catch (err) {
      context.warn(`Erro ao excluir ProjetoUsuario ${vinculoId}:`, err?.message);
    }
  }

  await deleteRecord(TABLE_PROJETO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Projeto excluído com sucesso.", projetoId: id, vinculosRemovidos } };
}
