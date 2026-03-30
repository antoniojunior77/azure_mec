// shared/gamificacao.js

const LEVEL_XP_MIN = [
  { nivel: 1, xpMin: 0 },
  { nivel: 2, xpMin: 500 },
  { nivel: 3, xpMin: 1100 },
  { nivel: 4, xpMin: 1820 },
  { nivel: 5, xpMin: 2680 },
  { nivel: 6, xpMin: 3710 },
  { nivel: 7, xpMin: 4950 },
  { nivel: 8, xpMin: 6440 },
  { nivel: 9, xpMin: 8320 },
  { nivel: 10, xpMin: 10000 }
];

function calcLevelFromXp(xpTotal) {
  const xp = Number(xpTotal || 0);
  let current = LEVEL_XP_MIN[0];

  for (const row of LEVEL_XP_MIN) {
    if (xp >= row.xpMin) current = row;
    else break;
  }

  const idx = LEVEL_XP_MIN.findIndex(r => r.nivel === current.nivel);
  const next = LEVEL_XP_MIN[idx + 1] || null;

  const xpMinNivelAtual = current.xpMin;
  const xpMinProximoNivel = next?.xpMin ?? null;

  const xpDentroDoNivel = xp - xpMinNivelAtual;
  const xpParaProximoNivel = xpMinProximoNivel !== null ? Math.max(0, xpMinProximoNivel - xp) : 0;

  const faixa = xpMinProximoNivel !== null ? (xpMinProximoNivel - xpMinNivelAtual) : null;
  const progresso = faixa ? Math.min(1, Math.max(0, xpDentroDoNivel / faixa)) : 1;

  return {
    xpTotal: xp,
    nivelAtual: current.nivel,
    xpMinNivelAtual,
    xpMinProximoNivel,
    xpDentroDoNivel,
    xpParaProximoNivel,
    progressoProximoNivel: progresso
  };
}

/**
 * Credita XP/Moedas no usuário + recalcula nível + retorna xpInfo.
 * - Não faz idempotência (isso fica por conta do vínculo/flag do evento).
 * - MVP simples e robusto.
 */
async function creditarUsuario({
  getRecordById,
  updateRecord,
  tableUsuario,
  usuarioId,
  xp = 0,
  moedas = 0,
  userSelect = "new_usuarioid,new_pontos,new_moedas,new_nivel"
}) {
  const u = await getRecordById(tableUsuario, usuarioId, { select: userSelect });

  const pontosAtual = Number(u?.new_pontos || 0);
  const moedasAtual = Number(u?.new_moedas || 0);

  const pontosNovo = pontosAtual + Number(xp || 0);
  const moedasNovo = moedasAtual + Number(moedas || 0);

  const base = calcLevelFromXp(pontosNovo);

  // xpInfo no formato “front-friendly”
  const xpInfo = {
    nivelAtual: base.nivelAtual,
    xpTotal: base.xpTotal,
    xpMinNivelAtual: base.xpMinNivelAtual,
    xpMinProximoNivel: base.xpMinProximoNivel,
    progresso: base.progressoProximoNivel,
    xpNoNivel: base.xpDentroDoNivel,
    xpParaProximoNivel: base.xpParaProximoNivel,
    isMaxLevel: base.xpMinProximoNivel === null
  };

  await updateRecord(tableUsuario, usuarioId, {
    new_pontos: pontosNovo,
    new_moedas: moedasNovo,
    new_nivel: base.nivelAtual
  });

  return {
    usuarioPatch: { new_pontos: pontosNovo, new_moedas: moedasNovo, new_nivel: base.nivelAtual },
    xpInfo
  };
}

module.exports = {
  LEVEL_XP_MIN,
  calcLevelFromXp,
  creditarUsuario,
  ensureConquistaUsuario
};
/**
 * Garante ConquistaUsuario (idempotente).
 * ✅ ATUALIZADO: Agora também credita os pontos da conquista no usuário
 * Retorna { created: true/false, id?: guid, pontosCreditos?: number }
 */
async function ensureConquistaUsuario({
  listRecords,
  createRecord,
  getRecordById,  // ✅ NOVO: necessário para buscar pontos da conquista e do usuário
  updateRecord,   // ✅ NOVO: necessário para creditar pontos
  usuarioId,
  conquistaId,
  tableConquistaUsuario = "new_conquistausuarios",
  tableUsuario = "new_usuarios",
  tableConquista = "new_conquistas",
  navUsuario = "new_UsuarioID",
  navConquista = "new_ConquistaID",
  colData = "new_dataconquista",
  colPontosConquista = "new_pontosrequeridos",  // ✅ NOVO: coluna de pontos na conquista
  colPontosUsuario = "new_pontos"               // ✅ NOVO: coluna de pontos no usuário
}) {
  if (!usuarioId || !conquistaId) {
    return { created: false, skipped: true, reason: "usuarioId/conquistaId ausentes" };
  }

  const u = String(usuarioId).trim().replace(/[{}]/g, "").toLowerCase();
  const c = String(conquistaId).trim().replace(/[{}]/g, "").toLowerCase();

  // checa se já existe (idempotência)
  const filter = [
    `_new_usuarioid_value eq ${u}`,
    `_new_conquistaid_value eq ${c}`
  ].join(" and ");

  const exists = await listRecords(tableConquistaUsuario, {
    select: "new_conquistausuarioid",
    filter,
    top: 1
  });

  const first = (exists?.value || [])[0];
  if (first?.new_conquistausuarioid) {
    return { created: false, id: first.new_conquistausuarioid, pontosCreditos: 0 };
  }

  // ✅ NOVO: Buscar pontos da conquista
  let pontosConquista = 0;
  if (getRecordById) {
    const conquista = await getRecordById(tableConquista, c, {
      select: `new_conquistaid,${colPontosConquista}`
    });
    pontosConquista = Number(conquista?.[colPontosConquista] ?? 0);
  }

  const dateOnly = new Date().toISOString().slice(0, 10);

  const createBody = {
    [colData]: dateOnly,
    [`${navUsuario}@odata.bind`]: `/${tableUsuario}(${u})`,
    [`${navConquista}@odata.bind`]: `/${tableConquista}(${c})`
  };

  const created = await createRecord(tableConquistaUsuario, createBody);

  // ✅ NOVO: Creditar pontos da conquista no usuário
  if (pontosConquista > 0 && getRecordById && updateRecord) {
    const usuario = await getRecordById(tableUsuario, u, {
      select: `new_usuarioid,${colPontosUsuario}`
    });
    const pontosAtuais = Number(usuario?.[colPontosUsuario] ?? 0);
    const pontosNovos = pontosAtuais + pontosConquista;

    await updateRecord(tableUsuario, u, {
      [colPontosUsuario]: pontosNovos
    });
  }

  return { 
    created: true, 
    id: created?.new_conquistausuarioid || null,
    pontosCreditos: pontosConquista
  };
}
