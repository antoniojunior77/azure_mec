// eduxpProjetosUsuario.js — Azure Functions v4
const { app } = require("@azure/functions");
const {
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
} = require("../shared/dataverseCrud");

const TABLE_PROJETO_USUARIO = "eduxp_projetousuarios";
const TABLE_USUARIO         = "eduxp_usuarios";
const TABLE_PROJETO         = "eduxp_projetos";

const NAV_USUARIO = "eduxp_usuarioid";
const NAV_PROJETO = "eduxp_projetoid";

const COL = {
  ID: "eduxp_projetousuarioid",
  LK_USUARIO_VAL: "_eduxp_usuarioid_value",
  LK_PROJETO_VAL: "_eduxp_projetoid_value",
  PAPEL: "eduxp_papel",
  ATIVO: "eduxp_ativo"
};

const CORS = { "Access-Control-Allow-Origin": "*" };

app.http("eduxp-projetosUsuario", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/projetosUsuario/{id?}",
  handler: async (request, context) => {
    try {
      const method = request.method.toUpperCase();
      if (method === "GET")    return await handleGet(request, context);
      if (method === "POST")   return await handlePost(request, context);
      if (method === "PUT")    return await handlePut(request, context);
      if (method === "DELETE") return await handleDelete(request, context);
      return { status: 405, headers: CORS, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro em eduxpProjetosUsuario:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro na API de ProjetoUsuario", detail: err?.message } };
    }
  }
});

async function handleGet(request, context) {
  if (request.query.get("debugNav") === "1") {
    const r = await listRecords(TABLE_PROJETO_USUARIO, {
      select: `${COL.LK_USUARIO_VAL},${COL.LK_PROJETO_VAL}`, top: 1
    });
    const first = r?.value?.[0];
    if (!first) return { status: 404, headers: CORS, jsonBody: { error: "Não existe registro para inspecionar nav props." } };
    const navUsuario = first[`${COL.LK_USUARIO_VAL}@Microsoft.Dynamics.CRM.associatednavigationproperty`];
    const navProjeto = first[`${COL.LK_PROJETO_VAL}@Microsoft.Dynamics.CRM.associatednavigationproperty`];
    return { status: 200, headers: CORS, jsonBody: { navUsuario, navProjeto, sample: first } };
  }

  const id = (request.params.id || request.query.get("id") || "").trim();
  const usuarioId = (request.query.get("usuarioId") || "").trim();
  const projetoId = (request.query.get("projetoId") || "").trim();
  const apenasAtivos = (request.query.get("apenasAtivos") || "").toLowerCase() === "true";

  const selectCols = [COL.ID, COL.LK_USUARIO_VAL, COL.LK_PROJETO_VAL, COL.PAPEL, COL.ATIVO].join(",");

  if (id) {
    const v = await getRecordById(TABLE_PROJETO_USUARIO, id, { select: selectCols });
    if (!v) return { status: 404, headers: CORS, jsonBody: { error: "Vínculo ProjetoUsuario não encontrado." } };

    const usuarioRefId = v[COL.LK_USUARIO_VAL];
    const projetoRefId = v[COL.LK_PROJETO_VAL];

    let usuarioNome = null, projetoNome = null, projetoCliente = null;

    if (usuarioRefId) {
      const u = await getRecordById(TABLE_USUARIO, usuarioRefId, { select: "eduxp_usuarioid,eduxp_nome" });
      usuarioNome = u?.eduxp_nome ?? null;
    }
    if (projetoRefId) {
      const p = await getRecordById(TABLE_PROJETO, projetoRefId, { select: "eduxp_projetoid,eduxp_nome,eduxp_cliente" });
      projetoNome = p?.eduxp_nome ?? null;
      projetoCliente = p?.eduxp_cliente ?? null;
    }

    return {
      status: 200, headers: CORS, jsonBody: {
        id: v[COL.ID], usuarioId: v[COL.LK_USUARIO_VAL], projetoId: v[COL.LK_PROJETO_VAL],
        papel: v[COL.PAPEL], ativo: v[COL.ATIVO], usuarioNome, projetoNome, projetoCliente
      }
    };
  }

  const result = await listRecords(TABLE_PROJETO_USUARIO, { select: selectCols, top: 5000 });
  let all = result?.value ?? [];

  if (usuarioId) all = all.filter(r => (r[COL.LK_USUARIO_VAL] || "").toLowerCase() === usuarioId.toLowerCase());
  if (projetoId) all = all.filter(r => (r[COL.LK_PROJETO_VAL] || "").toLowerCase() === projetoId.toLowerCase());
  if (apenasAtivos) all = all.filter(r => r[COL.ATIVO] === true);

  if (!all.length) return { status: 200, headers: CORS, jsonBody: [] };

  const usuariosResult = await listRecords(TABLE_USUARIO, { select: "eduxp_usuarioid,eduxp_nome", top: 5000 });
  const usuariosMap = new Map((usuariosResult?.value ?? []).filter(u => u.eduxp_usuarioid).map(u => [u.eduxp_usuarioid.toLowerCase(), u.eduxp_nome || null]));

  const projetosResult = await listRecords(TABLE_PROJETO, { select: "eduxp_projetoid,eduxp_nome,eduxp_cliente", top: 5000 });
  const projetosMap = new Map((projetosResult?.value ?? []).filter(p => p.eduxp_projetoid).map(p => [
    p.eduxp_projetoid.toLowerCase(),
    { nome: p.eduxp_nome || null, cliente: p.eduxp_cliente || null }
  ]));

  const payload = all.map(v => {
    const uId = (v[COL.LK_USUARIO_VAL] || "").toLowerCase();
    const pId = (v[COL.LK_PROJETO_VAL] || "").toLowerCase();
    const projetoInfo = projetosMap.get(pId) || { nome: null, cliente: null };
    return {
      id: v[COL.ID], usuarioId: v[COL.LK_USUARIO_VAL], projetoId: v[COL.LK_PROJETO_VAL],
      papel: v[COL.PAPEL], ativo: v[COL.ATIVO],
      usuarioNome: usuariosMap.get(uId) || null,
      projetoNome: projetoInfo.nome, projetoCliente: projetoInfo.cliente
    };
  });

  return { status: 200, headers: CORS, jsonBody: payload };
}

