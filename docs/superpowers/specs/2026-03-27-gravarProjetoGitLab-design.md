# Design: gravarProjetoGitLab

**Data:** 2026-03-27
**Arquivo alvo:** `src/functions/gravarProjetoGitLab.js`

---

## Visão geral

Azure Function HTTP que orquestra a criação completa de um projeto GitLab a partir de uma chamada do Power Automate. Engloba criação do projeto, labels, colunas do board, permissão de owner e registro na lista SharePoint de projetos. Em caso de falha em qualquer etapa, realiza rollback deletando o projeto GitLab criado.

---

## Endpoint

- **Rota:** `POST /api/gravarProjetoGitLab`
- **authLevel:** `function`
- **Métodos:** `POST`, `OPTIONS`
- **CORS:** igual ao padrão do projeto (`ALLOWED_ORIGIN`)

---

## Payload de entrada (enviado pelo Power Automate)

```json
{
  "name": "Nome do Projeto",
  "path": "nome_do_projeto",
  "namespace_id": 190,
  "description": "descrição do projeto",
  "visibility": "private",
  "initialize_with_readme": true,
  "email_responsavel": "antoniobjunior@mec.gov.br"
}
```

Todos os campos são obrigatórios. Validação na entrada retorna HTTP 400 se ausentes `name`, `path`, `namespace_id` ou `email_responsavel`.

---

## Fluxo de execução

### Passo 1 — Criar projeto GitLab
- `POST /projects` com o payload completo (exceto `email_responsavel`, que é interno)
- Salva `projectId` e `projectUrl` (`web_url` da resposta)
- Falha → HTTP 500 sem rollback (projeto não chegou a ser criado)

### Passo 2 — Buscar dados do SharePoint (paralelo)
Executados simultaneamente via `Promise.all`:
- **Labels** — Graph API: `GET /sites/:siteId/lists/:SP_LIST_LABELS_ID/items?expand=fields`
  - Campos usados: `id` (SP item ID), `Title`, `Cor`, `Descricao`, `ColunaBoard`
- **Boards** — Graph API: `GET /sites/:siteId/lists/:SP_LIST_BOARDS_ID/items?expand=fields`
  - Campos usados: `ID_LABEL` (referência ao SP item ID da lista Labels), `Posicao`

Falha → rollback + HTTP 500

### Passo 3 — Criar labels no GitLab
Para cada item da lista Labels:
```
POST /projects/:projectId/labels
{ name, color: Cor, description: Descricao }
```
Salva mapa `spLabelId → gitlabLabelId` para uso no passo 5.
Falha em qualquer label → rollback + HTTP 500

### Passo 4 — Obter board padrão
- `GET /projects/:projectId/boards`
- Usa o primeiro item da lista (`boards[0].id`)
- Falha → rollback + HTTP 500

### Passo 5 — Criar colunas no board
Apenas labels onde `ColunaBoard === "Sim"`:
1. Para cada label, busca no array de boards o item onde `boards.ID_LABEL === spLabelId`
2. Usa `Posicao` desse item como `position`
3. `POST /projects/:projectId/boards/:boardId/lists { label_id: gitlabLabelId, position: Posicao }`

Falha → rollback + HTTP 500

### Passo 6 — Buscar userId pelo email
- `GET /users?search=email_responsavel`
- Se retornar resultado → usa `users[0].id`
- Se array vazio → usa `user_id: 1027` (conta de serviço `sharepoint-automation`) e seta `usuarioNaoEncontrado = true`
- Falha na chamada → rollback + HTTP 500

### Passo 7 — Adicionar owner ao projeto
```
POST /projects/:projectId/members
{ user_id: userId, access_level: 50 }
```
Falha → rollback + HTTP 500

### Passo 8 — Registrar projeto na lista SharePoint
Graph API: `POST /sites/:siteId/lists/:SP_LIST_PROJECTS_ID/items`
```json
{
  "fields": {
    "Title": "<name do payload>",
    "ID_PROJETO": "<projectId>",
    "url": "<projectUrl>",
    "token": "<GITLAB_TOKEN env var>"
  }
}
```
Falha → rollback + HTTP 500

### Passo 9 — Retorno

**Sucesso normal (HTTP 200):**
```json
{
  "projectId": 123,
  "projectUrl": "https://gitlabbuilder.mec.gov.br/namespace/nome_do_projeto"
}
```

**Sucesso com aviso de usuário não encontrado (HTTP 200):**
```json
{
  "projectId": 123,
  "projectUrl": "https://gitlabbuilder.mec.gov.br/namespace/nome_do_projeto",
  "aviso": "Projeto criado com sucesso, porém o usuário 'email@mec.gov.br' não foi encontrado no GitLab. A conta 'sharepoint-automation' foi adicionada como owner temporário."
}
```

---

## Rollback

Acionado em falha dos passos 2–8:
- `DELETE /projects/:projectId`
- Retorna HTTP 500:
```json
{
  "error": "mensagem técnica do erro original (GitLab/Graph API)",
  "mensagem_usuario": "Não foi possível criar o projeto na etapa [nome da etapa]. O projeto GitLab foi removido."
}
```

---

## Autenticação SharePoint (Microsoft Graph)

Token obtido via client credentials a cada execução:
```
POST https://login.microsoftonline.com/:AZURE_TENANT_ID/oauth2/v2.0/token
body: grant_type=client_credentials
      client_id=AZURE_CLIENT_ID
      client_secret=AZURE_CLIENT_SECRET
      scope=https://graph.microsoft.com/.default
```

---

## Variáveis de ambiente utilizadas

| Variável               | Uso                                      |
|------------------------|------------------------------------------|
| `GITLAB_BASE_URL`      | Base URL da API GitLab                   |
| `GITLAB_TOKEN`         | Token de autenticação GitLab             |
| `GITLAB_USER_AGENT`    | User-Agent nas chamadas GitLab           |
| `AZURE_TENANT_ID`      | Tenant para token Graph                  |
| `AZURE_CLIENT_ID`      | Client ID para token Graph               |
| `AZURE_CLIENT_SECRET`  | Client Secret para token Graph           |
| `SHAREPOINT_SITE_ID`   | ID do site PortaldeDemandasSERES         |
| `SP_LIST_LABELS_ID`    | ID da lista Labels                       |
| `SP_LIST_BOARDS_ID`    | ID da lista Boards                       |
| `SP_LIST_PROJECTS_ID`  | ID da lista Projects                     |
| `ALLOWED_ORIGIN`       | CORS origin permitido                    |

---

## Conta de serviço fallback

| Campo    | Valor                                                              |
|----------|--------------------------------------------------------------------|
| id       | 1027                                                               |
| username | group_190_bot_aaae9ae49105d36b414845b65c7524dd                    |
| name     | sharepoint-automation                                              |

Usada como owner quando `email_responsavel` não é encontrado no GitLab.

---

## Estrutura interna do arquivo

```
src/functions/gravarProjetoGitLab.js
  ├─ getGraphToken()         — obtém token OAuth2 para Graph API
  ├─ fetchSpList(token, listId) — busca todos os itens de uma lista SP
  ├─ gitlabRequest(path, opts) — wrapper fetch autenticado para GitLab
  ├─ rollback(projectId)     — DELETE /projects/:id, silencia erros
  └─ handler principal       — orquestra os 9 passos com try/catch
```
