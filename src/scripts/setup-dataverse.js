#!/usr/bin/env node
/**
 * setup-dataverse.js — Script de instalação do schema EduXP no Dataverse
 *
 * Uso:
 *   node src/scripts/setup-dataverse.js
 *
 * Variáveis de ambiente necessárias (pode usar .env ou export):
 *   DATAVERSE_TENANT_ID
 *   DATAVERSE_CLIENT_ID
 *   DATAVERSE_CLIENT_SECRET
 *   DATAVERSE_URL  (ex: https://org41ecace2.crm2.dynamics.com)
 *
 * O script é idempotente: verifica se a tabela/coluna já existe antes de criar.
 */

require("dotenv").config();
const https = require("https");
const querystring = require("querystring");

const TENANT_ID     = process.env.DATAVERSE_TENANT_ID;
const CLIENT_ID     = process.env.DATAVERSE_CLIENT_ID;
const CLIENT_SECRET = process.env.DATAVERSE_CLIENT_SECRET;
const DV_URL        = (process.env.DATAVERSE_URL || "").replace(/\/$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// Definição do schema
// ─────────────────────────────────────────────────────────────────────────────

const PUBLISHER_PREFIX = "eduxp";

/**
 * Tabelas que devem existir.
 * Cada tabela define:
 *   - logicalName: nome da tabela (sem prefixo)
 *   - displayName / pluralName: labels no Dataverse
 *   - primaryColumn: coluna primária (nome sem prefixo)
 *   - columns: colunas adicionais a criar
 */
const TABLES = [
  {
    logicalName: "usuario",
    displayName: "Usuário EduXP",
    pluralName:  "Usuários EduXP",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 200 },
    columns: [
      { schemaName: "email",       displayName: "E-mail",         type: "String",  maxLength: 320 },
      { schemaName: "nivel",       displayName: "Nível",          type: "Integer", minValue: 1, maxValue: 100 },
      { schemaName: "pontos",      displayName: "Pontos (XP)",    type: "Integer", minValue: 0 },
      { schemaName: "moedas",      displayName: "Moedas",         type: "Integer", minValue: 0 },
      { schemaName: "perfil",      displayName: "Perfil",         type: "Integer" },
      { schemaName: "fotoperfil",  displayName: "Foto de Perfil", type: "String",  maxLength: 500 },
    ]
  },
  {
    logicalName: "fornecedor",
    displayName: "Fornecedor",
    pluralName:  "Fornecedores",
    primaryColumn: { schemaName: "NomeFantasia", displayName: "Nome Fantasia", maxLength: 200 },
    columns: [
      { schemaName: "razaosocial",    displayName: "Razão Social",     type: "String",  maxLength: 300 },
      { schemaName: "cnpj",           displayName: "CNPJ",             type: "String",  maxLength: 20  },
      { schemaName: "emailcontato",   displayName: "E-mail Contato",   type: "String",  maxLength: 320 },
      { schemaName: "telefonecontato",displayName: "Telefone Contato", type: "String",  maxLength: 30  },
    ]
  },
  {
    logicalName: "missao",
    displayName: "Missão",
    pluralName:  "Missões",
    primaryColumn: { schemaName: "Titulo", displayName: "Título", maxLength: 200 },
    columns: [
      { schemaName: "descricao",       displayName: "Descrição",          type: "Memo" },
      { schemaName: "xprecompensa",    displayName: "XP Recompensa",      type: "Integer", minValue: 0 },
      { schemaName: "moedasrecompensa",displayName: "Moedas Recompensa",  type: "Integer", minValue: 0 },
      { schemaName: "totalobjetivos",  displayName: "Total Objetivos",    type: "Integer", minValue: 0 },
      { schemaName: "tipomissao",      displayName: "Tipo de Missão",     type: "Integer" },
    ]
  },
  {
    logicalName: "missaousuario",
    displayName: "Missão Usuário",
    pluralName:  "Missões Usuário",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 100 },
    columns: [
      { schemaName: "objetivosconcluidos", displayName: "Objetivos Concluídos",   type: "Integer", minValue: 0 },
      { schemaName: "percentualconclusao", displayName: "Percentual Conclusão",   type: "Integer", minValue: 0, maxValue: 100 },
      { schemaName: "status",              displayName: "Status",                 type: "Integer" },
      { schemaName: "dataref",             displayName: "Data Referência",        type: "String",  maxLength: 10 },
      { schemaName: "recompensaresgatada", displayName: "Recompensa Resgatada",   type: "Boolean" },
      { schemaName: "dataresgate",         displayName: "Data do Resgate",        type: "DateTime" },
    ]
  },
  {
    logicalName: "conquista",
    displayName: "Conquista",
    pluralName:  "Conquistas",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 200 },
    columns: [
      { schemaName: "descricao",        displayName: "Descrição",          type: "Memo"    },
      { schemaName: "tipo",             displayName: "Tipo",               type: "String",  maxLength: 100 },
      { schemaName: "pontosrequeridos", displayName: "Pontos Requeridos",  type: "Integer", minValue: 0 },
    ]
  },
  {
    logicalName: "conquistausuario",
    displayName: "Conquista Usuário",
    pluralName:  "Conquistas Usuário",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 100 },
    columns: [
      { schemaName: "dataconquista", displayName: "Data da Conquista", type: "String", maxLength: 10 },
    ]
  },
  {
    logicalName: "treinamento",
    displayName: "Treinamento",
    pluralName:  "Treinamentos",
    primaryColumn: { schemaName: "Titulo", displayName: "Título", maxLength: 200 },
    columns: [
      { schemaName: "descricao",    displayName: "Descrição",      type: "Memo"    },
      { schemaName: "urlconteudo",  displayName: "URL Conteúdo",   type: "String",  maxLength: 500 },
      { schemaName: "xprecompensa", displayName: "XP Recompensa",  type: "Integer", minValue: 0 },
      { schemaName: "customoedas",  displayName: "Custo Moedas",   type: "Integer", minValue: 0 },
    ]
  },
  {
    logicalName: "treinamentousuario",
    displayName: "Treinamento Usuário",
    pluralName:  "Treinamentos Usuário",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 100 },
    columns: [
      { schemaName: "percentualconclusao", displayName: "Percentual Conclusão", type: "Integer", minValue: 0, maxValue: 100 },
      { schemaName: "status",              displayName: "Status",               type: "Integer" },
    ]
  },
  {
    logicalName: "tipoatividade",
    displayName: "Tipo de Atividade",
    pluralName:  "Tipos de Atividade",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 200 },
    columns: [
      { schemaName: "descricao",  displayName: "Descrição",    type: "Memo"    },
      { schemaName: "xpganho",    displayName: "XP Ganho",     type: "Integer", minValue: 0 },
      { schemaName: "pontosganho",displayName: "Pontos Ganho", type: "Integer", minValue: 0 },
    ]
  },
  {
    logicalName: "atividade",
    displayName: "Atividade",
    pluralName:  "Atividades",
    primaryColumn: { schemaName: "Descricao", displayName: "Descrição", maxLength: 500 },
    columns: [
      { schemaName: "xpganho",       displayName: "XP Ganho",        type: "Integer", minValue: 0 },
      { schemaName: "pontosganhos",  displayName: "Pontos Ganhos",   type: "Integer", minValue: 0 },
      { schemaName: "dataatividade", displayName: "Data Atividade",  type: "DateTime" },
      { schemaName: "token",         displayName: "Token",           type: "String",  maxLength: 200 },
    ]
  },
  {
    logicalName: "transacaomoeda",
    displayName: "Transação de Moedas",
    pluralName:  "Transações de Moedas",
    primaryColumn: { schemaName: "Descricao", displayName: "Descrição", maxLength: 500 },
    columns: [
      { schemaName: "tipo",        displayName: "Tipo",          type: "Integer" },
      { schemaName: "valor",       displayName: "Valor",         type: "Integer" },
      { schemaName: "saldoantes",  displayName: "Saldo Antes",   type: "Integer" },
      { schemaName: "saldodepois", displayName: "Saldo Depois",  type: "Integer" },
      { schemaName: "origemtipo",  displayName: "Origem Tipo",   type: "Integer" },
      { schemaName: "origemid",    displayName: "Origem ID",     type: "String",  maxLength: 100 },
    ]
  },
  {
    logicalName: "projeto",
    displayName: "Projeto",
    pluralName:  "Projetos",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 200 },
    columns: [
      { schemaName: "descricao",  displayName: "Descrição",    type: "Memo"    },
      { schemaName: "datainicio", displayName: "Data Início",  type: "String",  maxLength: 10 },
      { schemaName: "datafim",    displayName: "Data Fim",     type: "String",  maxLength: 10 },
    ]
  },
  {
    logicalName: "projetousuario",
    displayName: "Projeto Usuário",
    pluralName:  "Projetos Usuário",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 100 },
    columns: [
      { schemaName: "papel", displayName: "Papel", type: "String", maxLength: 100 },
    ]
  },
  {
    logicalName: "performance",
    displayName: "Performance",
    pluralName:  "Performances",
    primaryColumn: { schemaName: "Nome", displayName: "Nome", maxLength: 200 },
    columns: [
      { schemaName: "valor",      displayName: "Valor",       type: "Decimal" },
      { schemaName: "periodo",    displayName: "Período",     type: "String",  maxLength: 20 },
      { schemaName: "indicador",  displayName: "Indicador",   type: "String",  maxLength: 200 },
    ]
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

let _token = null;
let _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = querystring.stringify({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         `${DV_URL}/.default`,
    grant_type:    "client_credentials"
  });
  const res = await httpPost(url, body, { "Content-Type": "application/x-www-form-urlencoded" });
  _token = res.access_token;
  _tokenExp = Date.now() + (res.expires_in || 3600) * 1000;
  return _token;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function httpPost(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...extraHeaders }
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function dvGet(path) {
  const token = await getToken();
  return new Promise((resolve, reject) => {
    const u = new URL(`${DV_URL}/api/data/v9.2/${path}`);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0"
      }
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    }).on("error", reject);
  });
}

