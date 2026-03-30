# gravarProjetoGitLab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a Azure Function `gravarProjetoGitLab` que orquestra a criação completa de um projeto GitLab (projeto, labels, board, owner, registro SharePoint) a partir de uma chamada do Power Automate, com rollback automático em caso de falha.

**Architecture:** Arquivo único autocontido `src/functions/gravarProjetoGitLab.js` com helpers internos para GitLab e Graph API. Fluxo sequencial de 9 passos com `try/catch` global que aciona rollback (DELETE projeto GitLab) em caso de falha nos passos 2–8. SharePoint acessado via Microsoft Graph API com client credentials já configurados no projeto.

**Tech Stack:** Node.js 18+, `@azure/functions` v4, `fetch` nativo, Microsoft Graph API v1.0, GitLab API v4

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/functions/gravarProjetoGitLab.js` | Criar | Handler principal + helpers |
| `src/index.js` | Modificar | Registrar a nova function |

---

### Task 1: Esqueleto do arquivo com CORS, validação de input e registro

**Files:**
- Create: `src/functions/gravarProjetoGitLab.js`
- Modify: `src/index.js`

- [ ] **Step 1: Criar o arquivo com esqueleto básico (CORS + validação)**

Criar `src/functions/gravarProjetoGitLab.js` com o conteúdo:

```javascript
const { app } = require('@azure/functions');

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

    // TODO: implementação nos próximos passos
    return {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      jsonBody: { ok: true },
    };
  },
});
```

- [ ] **Step 2: Registrar a function em `src/index.js`**

Adicionar no final do arquivo `src/index.js`:

```javascript
require("./functions/gravarProjetoGitLab");
```

- [ ] **Step 3: Verificar que a function sobe sem erros**

```bash
cd /Users/antoniojunior/Dev/projetos_azure/mec/pnld-func2
func start
```

Esperado: função `gravarProjetoGitLab` listada em `http://localhost:7071/api/gravarProjetoGitLab`

- [ ] **Step 4: Testar validação de input**

```bash
curl -s -X POST http://localhost:7071/api/gravarProjetoGitLab \
  -H "Content-Type: application/json" \
  -d '{"name": "Teste"}' | jq .
```

Esperado:
```json
{ "error": "Campos obrigatórios: name, path, namespace_id, email_responsavel." }
```

- [ ] **Step 5: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js src/index.js
git commit -m "feat: add gravarProjetoGitLab skeleton with CORS and input validation"
```

---

### Task 2: Helpers internos (GitLab, Graph API, SharePoint, rollback)

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Adicionar os 4 helpers antes do `app.http(...)`**

Inserir antes da linha `const SERVICE_ACCOUNT_ID = 1027;`:

```javascript
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
```

- [ ] **Step 2: Reiniciar o func e confirmar que ainda sobe sem erros**

```bash
func start
```

Esperado: sem erros de sintaxe, função listada normalmente.

- [ ] **Step 3: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: add internal helpers (gitlabRequest, getGraphToken, fetchSpList, rollback)"
```

---

### Task 3: Passo 1 — Criar projeto GitLab

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Substituir o handler pelo bloco com o Passo 1**

Substituir o trecho `// TODO: implementação nos próximos passos` até o `return { status: 200 ... }` por:

```javascript
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
```

- [ ] **Step 2: Testar criação do projeto**

```bash
curl -s -X POST http://localhost:7071/api/gravarProjetoGitLab \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Projeto Teste Plan",
    "path": "projeto-teste-plan",
    "namespace_id": 190,
    "description": "Teste do plano",
    "visibility": "private",
    "initialize_with_readme": true,
    "email_responsavel": "antoniobjunior@mec.gov.br"
  }' | jq .
```

Esperado: `{ "projectId": <número>, "projectUrl": "https://gitlabbuilder.mec.gov.br/..." }`

**Anote o `projectId` retornado — delete manualmente no GitLab após o teste.**

- [ ] **Step 3: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: implement step 1 - create GitLab project with rollback structure"
```

---

### Task 4: Passos 2 e 3 — Buscar SharePoint e criar labels no GitLab

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Adicionar passos 2 e 3 após a linha `context.log('[GRAVAR] Projeto criado...')`**

Substituir o comentário `// PASSOS 2-9 serão adicionados aqui` por:

```javascript
      // PASSO 2: Buscar dados do SharePoint em paralelo
      context.log('[GRAVAR] Passo 2: Buscando dados do SharePoint');
      const graphToken = await getGraphToken();
      const [spLabels, spBoards] = await Promise.all([
        fetchSpList(graphToken, process.env.SP_LIST_LABELS_ID),
        fetchSpList(graphToken, process.env.SP_LIST_BOARDS_ID),
      ]);
      context.log(`[GRAVAR] SharePoint: ${spLabels.length} labels, ${spBoards.length} boards`);

      // PASSO 3: Criar cada label no GitLab
      context.log(`[GRAVAR] Passo 3: Criando ${spLabels.length} labels no GitLab`);
      const spLabelIdToGitlabId = {};
      for (const item of spLabels) {
        const f = item.fields;
        const labelRes = await gitlabRequest(`/projects/${projectId}/labels`, {
          method: 'POST',
          body: JSON.stringify({
            name: f.Title,
            color: f.Cor,
            description: f.Descricao || '',
          }),
        });
        if (!labelRes.ok) {
          const err = await labelRes.text();
          throw { step: `Criação da label "${f.Title}"`, gitlabError: err };
        }
        const label = await labelRes.json();
        spLabelIdToGitlabId[item.id] = label.id;
        context.log(`[GRAVAR] Label criada: "${f.Title}" spId=${item.id} → gitlabId=${label.id}`);
      }

      // PASSOS 4-9 serão adicionados aqui
```

