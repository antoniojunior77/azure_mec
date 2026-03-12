const { app } = require("@azure/functions");
const axios = require("axios");
const msal = require("@azure/msal-node");

app.http("testeRastreio", {
    methods: ["POST"],
    authLevel: "function",
    handler: async (request, context) => {
        // Criamos um cliente axios com timeout de 15 segundos para não travar
        const http = axios.create({ timeout: 15000 });

        try {
            context.log("1️⃣ Lendo corpo da requisição...");
            const body = await request.json();
            const formularioId = body.formularioId ? body.formularioId.replace(/[{}]/g, "") : null;

            context.log("2️⃣ Configurando variáveis de ambiente...");
            const { DATAVERSE_TENANT_ID, DATAVERSE_CLIENT_ID, DATAVERSE_CLIENT_SECRET, DATAVERSE_URL } = process.env;
            
            // Limpeza da URL para evitar erro de barra dupla //
            const resource = DATAVERSE_URL.endsWith('/') ? DATAVERSE_URL.slice(0, -1) : DATAVERSE_URL;

            context.log("3️⃣ Solicitando Tokens (MSAL)...");
            const msalConfig = { auth: { clientId: DATAVERSE_CLIENT_ID, authority: `https://login.microsoftonline.com/${DATAVERSE_TENANT_ID}`, clientSecret: DATAVERSE_CLIENT_SECRET } };
            const cca = new msal.ConfidentialClientApplication(msalConfig);
            
            const authResDV = await cca.acquireTokenByClientCredential({ scopes: [`${resource}/.default`] });
            const authResGraph = await cca.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
            context.log("✅ Tokens obtidos!");

            const apiDV = axios.create({
                baseURL: `${resource}/api/data/v9.2/`,
                headers: { Authorization: `Bearer ${authResDV.accessToken}` },
                timeout: 10000 // 10 segundos de limite
            });

            context.log(`4️⃣ Buscando datas do formulário: ${formularioId}...`);
            const resForm = await apiDV.get(`crb55_crd_formularios(${formularioId})?$select=crb55_vigencia_inicio,crb55_vigencia_fim`);
            context.log("✅ Datas do formulário recebidas!");

            context.log("5️⃣ Buscando usuários (TOP 5)...");
            const resUsers = await apiDV.get(`crb55_tb_usuarioses?$top=5&$select=crb55_email_secretario,crb55_email_secretaria,crb55_tipo_entidade,crb55_token`);
            const usuariosRaw = resUsers.data.value;
            context.log(`✅ ${usuariosRaw.length} usuários encontrados.`);

            return { status: 200, body: "Teste concluído com sucesso até a busca." };

        } catch (err) {
            const detalhe = err.response?.data?.error?.message || err.message;
            context.error("❌ ONDE PAROU:", detalhe);
            // Se for timeout, o erro será 'timeout of 15000ms exceeded'
            return { status: 500, body: `Erro no passo: ${detalhe}` };
        }
    }
});