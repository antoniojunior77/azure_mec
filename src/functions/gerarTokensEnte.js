const { app } = require("@azure/functions");
const axios = require("axios");

app.http("gitlabProxy", {
  methods: ["GET"],
  authLevel: "function",
  handler: async (request, context) => {
    context.log("[gitlabProxy] Requisição recebida.");

    try {
      const resource = request.query.get("resource"); // issues | boards
      const perPage = request.query.get("per_page") || "100";
      const state = request.query.get("state") || "opened";

      const gitlabBase = process.env.GITLAB_BASE_URL; 
      const gitlabProject = process.env.GITLAB_PROJECT_ID; 
      const gitlabToken = process.env.GITLAB_TOKEN;

      if (!gitlabBase || !gitlabProject || !gitlabToken) {
        return {
          status: 500,
          jsonBody: {
            error: "Configuração ausente. Verifique GITLAB_BASE_URL, GITLAB_PROJECT_ID e GITLAB_TOKEN."
          }
        };
      }

      let url = "";

      if (resource === "issues") {
        url = `${gitlabBase}/projects/${encodeURIComponent(gitlabProject)}/issues?per_page=${perPage}&state=${encodeURIComponent(state)}`;
      } else if (resource === "boards") {
        url = `${gitlabBase}/projects/${encodeURIComponent(gitlabProject)}/boards`;
      } else {
        return {
          status: 400,
          jsonBody: {
            error: "Parâmetro resource inválido. Use 'issues' ou 'boards'."
          }
        };
      }

      context.log(`[gitlabProxy] Chamando: ${url}`);

      const response = await axios.get(url, {
        headers: {
          "PRIVATE-TOKEN": gitlabToken,
          "Accept": "application/json"
        },
        timeout: 30000
      });

      return {
        status: 200,
        jsonBody: response.data
      };
    } catch (err) {
      context.error("[gitlabProxy] Erro:", err.message);

      return {
        status: err.response?.status || 500,
        jsonBody: {
          error: "Falha ao consultar GitLab",
          detail: err.response?.data || err.message
        }
      };
    }
  }
});