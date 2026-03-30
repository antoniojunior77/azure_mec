const { app } = require('@azure/functions');
//const fetch = require('node-fetch');

app.http('getAcessGitLab', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'getAcessGitLab',
  handler: async (request, context) => {

    const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Preflight
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
        jsonBody: { error: 'Body inválido ou não é JSON.' }
      };
    }

    const { projectId, resource, itemId, subResource, method = 'GET', query, body: requestBody, token } = body;

    // Validações
    if (!projectId || !resource) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: 'Campos obrigatórios: projectId, resource.' }
      };
    }

    if (['POST', 'PUT'].includes(method) && !requestBody) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: `Método ${method} requer o campo 'body'.` }
      };
    }

    // Token: prioriza o que veio no payload, fallback para variável de ambiente
    const gitlabToken = token || process.env.GITLAB_TOKEN;

    if (!gitlabToken) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: { error: 'Token do GitLab não informado. Configure o campo token na lista SharePoint.' }
      };
    }

    const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlabbuilder.mec.gov.br/api/v4';
    const userAgent    = process.env.GITLAB_USER_AGENT || 'mec-kanban-proxy';

    // Monta URL
    let url = `${gitlabBaseUrl}/projects/${projectId}/${resource}`;
    if (itemId !== undefined) url += `/${itemId}`;
    if (subResource) url += `/${subResource}`;

    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(
        Object.entries(query).map(([k, v]) => [k, String(v)])
      );
      url += `?${params.toString()}`;
    }

    context.log(`[KANBAN] ${method} ${url}`);
    if (['POST', 'PUT'].includes(method) && requestBody) {
      context.log(`[KANBAN] body → ${JSON.stringify(requestBody)}`);
    }

    // Chama o GitLab
    const fetchOptions = {
      method,
      headers: {
        'PRIVATE-TOKEN': gitlabToken,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
    };

    if (['POST', 'PUT'].includes(method) && requestBody) {
      fetchOptions.body = JSON.stringify(requestBody);
    }

    const gitlabRes = await fetch(url, fetchOptions);
    context.log(`[KANBAN] GitLab status: ${gitlabRes.status}`);

    // DELETE 204 não tem body
    if (gitlabRes.status === 204) {
      return {
        status: 204,
        headers: corsHeaders
      };
    }

    const responseText = await gitlabRes.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { raw: responseText };
    }

    if (!gitlabRes.ok) {
      context.log(`[KANBAN] GitLab error ${gitlabRes.status}: ${responseText.substring(0, 500)}`);
      return {
        status: gitlabRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: responseBody
      };
    }

    // Log resumido para PUT (atualização de issue)
    if (method === 'PUT' && responseBody && responseBody.iid) {
      context.log(`[KANBAN] PUT issue #${responseBody.iid} → labels: ${JSON.stringify(responseBody.labels)}`);
    }

    return {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      jsonBody: responseBody
    };
  }
});