// eduxpSyncProjetos.js — Azure Functions v4
// Sincroniza projetos do GitLab → Dataverse (eduxp_projetos)
// Idempotente: usa eduxp_descricao para guardar o gitlab_id como chave de deduplicação
const { app } = require("@azure/functions");
const { listRecords, createRecord } = require("../shared/dataverseCrud");

const TABLE_PROJETO   = "eduxp_projetos";
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || "https://gitlabbuilder.mec.gov.br/api/v4";
const CORS = { "Access-Control-Allow-Origin": "*" };

// Prefixo guardado em eduxp_descricao para identificar projetos vindos do GitLab
function gitlabTag(id) { return `[gitlab:${id}]`; }
function extractGitlabId(descricao) {
  if (!descricao) return null;
  const m = String(descricao).match(/\[gitlab:(\d+)\]/);
  return m ? Number(m[1]) : null;
}

app.http("eduxp-syncProjetos", {
  methods: ["POST"],
  authLevel: "function",
  route: "eduxp/syncProjetos",
  handler: async (request, context) => {
    try {
      const token = process.env.GITLAB_TOKEN;
      if (!token) {
        return { status: 500, headers: CORS, jsonBody: { error: "GITLAB_TOKEN não configurado." } };
      }

      // 1. Lista projetos do GitLab (membership=true → apenas os que o token tem acesso)
      let gitlabProjects = [];
      let page = 1;
      while (true) {
        const url = `${GITLAB_BASE_URL}/projects?membership=true&per_page=100&page=${page}&order_by=name&sort=asc`;
        const res = await fetch(url, {
          headers: {
            "PRIVATE-TOKEN": token,
            "Content-Type": "application/json",
            "User-Agent": process.env.GITLAB_USER_AGENT || "mec-eduxp-sync",
          },
        });
        if (!res.ok) {
          const err = await res.text();
          context.error("[syncProjetos] GitLab error:", err);
          return { status: 502, headers: CORS, jsonBody: { error: "Erro ao buscar projetos do GitLab.", detail: err } };
        }
        const page_data = await res.json();
        if (!Array.isArray(page_data) || page_data.length === 0) break;
        gitlabProjects = gitlabProjects.concat(page_data);
        if (page_data.length < 100) break;
        page++;
      }

      context.log(`[syncProjetos] ${gitlabProjects.length} projetos no GitLab`);

      // 2. Busca projetos existentes no Dataverse (para deduplicação por gitlabId)
      const existing = await listRecords(TABLE_PROJETO, {
        select: "eduxp_projetoid,eduxp_nome,eduxp_descricao",
        top: 5000,
      });
      const existingById = new Map();
      for (const r of (existing?.value || [])) {
        const gid = extractGitlabId(r.eduxp_descricao);
        if (gid) existingById.set(gid, r);
      }

      // 3. Upsert: cria projetos que ainda não existem
      let criados = 0;
      let ignorados = 0;
      const erros = [];

      for (const proj of gitlabProjects) {
        if (existingById.has(proj.id)) {
          ignorados++;
          continue;
        }

        const descricao = [
          gitlabTag(proj.id),
          proj.description || "",
        ].filter(Boolean).join(" — ");

        try {
          await createRecord(TABLE_PROJETO, {
            eduxp_nome: proj.name,
            eduxp_cliente: proj.namespace?.name || null,
            eduxp_descricao: descricao,
          });
          criados++;
          context.log(`[syncProjetos] Criado: "${proj.name}" (gitlab:${proj.id})`);
        } catch (err) {
          erros.push({ nome: proj.name, gitlabId: proj.id, erro: err?.message });
          context.warn(`[syncProjetos] Erro ao criar "${proj.name}":`, err?.message);
        }
      }

      return {
        status: 200,
        headers: CORS,
        jsonBody: {
          message: `Sincronização concluída. ${criados} projetos criados, ${ignorados} já existiam.`,
          total: gitlabProjects.length,
          criados,
          ignorados,
          erros: erros.length > 0 ? erros : undefined,
        },
      };
    } catch (err) {
      context.error("[syncProjetos] Erro inesperado:", err);
      return { status: 500, headers: CORS, jsonBody: { error: "Erro interno", detail: err?.message } };
    }
  },
});
