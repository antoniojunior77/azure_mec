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