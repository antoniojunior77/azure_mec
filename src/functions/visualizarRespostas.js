const { app } = require("@azure/functions");

app.http("visualizarRespostas", {
  methods: ["POST"],
  authLevel: "function",
  handler: async (request, context) => {
    try {
      const corpo = await request.json();
      const estrutura = corpo.estrutura;
      const payloadRespostas = corpo.answers; 

    
    // Se o que veio em 'answers' tiver uma chave interna também chamada 'answers', 
    // nós mergulhamos um nível. Isso resolve o formato do "Em Andamento".
    const respostas = (payloadRespostas && payloadRespostas.answers) 
                      ? payloadRespostas.answers 
                      : payloadRespostas;


      
      if (!estrutura || !estrutura.paginas) {
        return { status: 400, jsonBody: { error: "Estrutura não encontrada." } };
      }

      let listaAchatada = [];

      estrutura.paginas.forEach((pagina) => {
        const grupo = pagina.titulo || "Geral";

        pagina.perguntas.forEach((perg) => {
          const valorBruto = respostas ? respostas[perg.id] : null;
          let valorTraduzido = "---";
          
          // 🎯 NOVA LÓGICA: Define se a pergunta foi respondida ou não
          const foiRespondida = valorBruto !== undefined && valorBruto !== null && valorBruto !== "";

          if (foiRespondida) {
            if (perg.tipo === "opção" && perg.opcoes) {
              const converter = (v) => {
                const opcao = perg.opcoes.find(opt => String(opt.valor) === String(v));
                return opcao ? opcao.texto : v;
              };

              valorTraduzido = Array.isArray(valorBruto) 
                ? valorBruto.map(v => converter(v)).join(", ") 
                : converter(valorBruto);
            } else {
              valorTraduzido = String(valorBruto);
            }
          }

          listaAchatada.push({
            id: perg.id,
            grupo: grupo,
            pergunta: perg.rotulo,
            tipo: perg.tipo,
            valor: valorTraduzido,
            // 🚀 COLUNA DE STATUS PARA O POWER APPS
            status: foiRespondida ? "Preenchida" : "Pendente"
          });
        });
      });

      return { status: 200, jsonBody: listaAchatada };

    } catch (err) {
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});