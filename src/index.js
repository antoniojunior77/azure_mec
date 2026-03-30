// src/index.js
const { app } = require("@azure/functions");


app.setup({ enableHttpStream: true });

// registra as functions
require("./functions/generateblobsas");
require("./functions/uploadImage");
require("./functions/gerarTokensEnte");
require("./functions/visualizarRespostas");
require("./functions/gerarRelatorioBulk");
require("./functions/gerarCadernoQuestoes");
require("./functions/dispararPnlMassaOficial");
require("./functions/testeRastreio");
require("./functions/getAcessGitLab");
require("./functions/gravarProjetoGitLab");

// EduXP functions
require("./functions/eduxpUsuarios");
require("./functions/eduxpConsultarUsuarios");
require("./functions/eduxpFornecedores");
require("./functions/eduxpTipoAtividade");
require("./functions/eduxpAtividades");
require("./functions/eduxpMissoes");
require("./functions/eduxpMissoesUsuario");
require("./functions/eduxpConquistas");
require("./functions/eduxpConquistasUsuario");
require("./functions/eduxpClassificacoes");
require("./functions/eduxpClassificacoesUsuario");
require("./functions/eduxpTreinamentos");
require("./functions/eduxpTreinamentosUsuario");
require("./functions/eduxpProjetos");
require("./functions/eduxpProjetosUsuario");
require("./functions/eduxpTransacaoMoedas");
require("./functions/eduxpPerformance");