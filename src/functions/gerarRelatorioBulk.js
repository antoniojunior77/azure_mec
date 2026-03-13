const { app } = require("@azure/functions");
const axios = require("axios");
const msal = require("@azure/msal-node");
const ExcelJS = require("exceljs");

// --- FUNÇÕES AUXILIARES ---

async function buscarTudo(api, endpoint) {
    let resultados = [];
    let url = endpoint;
    while (url) {
        const res = await api.get(url);
        resultados = resultados.concat(res.data.value || []);
        url = res.data["@odata.nextLink"] ? res.data["@odata.nextLink"].split('/api/data/v9.2/')[1] : null;
    }
    return resultados;
}

function traduzir(valor, pergunta) {
    if (valor === null || valor === undefined || valor === "") return "---";
    if (!pergunta.opcoes || pergunta.opcoes.length === 0) return valor.toString();

    if (Array.isArray(valor)) {
        return valor.map(v => {
            const op = pergunta.opcoes.find(o => String(o.valor) === String(v));
            return op ? (op.texto || op.rotulo) : v;
        }).join("; ");
    }

    const opcao = pergunta.opcoes.find(o => String(o.valor) === String(valor));
    return opcao ? (opcao.texto || opcao.rotulo) : valor;
}

// --- HANDLER PRINCIPAL ---

app.http("gerarRelatorioExcelPNLD", {
    methods: ["POST"],
    authLevel: "function",
    handler: async (request, context) => {
        context.log("🚀 Gerando relatório síncrono com data dinâmica...");

        try {
            const body = await request.json();
            const formularioId = body.formularioId;

            const tenantId = process.env.DATAVERSE_TENANT_ID;
            const clientId = process.env.DATAVERSE_CLIENT_ID;
            const clientSecret = process.env.DATAVERSE_CLIENT_SECRET;
            const resource = process.env.DATAVERSE_URL;

            // 1. AUTENTICAÇÃO
            const msalConfig = { auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret } };
            const cca = new msal.ConfidentialClientApplication(msalConfig);
            const authRes = await cca.acquireTokenByClientCredential({ scopes: [`${resource}/.default`] });
            const token = authRes.accessToken;

            const api = axios.create({
                baseURL: `${resource}/api/data/v9.2/`,
                headers: { Authorization: `Bearer ${token}`, "Prefer": "odata.maxpagesize=500" }
            });

            // 2. BUSCA DE DADOS EM PARALELO
            const queryRespostas = "crb55_crd_respostaentes?$select=crb55_respostasjson,crb55_token,crb55_status,crb55_cargo_acao,crb55_cpf_acao,crb55_email_acao,crb55_nome_acao";
            
            const [resForm, listaRespostasRaw, listaUsuariosRaw] = await Promise.all([
                api.get(`crb55_crd_formularios(${formularioId})?$select=crb55_perguntasjson`),
                buscarTudo(api, queryRespostas),
                buscarTudo(api, "crb55_tb_usuarioses?$select=crb55_tipo_de_entidade,crb55_municipio_secretaria,crb55_uf_secretaria,crb55_token")
            ]);

            // ✨ FILTRAGEM DOS TOKENS BETA
            const listaRespostas = listaRespostasRaw.filter(r => 
                r.crb55_token && !r.crb55_token.toUpperCase().startsWith("BETA")
            );

            const listaUsuarios = listaUsuariosRaw.filter(u => 
                u.crb55_token && !u.crb55_token.toUpperCase().startsWith("BETA")
            );


            const estruturaMestre = JSON.parse(resForm.data.crb55_perguntasjson);
            const mapaRespostas = new Map(listaRespostas.map(r => [r.crb55_token, r]));

            // 3. MONTAGEM DO EXCEL
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Censo PNLD 2026');

            const colunasExcel = [
                { header: 'Ente', key: 'ente', width: 20 },
                { header: 'UF', key: 'uf', width: 10 },
                { header: 'Município', key: 'municipio', width: 35 },
                { header: 'Status', key: 'status', width: 15 },
                { header: 'Nome Responsável', key: 'nome_resp', width: 25 },
                { header: 'CPF Responsável', key: 'cpf_resp', width: 15 },
                { header: 'E-mail Responsável', key: 'email_resp', width: 25 },
                { header: 'Cargo Responsável', key: 'cargo_resp', width: 20 }
            ];

            estruturaMestre.paginas.forEach(pag => {
                pag.perguntas.forEach(perg => {
                    colunasExcel.push({ header: perg.rotulo.replace(/[\n\r]/g, " "), key: perg.id, width: 35 });
                });
            });
            sheet.columns = colunasExcel;
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004A8D' } };

            // 4. PREENCHIMENTO DAS LINHAS
            listaUsuarios.forEach(mun => {
                const resp = mapaRespostas.get(mun.crb55_token);
                const status = resp ? (resp.crb55_status === 3 ? "CONCLUÍDO" : "EM RASCUNHO") : "NÃO INICIADO";
                
                let answers = {};
                if (resp?.crb55_respostasjson) {
                    try {
                        const parsed = JSON.parse(resp.crb55_respostasjson);
                        answers = parsed.answers || parsed;
                    } catch (e) { }
                }

                const dadosDaLinha = {
                    ente: mun.crb55_tipo_de_entidade || "---",
                    uf: mun.crb55_uf_secretaria,
                    municipio: mun.crb55_municipio_secretaria || "---",
                    status: status,
                    nome_resp: resp?.crb55_nome_acao || "---",
                    cpf_resp: resp?.crb55_cpf_acao || "---",
                    email_resp: resp?.crb55_email_acao || "---",
                    cargo_resp: resp?.crb55_cargo_acao || "---"
                };

                estruturaMestre.paginas.forEach(pag => {
                    pag.perguntas.forEach(perg => {
                        dadosDaLinha[perg.id] = traduzir(answers[perg.id], perg);
                    });
                });
                sheet.addRow(dadosDaLinha);
            });

            // 5. GERAÇÃO DO BUFFER E CONVERSÃO PARA BASE64
            const buffer = await workbook.xlsx.writeBuffer();
            const base64 = buffer.toString('base64');

            // 🎯 LÓGICA DA DATA DINÂMICA (MMAAAA)
            const hoje = new Date();
            const mes = String(hoje.getMonth() + 1).padStart(2, '0');
            const ano = hoje.getFullYear();

            const horas = String(hoje.getHours()).padStart(2, '0');
            const minutos = String(hoje.getMinutes()).padStart(2, '0');
            const segundos = String(hoje.getSeconds()).padStart(2, '0');
            const dataString = `${mes}${ano}${horas}${minutos}${segundos}`;

            context.log(`✅ Relatório gerado com sucesso para a data: ${dataString}`);

            return {
                status: 200,
                jsonBody: {
                    fileName: `Relatorio_Censo_PNLD_${dataString}.xlsx`,
                    fileContent: base64
                }
            };

        } catch (err) {
            context.log.error("❌ Erro na geração:", err.message);
            return { status: 500, body: `Erro ao gerar Excel: ${err.message}` };
        }
    }
});