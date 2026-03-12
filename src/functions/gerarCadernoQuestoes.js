const { app } = require("@azure/functions");
const axios = require("axios");
const msal = require("@azure/msal-node");
const PDFDocument = require("pdfkit"); // 🎯 Motor compatível com Azure Windows

app.http("gerarCadernoQuestoes", {
    methods: ["POST"],
    authLevel: "function",
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const formularioId = body.formularioId;
            if (!formularioId) return { status: 400, body: "ID ausente." };

            // 1. AUTENTICAÇÃO (MANTENDO SEU PADRÃO)
            const tenantId = process.env.DATAVERSE_TENANT_ID;
            const clientId = process.env.DATAVERSE_CLIENT_ID;
            const clientSecret = process.env.DATAVERSE_CLIENT_SECRET;
            const resource = process.env.DATAVERSE_URL;

            const msalConfig = { auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret } };
            const cca = new msal.ConfidentialClientApplication(msalConfig);
            const authRes = await cca.acquireTokenByClientCredential({ scopes: [`${resource}/.default`] });
            
            const api = axios.create({
                baseURL: `${resource}/api/data/v9.2/`,
                headers: { Authorization: `Bearer ${authRes.accessToken}` }
            });

            // 2. BUSCA NO DATAVERSE
            const resForm = await api.get(`crb55_crd_formularios(${formularioId})?$select=crb55_name,crb55_perguntasjson`);
            const nomeFormulario = resForm.data.crb55_name;
            const estrutura = JSON.parse(resForm.data.crb55_perguntasjson);

            // 3. CONFIGURAÇÃO DO DOCUMENTO PDF
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            const pdfPromise = new Promise((resolve) => { doc.on('end', () => resolve(Buffer.concat(buffers))); });

            // --- 🎨 DEFINIÇÃO DE ESTILOS (O SEU "CSS" AQUI) ---
            const azulMEC = "#004A8D";
            const cinzaClaro = "#FAFAFA";
            const cinzaBorda = "#CCCCCC";
            const cinzaTexto = "#444444";

            // CABEÇALHO INSTITUCIONAL
            doc.fillColor(azulMEC).fontSize(18).font('Helvetica-Bold').text("CADERNO DE QUESTÕES - PNLD 2026", { align: 'center' });
            doc.moveDown(0.3);
            doc.fillColor(cinzaTexto).fontSize(10).font('Helvetica').text(`Formulário: ${nomeFormulario}`, { align: 'center' });
            doc.text("Documento de Apoio à Coleta de Dados", { align: 'center' });
            doc.moveDown(1.5);

            // RENDERIZAÇÃO DAS PÁGINAS/SEÇÕES
            estrutura.paginas.forEach((pagina) => {
                // Estilo da Faixa de Título (Substitui o .secao-titulo do CSS)
                doc.rect(50, doc.y, 500, 22).fill(azulMEC); 
                doc.fillColor("#FFFFFF").fontSize(11).font('Helvetica-Bold').text(pagina.titulo.toUpperCase(), 60, doc.y + 6);
                doc.moveDown(1.5);

                pagina.perguntas.forEach((perg) => {
                    // Estilo da Pergunta
                    doc.fillColor("#333333").fontSize(11).font('Helvetica-Bold').text(perg.rotulo);
                    
                    //if (perg.obrigatoria) {
                    //    doc.fillColor("red").fontSize(11).text("*", { continued: true }).fillColor("#333333");
                    //}
                    
                    // Estilo da Descrição (Itálico)
                    if (perg.descricao) {
                        doc.moveDown(0.2);
                        doc.fillColor("#777777").fontSize(9).font('Helvetica-Oblique').text(perg.descricao);
                    }

                    doc.moveDown(0.5);

                    // Estilo dos Campos de Resposta (Inputs)
                    if (perg.tipo === "texto") {
                        const altura = (perg.linhaUnica === false) ? 60 : 20;
                        // Desenha o retângulo do input (O seu .box-resposta do CSS)
                        doc.rect(50, doc.y, 500, altura).strokeColor(cinzaBorda).lineWidth(1).stroke();
                        doc.moveDown(altura / 12 + 1); 
                    } 
                    else if (perg.tipo === "opção" && perg.opcoes) {
                        perg.opcoes.forEach((opt) => {
                            const yPos = doc.y;
                            // Desenha o quadradinho (O seu .checkbox do CSS)
                            doc.rect(55, yPos, 10, 10).strokeColor("#333333").lineWidth(1).stroke();
                            doc.fillColor("#333333").fontSize(10).font('Helvetica').text(opt.texto || opt.rotulo, 75, yPos);
                            doc.moveDown(0.4);
                        });
                        doc.moveDown(0.8);
                    }

                    // Quebra de página automática se estiver perto do fim
                    if (doc.y > 720) doc.addPage();
                });
            });

            // RODAPÉ (Fixed bottom)
            doc.fontSize(8).fillColor("#999999").font('Helvetica').text(
                `Gerado em ${new Date().toLocaleString('pt-BR')} | PNLD Digital - MEC`, 
                50, 785, { align: 'center' }
            );

            doc.end();

            // 4. LÓGICA DO NOME DO ARQUIVO (ddmmaaaahhmmss)
            const agora = new Date();
            const ts = `${String(agora.getDate()).padStart(2, '0')}${String(agora.getMonth() + 1).padStart(2, '0')}${agora.getFullYear()}${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;
            
            const pdfBuffer = await pdfPromise;

            return {
                status: 200,
                jsonBody: {
                    fileName: `Caderno_PNLD_${ts}.pdf`,
                    fileContent: pdfBuffer.toString('base64'),
                    contentType: "application/pdf"
                }
            };

        } catch (err) {
            context.log.error("❌ Erro:", err.message);
            return { status: 500, body: `Erro: ${err.message}` };
        }
    }
});