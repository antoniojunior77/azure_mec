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
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    const err = new Error(`GitLab auth error (${res.status}): ${body}`);
    err.authError = true;
    err.statusCode = res.status;
    err.detail = body;
    throw err;
  }
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

// Helper: rollback — deleta projeto GitLab e retorna se teve sucesso
async function rollback(projectId, context) {
  try {
    const res = await gitlabRequest(`/projects/${projectId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.text();
      context.log(`[GRAVAR] AVISO: rollback falhou (status ${res.status}): ${body}`);
      return false;
    }
    context.log(`[GRAVAR] Rollback OK: projeto ${projectId} removido`);
    return true;
  } catch (e) {
    context.log(`[GRAVAR] AVISO: rollback erro de rede: ${e.message}`);
    return false;
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

    const { name, path: rawPath, namespace_id, description, visibility, initialize_with_readme, email_responsavel, squad_id } = body;

    if (!name || !rawPath || !namespace_id || !email_responsavel) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: 'Campos obrigatórios: name, path, namespace_id, email_responsavel.' },
      };
    }

    // Sanitiza o path: remove acentos, substitui espaços e caracteres inválidos
    const path = rawPath
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/\s+/g, '-')                              // espaços → hífens
      .replace(/[^a-zA-Z0-9_\-\.]/g, '')                 // remove caracteres inválidos
      .replace(/^[-_.]+/, '')                             // não pode começar com - _ .
      .replace(/[-_.]+$/, '');                            // não pode terminar com - _ .
    context.log(`[GRAVAR] Path sanitizado: "${rawPath}" → "${path}"`);

    let projectId = null;
    let projectUrl = null;
    let usuarioNaoEncontrado = false;
    let projectCreatedInThisRun = false;

    try {
      // PASSO 1: Criar projeto GitLab (idempotente)
      context.log('[GRAVAR] Passo 1: Criando projeto GitLab');
      const projectRes = await gitlabRequest('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, path, namespace_id, description, visibility, initialize_with_readme }),
      });
      if (!projectRes.ok) {
        const errBody = await projectRes.text();
        let errJson;
        try { errJson = JSON.parse(errBody); } catch { errJson = null; }
        const isConflict = errJson?.message &&
          JSON.stringify(errJson.message).includes('has already been taken');
        if (isConflict) {
          context.log(`[GRAVAR] Projeto já existe. Buscando projeto existente (namespace_id=${namespace_id}, path="${path}")...`);
          const nsRes = await gitlabRequest(`/namespaces/${namespace_id}`);
          if (!nsRes.ok) throw { step: 'Busca do namespace GitLab', gitlabError: await nsRes.text() };
          const ns = await nsRes.json();
          const projectPath = encodeURIComponent(`${ns.full_path}/${path}`);
          const existingRes = await gitlabRequest(`/projects/${projectPath}`);
          if (!existingRes.ok) throw { step: 'Busca do projeto existente no GitLab', gitlabError: await existingRes.text() };
          const existing = await existingRes.json();
          projectId = existing.id;
          projectUrl = existing.web_url;
          context.log(`[GRAVAR] Projeto existente encontrado: id=${projectId}. Continuando fluxo...`);
        } else {
          throw { step: 'Criação do projeto GitLab', gitlabError: errBody };
        }
      } else {
        const project = await projectRes.json();
        projectId = project.id;
        projectUrl = project.web_url;
        projectCreatedInThisRun = true;
        context.log(`[GRAVAR] Projeto criado: id=${projectId} url=${projectUrl}`);
      }

      // PASSO 2: Buscar dados do SharePoint em paralelo
      context.log('[GRAVAR] Passo 2: Buscando dados do SharePoint');
      const graphToken = await getGraphToken();
      const [spLabels, spBoards] = await Promise.all([
        fetchSpList(graphToken, process.env.SP_LIST_LABELS_ID),
        fetchSpList(graphToken, process.env.SP_LIST_BOARDS_ID),
      ]);
      context.log(`[GRAVAR] SharePoint: ${spLabels.length} labels, ${spBoards.length} boards`);

      // Resolver email_responsavel → SharePoint LookupId via User Information List
      let responsavelLookupId = null;
      const uilUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE_ID}/lists/User%20Information%20List/items?$filter=fields/EMail eq '${email_responsavel}'&$expand=fields&$top=1`;
      const uilRes = await fetch(uilUrl, {
        headers: { Authorization: `Bearer ${graphToken}` },
      });
      if (uilRes.ok) {
        const uilData = await uilRes.json();
        if (uilData.value && uilData.value.length > 0) {
          responsavelLookupId = Number(uilData.value[0].id);
          context.log(`[GRAVAR] Responsável "${email_responsavel}" → LookupId=${responsavelLookupId}`);
        } else {
          context.log(`[GRAVAR] AVISO: "${email_responsavel}" não encontrado no SharePoint — campo Equipe não será preenchido`);
        }
      } else {
        context.log(`[GRAVAR] AVISO: erro ao consultar User Information List (${uilRes.status}) — campo Equipe não será preenchido`);
      }

      // PASSO 3: Criar labels no GitLab (idempotente — busca existentes para montar o mapa)
      context.log(`[GRAVAR] Passo 3: Criando ${spLabels.length} labels no GitLab`);
      const existingLabelsRes = await gitlabRequest(`/projects/${projectId}/labels?per_page=100`);
      if (!existingLabelsRes.ok) throw { step: 'Busca de labels existentes', gitlabError: await existingLabelsRes.text() };
      const existingLabels = await existingLabelsRes.json();
      const existingLabelByName = Object.fromEntries(existingLabels.map(l => [l.name, l.id]));

      const spLabelIdToGitlabId = {};
      for (const item of spLabels) {
        const f = item.fields;
        if (existingLabelByName[f.Title] !== undefined) {
          spLabelIdToGitlabId[item.id] = existingLabelByName[f.Title];
          context.log(`[GRAVAR] Label já existe: "${f.Title}" gitlabId=${existingLabelByName[f.Title]} — ignorando`);
          continue;
        }
        const labelRes = await gitlabRequest(`/projects/${projectId}/labels`, {
          method: 'POST',
          body: JSON.stringify({ name: f.Title, color: f.Cor, description: f.Descricao || '' }),
        });
        if (!labelRes.ok) {
          const err = await labelRes.text();
          throw { step: `Criação da label "${f.Title}"`, gitlabError: err };
        }
        const label = await labelRes.json();
        spLabelIdToGitlabId[item.id] = label.id;
        context.log(`[GRAVAR] Label criada: "${f.Title}" spId=${item.id} → gitlabId=${label.id}`);
      }

      // PASSO 4: Obter board padrão do projeto
      context.log('[GRAVAR] Passo 4: Obtendo board padrão');
      const boardsRes = await gitlabRequest(`/projects/${projectId}/boards`);
      if (!boardsRes.ok) throw { step: 'Obtenção do board padrão', gitlabError: await boardsRes.text() };
      const gitlabBoards = await boardsRes.json();
      let boardId = gitlabBoards && gitlabBoards.length > 0 ? gitlabBoards[0].id : null;
      if (!boardId) {
        context.log('[GRAVAR] Nenhum board encontrado — criando board padrão');
        const createBoardRes = await gitlabRequest(`/projects/${projectId}/boards`, {
          method: 'POST',
          body: JSON.stringify({ name: 'Board' }),
        });
        if (!createBoardRes.ok) throw { step: 'Criação do board padrão', gitlabError: await createBoardRes.text() };
        const newBoard = await createBoardRes.json();
        boardId = newBoard.id;
        context.log(`[GRAVAR] Board criado: id=${boardId}`);
      } else {
        context.log(`[GRAVAR] Board padrão: id=${boardId}`);
      }

      // PASSO 5: Criar colunas no board
      context.log('[GRAVAR] Passo 5: Criando colunas no board');
      {
        const existingListsRes = await gitlabRequest(`/projects/${projectId}/boards/${boardId}/lists`);
        if (!existingListsRes.ok) throw { step: 'Busca de colunas existentes no board', gitlabError: await existingListsRes.text() };
        const existingLists = await existingListsRes.json();
        const existingListLabelIds = new Set(existingLists.map(l => l.label?.id).filter(Boolean));

        context.log(`[GRAVAR] ${spBoards.length} boards definidos no SharePoint`);
        const sortedBoards = [...spBoards].sort((a, b) => Number(a.fields.Posicao || 0) - Number(b.fields.Posicao || 0));
        for (const boardEntry of sortedBoards) {
          const spLabelId = String(boardEntry.fields.ID_LABEL);
          const gitlabLabelId = spLabelIdToGitlabId[spLabelId];
          if (!gitlabLabelId) {
            context.log(`[GRAVAR] Board com ID_LABEL=${spLabelId} não tem label correspondente — ignorando`);
            continue;
          }
          if (existingListLabelIds.has(gitlabLabelId)) {
            context.log(`[GRAVAR] Coluna já existe para labelId=${gitlabLabelId} — ignorando`);
            continue;
          }
          const posicao = Number(boardEntry.fields.Posicao || 0);
          const listRes = await gitlabRequest(`/projects/${projectId}/boards/${boardId}/lists`, {
            method: 'POST',
            body: JSON.stringify({ label_id: gitlabLabelId, position: posicao }),
          });
          if (!listRes.ok) {
            const err = await listRes.text();
            throw { step: `Criação da coluna (labelId=${gitlabLabelId})`, gitlabError: err };
          }
          context.log(`[GRAVAR] Coluna criada: labelId=${gitlabLabelId} posição=${posicao}`);
        }
      }

      // PASSO 6: Buscar userId pelo username (extrai parte antes do @)
      const username = email_responsavel.includes('@') ? email_responsavel.split('@')[0] : email_responsavel;
      context.log(`[GRAVAR] Passo 6: Buscando usuário "${username}" (email: ${email_responsavel})`);
      const usersRes = await gitlabRequest(`/users?username=${encodeURIComponent(username)}`);
      if (!usersRes.ok) throw { step: 'Busca de usuário no GitLab', gitlabError: await usersRes.text() };
      const users = await usersRes.json();
      let userId;
      if (users.length > 0) {
        userId = users[0].id;
        context.log(`[GRAVAR] Usuário encontrado: id=${userId}`);
      } else {
        userId = SERVICE_ACCOUNT_ID;
        usuarioNaoEncontrado = true;
        context.log(`[GRAVAR] Usuário "${email_responsavel}" não encontrado. Usando fallback id=${SERVICE_ACCOUNT_ID}`);
      }

      // PASSO 7: Adicionar owner ao projeto (não-fatal — projeto continua sem owner se falhar)
      context.log(`[GRAVAR] Passo 7: Adicionando owner userId=${userId}`);
      const memberRes = await gitlabRequest(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, access_level: 50 }),
      });
      if (!memberRes.ok) {
        const memberErr = await memberRes.text();
        const alreadyMember = memberErr.includes('already') || memberErr.includes('Member');
        if (alreadyMember) {
          context.log(`[GRAVAR] Usuário userId=${userId} já é membro — ignorando`);
        } else {
          context.log(`[GRAVAR] AVISO: não foi possível adicionar owner userId=${userId}: ${memberErr}`);
          usuarioNaoEncontrado = true;
        }
      } else {
        context.log(`[GRAVAR] Owner adicionado: userId=${userId}`);
      }

      // PASSO 8: Registrar projeto na lista SharePoint Projects (idempotente — verifica se já existe)
      context.log('[GRAVAR] Passo 8: Registrando na lista Projects do SharePoint');
      const spCheckUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE_ID}/lists/${process.env.SP_LIST_PROJECTS_ID}/items?$filter=fields/ID_PROJETO eq '${projectId}'&expand=fields`;
      const spCheckRes = await fetch(spCheckUrl, { headers: { Authorization: `Bearer ${graphToken}`, Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      if (!spCheckRes.ok) throw { step: 'Verificação de projeto no SharePoint', gitlabError: await spCheckRes.text() };
      const spCheckData = await spCheckRes.json();
      if (spCheckData.value && spCheckData.value.length > 0) {
        context.log('[GRAVAR] Projeto já registrado no SharePoint — ignorando');
      } else {
        const spProjectRes = await fetch(
          `https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE_ID}/lists/${process.env.SP_LIST_PROJECTS_ID}/items`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                Title: name,
                ID_PROJETO: String(projectId),
                url: projectUrl,
                token: process.env.GITLAB_TOKEN,
                ...(squad_id ? { SquadLookupId: String(squad_id) } : {}),
                ...(responsavelLookupId ? { 'EquipeLookupId@odata.type': 'Collection(Edm.Int32)', EquipeLookupId: [responsavelLookupId] } : {}),
              },
            }),
          }
        );
        if (!spProjectRes.ok) throw { step: 'Registro na lista Projects do SharePoint', gitlabError: await spProjectRes.text() };
        context.log('[GRAVAR] Projeto registrado na lista Projects do SharePoint');
      }

      // PASSO 9: Montar e retornar resposta final
      const responseBody = { projectId, projectUrl };
      if (usuarioNaoEncontrado) {
        responseBody.aviso = `Projeto criado com sucesso, porém não foi possível adicionar o usuário '${email_responsavel}' como owner. Verifique se o email existe no GitLab e adicione o owner manualmente.`;
      }
      context.log(`[GRAVAR] Concluído com sucesso: projectId=${projectId}`);
      return {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: responseBody,
      };

    } catch (err) {
      // Erro de autenticação GitLab — retorna 401 para o caller não ficar em retry loop
      if (err.authError) {
        context.log(`[GRAVAR] ERRO DE AUTENTICAÇÃO GitLab (${err.statusCode}): ${err.detail}`);
        return {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          jsonBody: {
            error: 'Token GitLab inválido ou revogado. Gere um novo token e atualize a variável GITLAB_TOKEN.',
            mensagem_usuario: 'Falha de autenticação no GitLab. Não tente novamente — o token precisa ser renovado.',
          },
        };
      }

      const step = err.step || 'desconhecida';
      const gitlabError = err.gitlabError || err.message || String(err);
      context.log(`[GRAVAR] ERRO na etapa "${step}": ${gitlabError}`);

      let rollbackOk = false;
      if (projectId && projectCreatedInThisRun) {
        context.log(`[GRAVAR] Rollback: deletando projeto id=${projectId}`);
        rollbackOk = await rollback(projectId, context);
      }

      const mensagem_usuario = projectId && projectCreatedInThisRun
        ? rollbackOk
          ? `Não foi possível concluir o projeto na etapa "${step}". O projeto GitLab foi removido automaticamente.`
          : `Não foi possível concluir o projeto na etapa "${step}". ATENÇÃO: o projeto GitLab (id=${projectId}) NÃO foi removido automaticamente — delete manualmente antes de tentar novamente.`
        : `Erro na etapa "${step}".`;

      return {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: gitlabError, mensagem_usuario },
      };
    }
  },
});