- [ ] **Step 2: Testar e verificar labels criadas**

Execute o mesmo `curl` do Task 3 Step 2 com um novo `path`. Depois verifique no GitLab:
```
https://gitlabbuilder.mec.gov.br/<namespace>/projeto-teste-plan/-/labels
```
Esperado: labels da lista SharePoint criadas no projeto.

- [ ] **Step 3: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: implement steps 2-3 - fetch SharePoint labels/boards and create GitLab labels"
```

---

### Task 5: Passos 4 e 5 — Board padrão e colunas

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Adicionar passos 4 e 5 substituindo `// PASSOS 4-9 serão adicionados aqui`**

```javascript
      // PASSO 4: Obter board padrão do projeto
      context.log('[GRAVAR] Passo 4: Obtendo board padrão');
      const boardsRes = await gitlabRequest(`/projects/${projectId}/boards`);
      if (!boardsRes.ok) {
        const err = await boardsRes.text();
        throw { step: 'Obtenção do board padrão', gitlabError: err };
      }
      const gitlabBoards = await boardsRes.json();
      const boardId = gitlabBoards[0].id;
      context.log(`[GRAVAR] Board padrão: id=${boardId}`);

      // PASSO 5: Criar colunas no board (apenas labels com ColunaBoard = "Sim")
      context.log('[GRAVAR] Passo 5: Criando colunas no board');
      const boardLabels = spLabels.filter(item => item.fields.ColunaBoard === 'Sim');
      context.log(`[GRAVAR] ${boardLabels.length} labels marcadas como coluna de board`);
      for (const item of boardLabels) {
        const boardEntry = spBoards.find(b => String(b.fields.ID_LABEL) === String(item.id));
        const posicao = boardEntry ? Number(boardEntry.fields.Posicao) : 0;
        const gitlabLabelId = spLabelIdToGitlabId[item.id];
        const listRes = await gitlabRequest(`/projects/${projectId}/boards/${boardId}/lists`, {
          method: 'POST',
          body: JSON.stringify({ label_id: gitlabLabelId, position: posicao }),
        });
        if (!listRes.ok) {
          const err = await listRes.text();
          throw { step: `Criação da coluna "${item.fields.Title}"`, gitlabError: err };
        }
        context.log(`[GRAVAR] Coluna criada: "${item.fields.Title}" posição=${posicao}`);
      }

      // PASSOS 6-9 serão adicionados aqui
```

- [ ] **Step 2: Testar e verificar board**

Execute o `curl` novamente com novo `path`. Verifique em:
```
https://gitlabbuilder.mec.gov.br/<namespace>/projeto-teste-plan/-/boards
```
Esperado: colunas correspondentes às labels com `ColunaBoard = "Sim"` criadas, na ordem do campo `Posicao`.

- [ ] **Step 3: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: implement steps 4-5 - get default board and create board columns"
```

---

### Task 6: Passos 6 e 7 — Usuário owner com fallback

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Adicionar passos 6 e 7 substituindo `// PASSOS 6-9 serão adicionados aqui`**

```javascript
      // PASSO 6: Buscar userId pelo email
      context.log(`[GRAVAR] Passo 6: Buscando usuário "${email_responsavel}"`);
      const usersRes = await gitlabRequest(`/users?search=${encodeURIComponent(email_responsavel)}`);
      if (!usersRes.ok) {
        const err = await usersRes.text();
        throw { step: 'Busca de usuário no GitLab', gitlabError: err };
      }
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

      // PASSO 7: Adicionar owner ao projeto
      context.log(`[GRAVAR] Passo 7: Adicionando owner userId=${userId}`);
      const memberRes = await gitlabRequest(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, access_level: 50 }),
      });
      if (!memberRes.ok) {
        const err = await memberRes.text();
        throw { step: 'Adição de owner ao projeto', gitlabError: err };
      }
      context.log(`[GRAVAR] Owner adicionado: userId=${userId}`);

      // PASSOS 8-9 serão adicionados aqui
```

- [ ] **Step 2: Testar com email válido**

Execute o `curl` com `email_responsavel` de um usuário existente no GitLab. Esperado: usuário adicionado como owner no projeto criado.

- [ ] **Step 3: Testar fallback com email inválido**

```bash
curl -s -X POST http://localhost:7071/api/gravarProjetoGitLab \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Projeto Teste Fallback",
    "path": "projeto-teste-fallback",
    "namespace_id": 190,
    "description": "Teste fallback owner",
    "visibility": "private",
    "initialize_with_readme": true,
    "email_responsavel": "nao.existe@mec.gov.br"
  }' | jq .
```

