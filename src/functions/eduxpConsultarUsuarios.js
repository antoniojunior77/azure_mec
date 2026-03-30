// eduxpConsultarUsuarios.js
// GET /eduxp/consultarUsuarios?email=&fornecedorId=&top=
const { app } = require("@azure/functions");
const { listRecords, getRecordById } = require("../shared/dataverseCrud");
const { calcLevelFromXp } = require("../shared/gamificacao");

const TABLE_USUARIO    = "eduxp_usuarios";
const TABLE_FORNECEDOR = "eduxp_fornecedors";

const SEL = [
  "eduxp_usuarioid",
  "eduxp_nome",
  "eduxp_email",
  "eduxp_nivel",
  "eduxp_pontos",
  "eduxp_moedas",
  "eduxp_perfil",
  "_eduxp_fornecedorid_value",
].join(",");

const EXPAND = "eduxp_fornecedorid($select=eduxp_fornecedorid,eduxp_nomefantasia)";

function normGuid(x)  { return String(x || "").trim().replace(/[{}]/g, "").toLowerCase(); }
function normEmail(x) { return String(x || "").trim().toLowerCase(); }
function q(req, key)  { return req.query?.get?.(key) || req.query?.[key] || ""; }
function esc(v)       { return `'${String(v).replace(/'/g, "''")}'`; }

function enrich(u) {
  if (!u) return null;
  const xpInfo = calcLevelFromXp(u?.eduxp_pontos || 0);
  return {
    ...u,
    xpInfo,
    fornecedorId:           u._eduxp_fornecedorid_value || null,
    fornecedorNomeFantasia: u.eduxp_fornecedorid?.eduxp_nomefantasia || null,
  };
}

app.http("eduxp-consultarUsuarios", {
  methods: ["GET"],
  authLevel: "function",
  route: "eduxp/consultarUsuarios",
  handler: async (request, context) => {
    try {
      const id          = normGuid(q(request, "id"));
      const email       = normEmail(q(request, "email"));
      const fornecedorId= normGuid(q(request, "fornecedorId") || q(request, "fornecedorid"));
      const top         = Math.min(parseInt(q(request, "top") || "100", 10) || 100, 5000);

      // Por ID
      if (id) {
        const r = await getRecordById(TABLE_USUARIO, id, { select: SEL, expand: EXPAND });
        if (!r) return { status: 404, jsonBody: { error: "Usuário não encontrado." } };
        return { jsonBody: enrich(r) };
      }

      // Por email (filter no Dataverse)
      if (email) {
        try {
          const r = await listRecords(TABLE_USUARIO, {
            select: SEL, expand: EXPAND, top: 1,
            filter: `eduxp_email eq ${esc(email)}`,
          });
          const usuario = r?.value?.[0] || null;
          return { jsonBody: enrich(usuario) };
        } catch {
          // fallback: busca tudo e filtra em memória
          const r = await listRecords(TABLE_USUARIO, { select: SEL, expand: EXPAND, top: 5000 });
          const usuario = (r?.value || []).find(u => normEmail(u.eduxp_email) === email) || null;
          return { jsonBody: enrich(usuario) };
        }
      }

      // Lista com filtro opcional por fornecedor
      const filters = [];
      if (fornecedorId) filters.push(`_eduxp_fornecedorid_value eq ${fornecedorId}`);

      const result = await listRecords(TABLE_USUARIO, {
        select: SEL,
        expand: EXPAND,
        filter: filters.join(" and ") || undefined,
        top,
      });

      return { jsonBody: (result?.value || []).map(enrich) };
    } catch (err) {
      context.error("Erro ConsultarUsuarios:", err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
