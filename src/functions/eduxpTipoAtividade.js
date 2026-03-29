// eduxpTipoAtividade.js
const { app } = require("@azure/functions");
const { listRecords, getRecordById, createRecord } = require("../shared/dataverseCrud");

const TABLE = "eduxp_tipoatividades";

const SEL = ["eduxp_tipoatividadeid", "eduxp_nome", "eduxp_xpbase", "eduxp_pontosbase", "eduxp_moedasbase"].join(",");

function q(req, key) { return req.query?.get?.(key) || req.query?.[key] || ""; }

async function handleGet(request) {
  const id   = request.params?.id || "";
  const nome = q(request, "nome").trim().toLowerCase();

  if (id) {
    const r = await getRecordById(TABLE, id, { select: SEL });
    return { jsonBody: r || null };
  }

  const result = await listRecords(TABLE, { select: SEL, top: 5000 });
  let items = result?.value || [];
  if (nome) items = items.filter(r => (r.eduxp_nome || "").trim().toLowerCase() === nome);
  return { jsonBody: items };
}

async function handlePost(request) {
  const body = await request.json().catch(() => ({}));
  const nome = (body.nome || "").trim();
  if (!nome) return { status: 400, jsonBody: { error: "nome é obrigatório." } };

  await createRecord(TABLE, {
    eduxp_nome:       nome,
    eduxp_xpbase:     body.xpBase     ?? 0,
    eduxp_pontosbase: body.pontosBase  ?? 0,
    eduxp_moedasbase: body.moedasBase  ?? 0,
  });
  return { status: 201, jsonBody: { message: "Tipo de atividade criado com sucesso." } };
}

app.http("eduxp-tipoAtividade", {
  methods: ["GET", "POST"],
  authLevel: "function",
  route: "eduxp/tipoAtividade/{id?}",
  handler: async (request, context) => {
    try {
      const m = request.method.toUpperCase();
      if (m === "GET")  return await handleGet(request);
      if (m === "POST") return await handlePost(request);
      return { status: 405, jsonBody: { error: "Método não suportado" } };
    } catch (err) {
      context.error("Erro TipoAtividade:", err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