async function dvPost(path, body) {
  const token = await getToken();
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(`${DV_URL}/api/data/v9.2/${path}`);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: "return=representation"
      }
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers Dataverse Metadata API
// ─────────────────────────────────────────────────────────────────────────────

async function getExistingTables() {
  const res = await dvGet("EntityDefinitions?$select=LogicalName&$filter=startswith(LogicalName,'eduxp_')");
  return new Set((res.value || []).map(e => e.LogicalName));
}

async function getExistingColumns(tableLogicalName) {
  const res = await dvGet(`EntityDefinitions(LogicalName='${tableLogicalName}')/Attributes?$select=LogicalName`);
  return new Set((res.value || []).map(a => a.LogicalName));
}

function buildTablePayload(table) {
  const schemaName = `eduxp_${table.logicalName}`;
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
    SchemaName: schemaName,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: table.displayName, LanguageCode: 1046 }] },
    DisplayCollectionName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: table.pluralName, LanguageCode: 1046 }] },
    Description: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [] },
    OwnershipType: "UserOwned",
    IsActivity: false,
    HasActivities: false,
    HasNotes: false,
    PrimaryNameAttribute: `eduxp_${table.primaryColumn.schemaName.toLowerCase()}`,
    Attributes: [
      {
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        SchemaName: `eduxp_${table.primaryColumn.schemaName}`,
        IsPrimaryName: true,
        DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: table.primaryColumn.displayName, LanguageCode: 1046 }] },
        RequiredLevel: { Value: "None" },
        MaxLength: table.primaryColumn.maxLength || 200,
        FormatName: { Value: "Text" }
      }
    ]
  };
}

