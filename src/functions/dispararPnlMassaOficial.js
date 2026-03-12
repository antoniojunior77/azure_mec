const { app } = require("@azure/functions");
const axios = require("axios");
const msal = require("@azure/msal-node");

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatarData = (dataIso) => {
    if (!dataIso) return "---";
    const d = new Date(dataIso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

app.http("dispararPnlMassaOficial", {
    methods: ["POST"],
    authLevel: "function",
    handler: async (request, context) => {
        const body = await request.json();
        const formularioId = body.formularioId ? body.formularioId.replace(/[{}]/g, "") : null;
        const operadorEmail = body.operadorEmail || "cgmd@mec.gov.br";
        
        if (!formularioId) return { status: 400, body: "ID do formulário ausente." };

        let totalSucesso = 0;
        let totalErros = 0;
        const horaInicio = new Date();

        try {
            const { DATAVERSE_TENANT_ID, DATAVERSE_CLIENT_ID, DATAVERSE_CLIENT_SECRET, DATAVERSE_URL } = process.env;
            const resource = DATAVERSE_URL.endsWith('/') ? DATAVERSE_URL.slice(0, -1) : DATAVERSE_URL;

            // 1. AUTENTICAÇÃO
            const msalConfig = { auth: { clientId: DATAVERSE_CLIENT_ID, authority: `https://login.microsoftonline.com/${DATAVERSE_TENANT_ID}`, clientSecret: DATAVERSE_CLIENT_SECRET } };
            const cca = new msal.ConfidentialClientApplication(msalConfig);
            const [authDV, authGraph] = await Promise.all([
                cca.acquireTokenByClientCredential({ scopes: [`${resource}/.default`] }),
                cca.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] })
            ]);

            const apiDV = axios.create({ baseURL: `${resource}/api/data/v9.2/`, headers: { Authorization: `Bearer ${authDV.accessToken}` } });

            // 2. BUSCA PDF (ANEXO)
            context.log("📄 Gerando PDF...");
            const urlGeradorPdf = "https://pnld-func-gvdcaca2brccggdg.brazilsouth-01.azurewebsites.net/api/gerarCadernoQuestoes?code=fY8AhX4dNvdvpv66RRvoGWogmazIEBSlZkibgow09OfJAzFuJPtE4Q==";
            const resPdf = await axios.post(urlGeradorPdf, { formularioId });
            const { fileName, fileContent, contentType } = resPdf.data;

            // 3. BUSCA DATAS E NOME DO FORMULÁRIO
            context.log("📅 Buscando datas...");
            const resForm = await apiDV.get(`crb55_crd_formularios(${formularioId})?$select=crb55_name,crb55_vigencia_inicio,crb55_vigencia_fim`);
            const nomeForm = resForm.data.crb55_name;
            const dInicio = formatarData(resForm.data.crb55_vigencia_inicio);
            const dFim = formatarData(resForm.data.crb55_vigencia_fim);

            // 4. BUSCA USUÁRIOS PENDENTES (Filtro corrigido para pegar Vazios/Falsos)
            context.log("👥 Carregando usuários...");
            let usuariosRaw = [];
            let proximaPagina = `crb55_tb_usuarioses?$filter=crb55_email_enviado ne true&$select=crb55_tb_usuariosid,crb55_email_secretario,crb55_email_secretaria,crb55_tipo_de_entidade,crb55_token`;

            while (proximaPagina) {
                const resUsers = await apiDV.get(proximaPagina);
                usuariosRaw = usuariosRaw.concat(resUsers.data.value);
                proximaPagina = resUsers.data["@odata.nextLink"] ? resUsers.data["@odata.nextLink"].split('/api/data/v9.2/')[1] : null;
            }

            const urlGraph = `https://graph.microsoft.com/v1.0/users/pnldescuta@mec.gov.br/sendMail`;
            
            // 5. DISPARO SUAVE (Evita erro 429)
            const TAMANHO_LOTE = 20; 
            for (let i = 0; i < usuariosRaw.length; i += TAMANHO_LOTE) {
                const lote = usuariosRaw.slice(i, i + TAMANHO_LOTE);
                context.log(`📦 Lote ${Math.ceil(i/TAMANHO_LOTE) + 1} em processamento...`);

                for (const user of lote) {
                    const emailDestino = (user.crb55_tipo_de_entidade === "SECRETARIA MUNICIPAL DE EDUCACAO") 
                        ? user.crb55_email_secretario 
                        : user.crb55_email_secretaria;

                    if (!emailDestino) { totalErros++; continue; }

                    try {
                        await axios.post(urlGraph, {
                            message: {
                                subject: "Pesquisa Nacional PNLD 2026 - Gestão de Materiais Didáticos",
                                body: {
                                    contentType: "HTML",
                                    content: `
<p style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    Prezados(as) Dirigentes Estaduais e Municipais de Ensino,<br><br>
    A Secretaria de Educação Básica (SEB/MEC), por meio da Coordenação-Geral de Materiais Didáticos (CGMD), está realizando uma pesquisa nacional com as redes de ensino sobre remanejamento e gestão de estoques de livros didáticos do PNLD.<br><br>
    O objetivo é compreender como as redes organizam seus processos quando há sobras de livros, bem como identificar práticas de permuta, redistribuição e compartilhamento entre escolas e redes para garantir que todos os estudantes recebam seus materiais de forma adequada e tempestiva.<br><br>
    A participação de sua rede é fundamental para que possamos aprimorar a gestão do PNLD, apoiar as Secretarias na implementação de boas práticas e orientar ações futuras que assegurem maior eficiência e equidade na distribuição dos livros didáticos.<br><br>
    Para tanto pedimos que respondam ao questionário utilizando o link abaixo e o token:<br><br><br>
    🌐 Link do Portal: <a href="https://mecforms.powerappsportals.com/" target="_blank" style="color: rgb(186, 124, 255) !important;">https://mecforms.powerappsportals.com/</a><br>
    🔑 Seu Token de Acesso: <b>${user.crb55_token}</b><br><br>
    O Token é individual e intransferível, garantindo que as respostas correspondam apenas ao seu município. Recomendamos que a equipe leia previamente o formulário em anexo e realize o levantamento dos dados antes de iniciar o preenchimento do formulário.<br><br>
    O Prazo para resposta é do dia <b>${dInicio}</b> ao dia <b>${dFim}</b>.<br><br>
    Para dúvidas e esclarecimentos contacte: <b>cgmd@mec.gov.br</b><br><br>
    Contamos com a colaboração de todos(as) e agradecemos antecipadamente pela atenção e pelo compromisso com a educação básica.<br><br><br>
    <strong>Atenciosamente,<br>
    Secretaria de Educação Básica (SEB)<br>
    Diretoria de Apoio à Gestão Educacional (DAGE)<br>
    Coordenação-Geral de Materiais Didáticos (CGMD/SEB/MEC)</strong><br>
</p>`
                               },
 toRecipients: [{ emailAddress: { address: emailDestino } }],
                                attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", "name": fileName, "contentType": contentType, "contentBytes": fileContent }]
                            }
                        }, { headers: { Authorization: `Bearer ${authGraph.accessToken}` } });

                        await apiDV.patch(`crb55_tb_usuarioses(${user.crb55_tb_usuariosid})`, {
                            crb55_email_enviado: true,
                            crb55_data_envio_email: new Date().toISOString()
                        });
                        totalSucesso++;
                        await delay(150); // Pausa entre e-mails individuais
                    } catch (e) {
                        if (e.response?.status === 429) {
                            const wait = (e.response.headers['retry-after'] || 10) * 1000;
                            await delay(wait);
                        }
                        totalErros++;
                    }
                }
                await delay(2000); // Pausa entre lotes
            }

            // 6. RELATÓRIO FINAL PARA O OPERADOR
            const duracao = Math.floor((new Date() - horaInicio) / 1000 / 60);
            await axios.post(urlGraph, {
                message: {
                    subject: `📢 Relatório Final: ${nomeForm}`,
                    body: {
                        contentType: "HTML",
                        content: `<h2>Resumo do Disparo</h2><ul><li><b>Sucessos:</b> ${totalSucesso}</li><li><b>Falhas:</b> ${totalErros}</li><li><b>Duração:</b> ${duracao} min</li></ul>`
                    },
                    toRecipients: [{ emailAddress: { address: operadorEmail } }]
                }
            }, { headers: { Authorization: `Bearer ${authGraph.accessToken}` } });

            return { status: 200, body: "Finalizado." };

        } catch (err) {
            return { status: 500, body: err.message };
        }
    }
});