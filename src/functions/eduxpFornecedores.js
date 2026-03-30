// eduxpFornecedores.js
const { app } = require("@azure/functions");
const { listRecords, getRecordById, createRecord, updateRecord, deleteRecord } = require("../shared/dataverseCrud");

const TABLE = "eduxp_fornecedors";

const SEL = [
  "eduxp_fornecedorid",
  "eduxp_nomefantasia",
  "eduxp_razaosocial",
  "eduxp_cnpj",
  "eduxp_emailcontato",
  "eduxp_telefonecontato",
  "eduxp_site",
  "eduxp_inscricaoestadual",
  "eduxp_datacadastro",
  "eduxp_ativo",
  "eduxp_observacoes",
].join(",");

function normGuid(x) { return String(x || "").trim().replace(/[{}]/g, "").toLowerCase(); }
function q(req, key) { return req.query?.get?.(key) || req.query?.[key] || ""; }

async function handleGet(request) {
  const id   = normGuid(request.params?.id || q(request, "id"));
  const cnpj = q(request, "cnpj").trim().toLowerCase();
  const top  = Math.min(parseInt(q(request, "top") || "100", 10) || 100, 5000);

  if (id) {
    const r = await getRecordById(TABLE, id, { select: SEL });
    return r ? { jsonBody: r } : { status: 404, jsonBody: { error: "Fornecedor não encontrado." } };
  }

  const result = await listRecords(TABLE, { select: SEL, top });
  let items = result?.value || [];
  if (cnpj) items = items.filter(f => (f.eduxp_cnpj || "").toLowerCase() === cnpj);
  return { jsonBody: { items, nextLink: result?.["@odata.nextLink"] || null } };
}

async function handlePost(request) {
  const body = await request.json().catch(() => ({}));
  const nomeFantasia = (body.nomeFantasia || "").trim();
  const cnpj         = (body.cnpj || "").trim();

  if (!nomeFantasia || !cnpj)
    return { status: 400, jsonBody: { error: "nomeFantasia e cnpj são obrigatórios." } };

  await createRecord(TABLE, {
    eduxp_nomefantasia:      nomeFantasia,
    eduxp_razaosocial:       (body.razaoSocial || "").trim() || null,
    eduxp_cnpj:              cnpj,
    eduxp_emailcontato:      (body.emailContato || "").trim() || null,
    eduxp_telefonecontato:   (body.telefoneContato || "").trim() || null,
    eduxp_site:              (body.site || "").trim() || null,
    eduxp_inscricaoestadual: (body.inscricaoEstadual || "").trim() || null,
    eduxp_observacoes:       (body.observacoes || "").trim() || null,
    eduxp_datacadastro:      body.dataCadastro || null,
    eduxp_ativo:             body.ativo !== undefined ? !!body.ativo : true,
  });
  return { status: 201, jsonBody: { message: "Fornecedor criado com sucesso." } };
}

async function handlePut(request) {
  const id = normGuid(request.params?.id || q(request, "id"));
  if (!id) return { status: 400, jsonBody: { error: "ID obrigatório." } };

  const body = await request.json().catch(() => ({}));
  const upd  = {};
  if (body.nomeFantasia     !== undefined) upd.eduxp_nomefantasia      = (body.nomeFantasia || "").trim();
  if (body.razaoSocial      !== undefined) upd.eduxp_razaosocial       = (body.razaoSocial || "").trim();
  if (body.cnpj             !== undefined) upd.eduxp_cnpj              = (body.cnpj || "").trim();
  if (body.emailContato     !== undefined) upd.eduxp_emailcontato      = (body.emailContato || "").trim();
  if (body.telefoneContato  !== undefined) upd.eduxp_telefonecontato   = (body.telefoneContato || "").trim();
  if (body.site             !== undefined) upd.eduxp_site              = (body.site || "").trim();
  if (body.inscricaoEstadual!== undefined) upd.eduxp_inscricaoestadual = (body.inscricaoEstadual || "").trim();
  if (body.observacoes      !== undefined) upd.eduxp_observacoes       = (body.observacoes || "").trim();
  if (body.dataCadastro     !== undefined) upd.eduxp_datacadastro      = body.dataCadastro || null;
  if (body.ativo            !== undefined) upd.eduxp_ativo             = !!body.ativo;

  if (!Object.keys(upd).length)
    return { status: 400, jsonBody: { error: "Envie ao menos um campo para atualizar." } };

  await updateRecord(TABLE, id, upd);
  return { jsonBody: { message: "Fornecedor atualizado com sucesso." } };
}

async function handleDelete(request) {
  const id = normGuid(request.params?.id || q(request, "id"));
  if (!id) return { status: 400, jsonBody: { error: "ID obrigatório." } };
  await deleteRecord(TABLE, id);
  return { jsonBody: { message: "Fornecedor excluído com sucesso." } };
}

app.http("eduxp-fornecedores", {
  methods: ["GET", "POST", "PUT", "DELETE"],
  authLevel: "function",
  route: "eduxp/fornecedores/{id?}",
  handler: async (request, context) => {
    try {
      const m = request.method.toUpperCase();
      if (m === "GET")    return await handleGet(request);
      if (m === "POST")   return await handlePost(request);
      if (m === "PUT")    return await handlePut(request);
      if (m === "DELETE") return await handleDelete(request);
      return { status: 405, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro Fornecedores:", err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
