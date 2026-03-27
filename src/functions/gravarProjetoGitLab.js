const { app } = require('@azure/functions');

// Helper: requisição autenticada para a API GitLab
async function gitlabRequest(path, opts = {}) {
  const url = `${process.env.GITLAB_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
      'Content-Type': 'application/json',
      'User-Agent': process.env.GITLAB_USER_AGENT || 'mec-kanban-proxy',
      ...(opts.headers || {}),
    },
  });
  return res;
}

// Helper: obtém token OAuth2 para Microsoft Graph
async function getGraphToken() {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body: params }
  );
  if (!res.ok) {
    const err = await res.text();
    throw { step: 'Autenticação Microsoft Graph', gitlabError: err };
  }
  const data = await res.json();
  return data.access_token;
}

// Helper: busca todos os itens de uma lista SharePoint via Graph
async function fetchSpList(graphToken, listId) {
  const siteId = process.env.SHAREPOINT_SITE_ID;
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?expand=fields&$top=999`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${graphToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw { step: `Leitura da lista SharePoint (${listId})`, gitlabError: err };
  }
  const data = await res.json();
  return data.value;
}

// Helper: rollback — deleta projeto GitLab silenciosamente
async function rollback(projectId) {
  try {
    await gitlabRequest(`/projects/${projectId}`, { method: 'DELETE' });
  } catch {
    // ignora erros de rollback
  }
}

const SERVICE_ACCOUNT_ID = 1027; // sharepoint-automation fallback

app.http('gravarProjetoGitLab', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'gravarProjetoGitLab',
  handler: async (request, context) => {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: 'Body inválido ou não é JSON.' },
      };
    }

    const { name, path, namespace_id, description, visibility, initialize_with_readme, email_responsavel } = body;

    if (!name || !path || !namespace_id || !email_responsavel) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: 'Campos obrigatórios: name, path, namespace_id, email_responsavel.' },
      };
    }

    let projectId = null;
    let projectUrl = null;
    let usuarioNaoEncontrado = false;

    try {
      // PASSO 1: Criar projeto GitLab
      context.log('[GRAVAR] Passo 1: Criando projeto GitLab');
      const projectRes = await gitlabRequest('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, path, namespace_id, description, visibility, initialize_with_readme }),
      });
      if (!projectRes.ok) {
        const err = await projectRes.text();
        throw { step: 'Criação do projeto GitLab', gitlabError: err };
      }
      const project = await projectRes.json();
      projectId = project.id;
      projectUrl = project.web_url;
      context.log(`[GRAVAR] Projeto criado: id=${projectId} url=${projectUrl}`);

      // PASSOS 2-9 serão adicionados aqui

      return {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { projectId, projectUrl },
      };

    } catch (err) {
      const step = err.step || 'desconhecida';
      const gitlabError = err.gitlabError || err.message || String(err);
      context.log(`[GRAVAR] ERRO na etapa "${step}": ${gitlabError}`);

      if (projectId) {
        context.log(`[GRAVAR] Rollback: deletando projeto id=${projectId}`);
        await rollback(projectId);
      }

      return {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: {
          error: gitlabError,
          mensagem_usuario: `Não foi possível criar o projeto na etapa "${step}". O projeto GitLab foi removido.`,
        },
      };
    }
  },
});