async function handlePost(request, context) {
  const body = await request.json();
  const usuarioId = (body.usuarioId || "").trim();
  const projetoId = (body.projetoId || "").trim();

  if (!usuarioId || !projetoId) return { status: 400, headers: CORS, jsonBody: { error: "usuarioId e projetoId são obrigatórios", received: body } };

  const createBody = {
    [COL.PAPEL]: (body.papel || "").trim() || null,
    [COL.ATIVO]: body.ativo !== undefined ? !!body.ativo : true,
    [`${NAV_USUARIO}@odata.bind`]: `/${TABLE_USUARIO}(${usuarioId})`,
    [`${NAV_PROJETO}@odata.bind`]: `/${TABLE_PROJETO}(${projetoId})`
  };

  const created = await createRecord(TABLE_PROJETO_USUARIO, createBody, {
    idField: COL.ID,
    returnRepresentation: true
  });

  let payload = null;
  if (created.record) {
    payload = {
      id: created.record[COL.ID] || created.id,
      usuarioId: created.record[COL.LK_USUARIO_VAL] || usuarioId,
      projetoId: created.record[COL.LK_PROJETO_VAL] || projetoId,
      papel: created.record[COL.PAPEL] ?? (createBody[COL.PAPEL] ?? null),
      ativo: created.record[COL.ATIVO] ?? createBody[COL.ATIVO]
    };
  } else if (created.id) {
    const selectCols = [COL.ID, COL.LK_USUARIO_VAL, COL.LK_PROJETO_VAL, COL.PAPEL, COL.ATIVO].join(",");
    const raw = await getRecordById(TABLE_PROJETO_USUARIO, created.id, { select: selectCols });
    payload = raw ? {
      id: raw[COL.ID], usuarioId: raw[COL.LK_USUARIO_VAL], projetoId: raw[COL.LK_PROJETO_VAL],
      papel: raw[COL.PAPEL], ativo: raw[COL.ATIVO]
    } : { id: created.id };
  }

  return { status: 201, headers: CORS, jsonBody: { message: "Vínculo Projeto-Usuário criado com sucesso.", id: created.id, data: payload } };
}

async function handlePut(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para PUT." } };

  const body = await request.json();
  const updateBody = {};

  if (body.papel !== undefined) updateBody[COL.PAPEL] = (body.papel || "").trim() || null;
  if (body.ativo !== undefined) updateBody[COL.ATIVO] = !!body.ativo;
  if (body.usuarioId !== undefined) {
    const uid = (body.usuarioId || "").trim();
    if (uid) updateBody[`${NAV_USUARIO}@odata.bind`] = `/${TABLE_USUARIO}(${uid})`;
  }
  if (body.projetoId !== undefined) {
    const pid = (body.projetoId || "").trim();
    if (pid) updateBody[`${NAV_PROJETO}@odata.bind`] = `/${TABLE_PROJETO}(${pid})`;
  }

  if (!Object.keys(updateBody).length) return { status: 400, headers: CORS, jsonBody: { error: "Envie algum campo para atualizar." } };

  await updateRecord(TABLE_PROJETO_USUARIO, id, updateBody);
  return { status: 200, headers: CORS, jsonBody: { message: "Vínculo Projeto-Usuário atualizado com sucesso." } };
}

async function handleDelete(request, context) {
  const id = (request.params.id || request.query.get("id") || "").trim();
  if (!id) return { status: 400, headers: CORS, jsonBody: { error: "Informe ?id={GUID} para DELETE." } };

  await deleteRecord(TABLE_PROJETO_USUARIO, id);
  return { status: 200, headers: CORS, jsonBody: { message: "Vínculo Projeto-Usuário excluído com sucesso." } };
}