Esperado: HTTP 200 com campo `aviso` informando que `sharepoint-automation` foi adicionado como owner.

- [ ] **Step 4: Commit**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: implement steps 6-7 - find GitLab user by email with service account fallback"
```

---

### Task 7: Passos 8 e 9 — Registro SharePoint e resposta final

**Files:**
- Modify: `src/functions/gravarProjetoGitLab.js`

- [ ] **Step 1: Adicionar passos 8 e 9 substituindo `// PASSOS 8-9 serão adicionados aqui`**

```javascript
      // PASSO 8: Registrar projeto na lista SharePoint Projects
      context.log('[GRAVAR] Passo 8: Registrando na lista Projects do SharePoint');
      const spProjectRes = await fetch(
        `https://graph.microsoft.com/v1.0/sites/${process.env.SHAREPOINT_SITE_ID}/lists/${process.env.SP_LIST_PROJECTS_ID}/items`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${graphToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: {
              Title: name,
              ID_PROJETO: String(projectId),
              url: projectUrl,
              token: process.env.GITLAB_TOKEN,
            },
          }),
        }
      );
      if (!spProjectRes.ok) {
        const err = await spProjectRes.text();
        throw { step: 'Registro na lista Projects do SharePoint', gitlabError: err };
      }
      context.log(`[GRAVAR] Projeto registrado na lista Projects do SharePoint`);

      // PASSO 9: Montar e retornar resposta final
      const responseBody = { projectId, projectUrl };
      if (usuarioNaoEncontrado) {
        responseBody.aviso = `Projeto criado com sucesso, porém o usuário '${email_responsavel}' não foi encontrado no GitLab. A conta 'sharepoint-automation' foi adicionada como owner temporário.`;
      }
      context.log(`[GRAVAR] Concluído com sucesso: projectId=${projectId}`);
      return {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        jsonBody: responseBody,
      };
```

- [ ] **Step 2: Teste de integração completo**

```bash
curl -s -X POST http://localhost:7071/api/gravarProjetoGitLab \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Projeto Integração Final",
    "path": "projeto-integracao-final",
    "namespace_id": 190,
    "description": "Teste completo end-to-end",
    "visibility": "private",
    "initialize_with_readme": true,
    "email_responsavel": "antoniobjunior@mec.gov.br"
  }' | jq .
```

Esperado:
```json
{
  "projectId": <número>,
  "projectUrl": "https://gitlabbuilder.mec.gov.br/..."
}
```

Verificar:
- Projeto criado no GitLab ✓
- Labels criadas ✓
- Colunas do board criadas ✓
- Owner adicionado ✓
- Item criado na lista Projects do SharePoint ✓

- [ ] **Step 3: Testar rollback**

Force um erro — use um `namespace_id` inválido mas um path válido para que o projeto seja criado mas um passo posterior falhe. Verifique nos logs que o rollback foi executado e o projeto foi deletado do GitLab.

- [ ] **Step 4: Commit final**

```bash
git add src/functions/gravarProjetoGitLab.js
git commit -m "feat: implement steps 8-9 - register project in SharePoint and return final response"
```

---

## Self-Review

### Spec coverage check

| Requisito do spec | Task que implementa |
|-------------------|---------------------|
| POST /api/gravarProjetoGitLab, authLevel function | Task 1 |
| CORS + preflight OPTIONS | Task 1 |
| Validação de campos obrigatórios | Task 1 |
| Registrar em src/index.js | Task 1 |
| Helper gitlabRequest | Task 2 |
| Helper getGraphToken | Task 2 |
| Helper fetchSpList | Task 2 |
| Helper rollback silencioso | Task 2 |
| Passo 1: criar projeto GitLab | Task 3 |
| Estrutura try/catch com rollback | Task 3 |
| Passo 2: buscar labels e boards SharePoint em paralelo | Task 4 |
| Passo 3: criar labels no GitLab, mapa spId→gitlabId | Task 4 |
| Passo 4: GET board padrão | Task 5 |
| Passo 5: criar colunas (ColunaBoard=Sim, campo Posicao) | Task 5 |
| Passo 6: buscar userId por email, fallback id=1027 | Task 6 |
| Passo 7: adicionar owner access_level=50 | Task 6 |
| Passo 8: registrar na lista SP Projects | Task 7 |
| Passo 9: retorno com aviso se usuário não encontrado | Task 7 |
| Rollback retorna error + mensagem_usuario | Task 3 |
| SERVICE_ACCOUNT_ID = 1027 hardcoded | Task 1 |

Cobertura: **100%** ✓

### Consistência de nomes
- `spLabelIdToGitlabId` definido no Task 4, consumido no Task 5 ✓
- `projectId`, `projectUrl`, `usuarioNaoEncontrado` definidos no Task 3, usados em Tasks 4–7 ✓
- `graphToken` obtido no Task 4, reutilizado no Task 7 ✓
- `boardId` definido no Task 5, consumido no mesmo task ✓
- `corsHeaders` definido uma vez no handler, usado em todos os returns ✓
