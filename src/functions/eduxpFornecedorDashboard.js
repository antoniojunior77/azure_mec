// eduxpFornecedorDashboard.js — Azure Functions v4
// Dashboard consolidado para Rep. Fornecedor (perfil 3)
// Retorna em uma chamada: info do fornecedor, totais, KPIs médios, liga e confronto direto
const { app } = require("@azure/functions");
const { listRecords, getRecordById } = require("../shared/dataverseCrud");

const CORS = { "Access-Control-Allow-Origin": "*" };

function normGuid(x) { return String(x || "").trim().replace(/[{}]/g, "").toLowerCase(); }
function q(req, key)  { return req.query?.get?.(key) || req.query?.[key] || ""; }

app.http("eduxp-fornecedorDashboard", {
  methods: ["GET"],
  authLevel: "function",
  route: "eduxp/fornecedorDashboard",
  handler: async (request, context) => {
    try {
      const fornecedorId = normGuid(q(request, "fornecedorId") || q(request, "fornecedorid"));
      if (!fornecedorId) {
        return { status: 400, headers: CORS, jsonBody: { error: "fornecedorId é obrigatório." } };
      }

      // 1. Info do fornecedor
      const fornecedor = await getRecordById("eduxp_fornecedors", fornecedorId, {
        select: "eduxp_fornecedorid,eduxp_nomefantasia,eduxp_razaosocial,eduxp_observacoes,eduxp_site",
      });
      if (!fornecedor) {
        return { status: 404, headers: CORS, jsonBody: { error: "Fornecedor não encontrado." } };
      }

      // 2. Todos os usuários (para liga + filtrar por fornecedor)
      const todosUsuariosRes = await listRecords("eduxp_usuarios", {
        select: "eduxp_usuarioid,eduxp_nome,eduxp_pontos,eduxp_moedas,_eduxp_fornecedorid_value",
        top: 5000,
      });
      const allUsers = todosUsuariosRes?.value || [];

      const meusUsuarios = allUsers.filter(u =>
        normGuid(u._eduxp_fornecedorid_value) === fornecedorId
      );
      const meusIds = new Set(meusUsuarios.map(u => normGuid(u.eduxp_usuarioid)));

      const totalPontos = meusUsuarios.reduce((s, u) => s + (u.eduxp_pontos || 0), 0);
      const totalMoedas = meusUsuarios.reduce((s, u) => s + (u.eduxp_moedas || 0), 0);

      // 3. Liga — agrupar por fornecedor, ordenar por pontos
      const porFornecedor = new Map();
      for (const u of allUsers) {
        const fid = normGuid(u._eduxp_fornecedorid_value);
        if (!fid) continue;
        if (!porFornecedor.has(fid)) porFornecedor.set(fid, { totalPontos: 0, totalMoedas: 0, usuarios: 0 });
        const e = porFornecedor.get(fid);
        e.totalPontos += u.eduxp_pontos || 0;
        e.totalMoedas += u.eduxp_moedas || 0;
        e.usuarios++;
      }

      const fornecedoresRes = await listRecords("eduxp_fornecedors", {
        select: "eduxp_fornecedorid,eduxp_nomefantasia",
        top: 500,
      });
      const fornecedoresMap = new Map(
        (fornecedoresRes?.value || []).map(f => [normGuid(f.eduxp_fornecedorid), f.eduxp_nomefantasia || "?"])
      );

      const liga = [...porFornecedor.entries()]
        .map(([fid, data]) => ({
          fornecedorId: fid,
          nome: fornecedoresMap.get(fid) || "?",
          totalPontos: data.totalPontos,
          totalMoedas: data.totalMoedas,
          usuarios: data.usuarios,
        }))
        .sort((a, b) => b.totalPontos - a.totalPontos)
        .map((item, idx) => ({ ...item, posicao: idx + 1 }));

      const posicaoLiga = (liga.findIndex(l => l.fornecedorId === fornecedorId) + 1) || null;

      // 4. KPIs — média das performances dos usuários deste fornecedor
      let kpis = null;
      if (meusUsuarios.length > 0) {
        const perfRes = await listRecords("eduxp_performances", {
          select: [
            "eduxp_performanceid",
            "_eduxp_usuarioid_value",
            "eduxp_comunicacao",
            "eduxp_iniciativa",
            "eduxp_qualidade",
            "eduxp_trabalhoequipe",
            "eduxp_pontualidade",
            "eduxp_resolucaoproblema",
          ].join(","),
          top: 5000,
        });
        const perfs = (perfRes?.value || []).filter(p =>
          meusIds.has(normGuid(p._eduxp_usuarioid_value))
        );
        if (perfs.length > 0) {
          const sums = { comunicacao: 0, iniciativa: 0, qualidade: 0, trabalhoEquipe: 0, pontualidade: 0, resolucaoProblema: 0 };
          for (const p of perfs) {
            sums.comunicacao     += p.eduxp_comunicacao     || 0;
            sums.iniciativa      += p.eduxp_iniciativa      || 0;
            sums.qualidade       += p.eduxp_qualidade       || 0;
            sums.trabalhoEquipe  += p.eduxp_trabalhoequipe  || 0;
            sums.pontualidade    += p.eduxp_pontualidade    || 0;
            sums.resolucaoProblema += p.eduxp_resolucaoproblema || 0;
          }
          kpis = {};
          for (const k of Object.keys(sums)) {
            kpis[k] = Math.round(sums[k] / perfs.length);
          }
        }
      }

      // 5. Confronto direto — adversário mais próximo na liga
      let confronto = null;
      const adversario = liga.find(l => l.fornecedorId !== fornecedorId);
      if (adversario) {
        const adversarioIds = new Set(
          allUsers
            .filter(u => normGuid(u._eduxp_fornecedorid_value) === adversario.fornecedorId)
            .map(u => normGuid(u.eduxp_usuarioid))
        );

        const temasRes = await listRecords("eduxp_classificacaos", {
          select: "eduxp_classificacaoid,eduxp_nome",
          top: 200,
        });
        const temas = temasRes?.value || [];

        const classifsRes = await listRecords("eduxp_classificacaousuarios", {
          select: "_eduxp_usuarioid_value,_eduxp_classificacaoid_value,eduxp_pontos",
          top: 5000,
        });
        const todasClassifs = classifsRes?.value || [];

        const porTema = new Map();
        for (const cv of todasClassifs) {
          const uid = normGuid(cv._eduxp_usuarioid_value);
          const cid = normGuid(cv._eduxp_classificacaoid_value);
          if (!cid) continue;
          if (!porTema.has(cid)) porTema.set(cid, { meu: 0, adversario: 0 });
          const e = porTema.get(cid);
          if (meusIds.has(uid)) e.meu += cv.eduxp_pontos || 0;
          if (adversarioIds.has(uid)) e.adversario += cv.eduxp_pontos || 0;
        }

        const semanas = temas.map((t, idx) => {
          const cid = normGuid(t.eduxp_classificacaoid);
          const s = porTema.get(cid) || { meu: 0, adversario: 0 };
          const ganhador = s.meu > s.adversario ? "meu"
            : s.adversario > s.meu ? "adversario"
            : "empate";
          return { semana: idx + 1, tema: t.eduxp_nome, pontuacaoMeu: s.meu, pontuacaoAdversario: s.adversario, ganhador };
        });

        const vitMeu = semanas.filter(s => s.ganhador === "meu").length;
        const vitAdv = semanas.filter(s => s.ganhador === "adversario").length;

        confronto = {
          adversarioId: adversario.fornecedorId,
          adversarioNome: adversario.nome,
          placar: { meu: vitMeu, adversario: vitAdv },
          semanas,
        };
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          fornecedor: {
            id: fornecedor.eduxp_fornecedorid,
            nome: fornecedor.eduxp_nomefantasia,
            razaoSocial: fornecedor.eduxp_razaosocial,
            descricao: fornecedor.eduxp_observacoes,
            site: fornecedor.eduxp_site,
          },
          totais: { usuarios: meusUsuarios.length, pontos: totalPontos, moedas: totalMoedas },
          kpis,
          posicaoLiga,
          liga,
          confronto,
        },
      };
    } catch (err) {
      context.error("[fornecedorDashboard] Erro:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro interno", detail: err?.message } };
    }
  },
});