function buildColumnPayload(col, tableLogicalName) {
  const base = {
    SchemaName: `eduxp_${col.schemaName}`,
    DisplayName: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: col.displayName, LanguageCode: 1046 }] },
    RequiredLevel: { Value: "None" },
    Description: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [] }
  };

  switch (col.type) {
    case "String":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", MaxLength: col.maxLength || 200, FormatName: { Value: "Text" } };
    case "Memo":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", MaxLength: col.maxLength || 2000, Format: "TextArea" };
    case "Integer":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", MinValue: col.minValue ?? -2147483648, MaxValue: col.maxValue ?? 2147483647, Format: "None" };
    case "Decimal":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", MinValue: col.minValue ?? -100000000000, MaxValue: col.maxValue ?? 100000000000, Precision: 2 };
    case "Boolean":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata", OptionSet: { TrueOption: { Value: 1, Label: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: "Sim", LanguageCode: 1046 }] } }, FalseOption: { Value: 0, Label: { "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: "Não", LanguageCode: 1046 }] } } } };
    case "DateTime":
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", Format: "DateAndTime", DateTimeBehavior: { Value: "UserLocal" } };
    default:
      return { ...base, "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", MaxLength: 200, FormatName: { Value: "Text" } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !DV_URL) {
    console.error("❌ Variáveis de ambiente não configuradas. Defina DATAVERSE_TENANT_ID, DATAVERSE_CLIENT_ID, DATAVERSE_CLIENT_SECRET, DATAVERSE_URL.");
    process.exit(1);
  }

  console.log(`\n🚀 EduXP — Setup Dataverse\n   URL: ${DV_URL}\n`);

  const existingTables = await getExistingTables();
  console.log(`📋 Tabelas eduxp_ existentes: ${existingTables.size}`);

  for (const table of TABLES) {
    const tableLogical = `eduxp_${table.logicalName}`;
    const tableSchema  = `eduxp_${table.logicalName}s`; // plural OData

    // ── Criar tabela se não existe ──
    if (!existingTables.has(tableLogical)) {
      console.log(`\n  ➕ Criando tabela ${tableLogical}...`);
      const payload = buildTablePayload(table);
      const res = await dvPost("EntityDefinitions", payload);
      if (res.status === 201 || res.status === 200) {
        console.log(`  ✅ Tabela ${tableLogical} criada.`);
      } else {
        console.warn(`  ⚠️  Tabela ${tableLogical} — status ${res.status}:`, JSON.stringify(res.body).slice(0, 300));
        continue;
      }
    } else {
      console.log(`\n  ✔️  Tabela ${tableLogical} já existe.`);
    }

    // ── Criar colunas ausentes ──
    const existingCols = await getExistingColumns(tableLogical);

    for (const col of table.columns) {
      const colLogical = `eduxp_${col.schemaName.toLowerCase()}`;
      if (existingCols.has(colLogical)) {
        console.log(`     ✔️  Coluna ${colLogical} já existe.`);
        continue;
      }
      console.log(`     ➕ Criando coluna ${colLogical} (${col.type})...`);
      const payload = buildColumnPayload(col, tableLogical);
      const res = await dvPost(`EntityDefinitions(LogicalName='${tableLogical}')/Attributes`, payload);
      if (res.status === 201 || res.status === 200) {
        console.log(`     ✅ Coluna ${colLogical} criada.`);
      } else {
        console.warn(`     ⚠️  Coluna ${colLogical} — status ${res.status}:`, JSON.stringify(res.body).slice(0, 300));
      }
    }
  }

  console.log("\n✅ Setup concluído!\n");
}

main().catch(err => {
  console.error("❌ Erro fatal:", err.message);
  process.exit(1);
});
