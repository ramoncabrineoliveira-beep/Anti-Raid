// =====================================================
// 1. IMPORTS E CLIENT
// =====================================================

require("dotenv").config();

const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AuditLogEvent,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});


// =====================================================
// 2. PASTAS E ARQUIVOS
// =====================================================

["./data", "./backups", "./backups/history", "./transcripts"].forEach(folder => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

const CONFIG_PATH = "./data/config.json";
const CASES_PATH = "./data/cases.json";
const WARNS_PATH = "./data/warns.json";
const RAID_BANS_PATH = "./data/raidbans.json";
const SECURITY_STATS_PATH = "./data/securitystats.json";
const TICKET_STATS_PATH = "./data/ticketstats.json";


// =====================================================
// 3. CONFIG PADRÃO
// =====================================================

const defaultConfig = {
  antiraid: true,
  antinuke: true,
  antispam: true,
  antiinvite: true,
  antilink: false,
  antibot: true,
  antiwebhook: true,
  antieveryone: true,

  antichannelcreate: true,
  antichanneldelete: true,
  antirolecreate: true,
  antiroledelete: true,
  antiban: true,
  antikick: true,

  antialt: true,
  antijoinraid: true,
  antidangerousrole: true,

  botlock: false,
  webhooklock: false,
  lockdown: false,
  emergency: false,

  whitelist: [],
  blacklist: [],
  allowedBots: [],
  immuneRoles: [],
  immuneUsers: [],

  altMinDays: 7,
  joinRaidLimit: 5,
  joinRaidTime: 10000,

  panic: false,
  ultrasecurity: false,

  logsPremium: true,
  logMessageDelete: true,
  logMessageEdit: true,
  logJoinLeave: true,
  logNickname: true,
  logRoles: true,
  logPermissions: true,
  logEmoji: true,
  logWebhook: true,

  autoBackup: true,
  backupIntervalMinutes: 15,
  ticketCategoryName: "🎫 Tickets",
  ticketLogChannel: process.env.TICKET_LOG_CHANNEL_ID || null,

  quarantineRoleName: "Quarentena",
  logChannel: process.env.LOG_CHANNEL_ID || null
};


// =====================================================
// 4. FUNÇÕES JSON
// =====================================================

function createFile(path, data) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  }
}

createFile(CONFIG_PATH, defaultConfig);
createFile(CASES_PATH, []);
createFile(WARNS_PATH, {});
createFile(RAID_BANS_PATH, []);
createFile(SECURITY_STATS_PATH, { raidsBlocked: 0, usersPunished: 0, channelsRestored: 0, rolesRestored: 0, botsBlocked: 0, ticketsCreated: 0, ticketsClosed: 0 });
createFile(TICKET_STATS_PATH, { created: 0, closed: 0, assumed: 0, ratings: [] });

function readJSON(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function getConfig() {
  return {
    ...defaultConfig,
    ...readJSON(CONFIG_PATH)
  };
}

function saveConfig(config) {
  saveJSON(CONFIG_PATH, {
    ...defaultConfig,
    ...config
  });
}

function getSecurityStats() {
  return readJSON(SECURITY_STATS_PATH);
}

function addSecurityStat(key, amount = 1) {
  const stats = getSecurityStats();
  stats[key] = (stats[key] || 0) + amount;
  saveJSON(SECURITY_STATS_PATH, stats);
}

function getTicketStats() {
  return readJSON(TICKET_STATS_PATH);
}

function addTicketStat(key, amount = 1) {
  const stats = getTicketStats();
  stats[key] = (stats[key] || 0) + amount;
  saveJSON(TICKET_STATS_PATH, stats);
}


// =====================================================
// 5. FUNÇÕES GERAIS
// =====================================================

function nowBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function isOwner(userId) {
  return userId === process.env.OWNER_ID;
}

function isWhitelisted(userId) {
  const config = getConfig();
  return isOwner(userId) || config.whitelist.includes(userId);
}

function updateArray(key, id, add = true) {
  const config = getConfig();

  if (!config[key]) config[key] = [];

  if (add) {
    config[key] = [...new Set([...config[key], id])];
  } else {
    config[key] = config[key].filter(item => item !== id);
  }

  saveConfig(config);
}


// =====================================================
// 6. LOGS
// =====================================================

async function sendLog(guild, title, description, color = "Red") {
  const config = getConfig();
  const channelId = config.logChannel || process.env.LOG_CHANNEL_ID;

  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Security System • ${nowBR()}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}


// =====================================================
// 7. AUDIT LOG
// =====================================================

async function getExecutor(guild, type) {
  const logs = await guild.fetchAuditLogs({
    type,
    limit: 1
  }).catch(() => null);

  const entry = logs?.entries?.first();

  if (!entry) return null;
  if (Date.now() - entry.createdTimestamp > 10000) return null;

  return entry.executor;
}


// =====================================================
// 8. SISTEMA DE PUNIÇÃO
// =====================================================

async function canPunish(guild, userId) {
  const config = getConfig();

  if (!userId) return false;
  if (isOwner(userId)) return false;
  if (userId === guild.ownerId) return false;
  if (config.whitelist.includes(userId)) return false;
  if (config.immuneUsers.includes(userId)) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  const bot = guild.members.me;

  if (!member || !bot) return false;

  const hasImmuneRole = member.roles.cache.some(role =>
    config.immuneRoles.includes(role.id)
  );

  if (hasImmuneRole) return false;

  if (member.roles.highest.position >= bot.roles.highest.position) {
    return false;
  }

  return true;
}

async function punish(guild, userId, reason) {
  if (!(await canPunish(guild, userId))) {
    return sendLog(
      guild,
      "⚠️ Punição ignorada",
      `Usuário: <@${userId}>\nMotivo: protegido, whitelist, imune ou cargo maior que o bot.\nAção: ${reason}`,
      "Yellow"
    );
  }

  await guild.members.ban(userId, {
    reason: `Security System: ${reason}`
  }).catch(() => {});

  addSecurityStat("usersPunished");

  await saveRaidBan(guild.id, userId, reason);

  await sendLog(
    guild,
    "🚨 Usuário banido pelo Anti-Raid",
    `Usuário: <@${userId}>\nMotivo: **${reason}**\nHorário: **${nowBR()}**`,
    "Red"
  );
}


// =====================================================
// 9. CASOS E RAID BANS
// =====================================================

function addCase(type, moderatorId, userId, reason) {
  const cases = readJSON(CASES_PATH);

  const newCase = {
    id: cases.length + 1,
    type,
    moderatorId,
    userId,
    reason,
    date: nowBR()
  };

  cases.push(newCase);
  saveJSON(CASES_PATH, cases);

  return newCase;
}

async function saveRaidBan(guildId, userId, reason) {
  const bans = readJSON(RAID_BANS_PATH);

  bans.push({
    guildId,
    userId,
    reason,
    date: nowBR()
  });

  saveJSON(RAID_BANS_PATH, bans);
}


// =====================================================
// 10. CONTADORES DE RAID / SPAM / JOIN
// =====================================================

const actionMap = new Map();
const spamMap = new Map();
const joinMap = new Map();
const suspiciousScoreMap = new Map();

const ACTION_LIMIT = 3;
const ACTION_TIME = 10000;

async function registerDangerAction(guild, userId, reason) {
  if (isWhitelisted(userId)) return;

  const key = `${guild.id}-${userId}`;
  const old = actionMap.get(key) || [];
  const filtered = old.filter(time => Date.now() - time < ACTION_TIME);

  filtered.push(Date.now());
  actionMap.set(key, filtered);

  if (filtered.length >= ACTION_LIMIT) {
    await punish(guild, userId, reason);
    actionMap.delete(key);
  }
}

async function addSuspicion(guild, userId, points, reason) {
  if (!userId || isWhitelisted(userId)) return;

  const key = `${guild.id}-${userId}`;
  const data = suspiciousScoreMap.get(key) || { score: 0, reasons: [], last: Date.now() };

  if (Date.now() - data.last > 60000) {
    data.score = 0;
    data.reasons = [];
  }

  data.score += points;
  data.reasons.push(reason);
  data.last = Date.now();
  suspiciousScoreMap.set(key, data);

  if (data.score >= 70) {
    addSecurityStat("raidsBlocked");
    await punish(guild, userId, `IA Anti-Raid: ${data.reasons.join(" | ")}`);
    suspiciousScoreMap.delete(key);
  } else if (data.score >= 40) {
    await sendLog(
      guild,
      "🤖 IA Anti-Raid: comportamento suspeito",
      `Usuário: <@${userId}>\nScore: **${data.score}/70**\nMotivos:\n${data.reasons.map(r => `• ${r}`).join("\n")}`,
      "Orange"
    );
  }
}
// =====================================================
// 11. SISTEMA DE QUARENTENA
// =====================================================

async function getOrCreateQuarantineRole(guild) {
  const config = getConfig();

  let role = guild.roles.cache.find(
    r => r.name === config.quarantineRoleName
  );

  if (!role) {
    role = await guild.roles.create({
      name: config.quarantineRoleName,
      color: "DarkGrey",
      permissions: [],
      reason: "Sistema de Quarentena"
    }).catch(() => null);
  }

  return role;
}

async function quarantineMember(member, reason) {
  const role = await getOrCreateQuarantineRole(member.guild);

  if (!role) return false;

  await member.roles.set([role.id], reason).catch(() => null);

  await sendLog(
    member.guild,
    "🚧 Usuário colocado em quarentena",
    `Usuário: <@${member.id}>\nMotivo: ${reason}`,
    "Yellow"
  );

  return true;
}


// =====================================================
// 12. SISTEMA ANTI-CARGO PERIGOSO
// =====================================================

function hasDangerousPermissions(role) {
  const dangerousPermissions = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageWebhooks
  ];

  return dangerousPermissions.some(permission =>
    role.permissions.has(permission)
  );
}


// =====================================================
// 13. BACKUP COMPLETO DO SERVIDOR
// =====================================================

async function createBackup(guild) {
  const backup = {
    guildId: guild.id,
    guildName: guild.name,
    createdAt: nowBR(),

    roles: guild.roles.cache
      .filter(role => role.id !== guild.id && !role.managed)
      .map(role => ({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        position: role.position,
        rawPosition: role.rawPosition,
        permissions: role.permissions.bitfield.toString()
      })),

    channels: guild.channels.cache.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentName: channel.parent?.name || null,
      parentId: channel.parentId || null,
      position: channel.rawPosition,
      topic: channel.topic || null,
      nsfw: channel.nsfw || false,
      rateLimitPerUser: channel.rateLimitPerUser || 0,

      permissionOverwrites: channel.permissionOverwrites.cache.map(p => ({
        id: p.id,
        type: p.type,
        allow: p.allow.bitfield.toString(),
        deny: p.deny.bitfield.toString()
      }))
    }))
  };

  saveJSON(`./backups/${guild.id}.json`, backup);
  return backup;
}



async function createBackupHistory(guild) {
  const backup = await createBackup(guild);
  const safeDate = new Date().toISOString().replace(/[:.]/g, "-");
  saveJSON(`./backups/history/${guild.id}-${safeDate}.json`, backup);
  return backup;
}

function listBackupFiles(guildId) {
  if (!fs.existsSync("./backups/history")) return [];
  return fs.readdirSync("./backups/history")
    .filter(file => file.startsWith(`${guildId}-`) && file.endsWith(".json"))
    .sort()
    .reverse();
}

async function restoreBackupFile(guild, fileName) {
  const fullPath = `./backups/history/${fileName}`;
  if (!fs.existsSync(fullPath)) return false;

  const currentPath = `./backups/${guild.id}.json`;
  fs.copyFileSync(fullPath, currentPath);
  return restoreBackup(guild);
}

// =====================================================
// 14. RESTORE COMPLETO DO SERVIDOR
// =====================================================

async function restoreBackup(guild) {
  const path = `./backups/${guild.id}.json`;

  if (!fs.existsSync(path)) return false;

  const backup = readJSON(path);

  const roleMap = new Map();

  for (const roleData of backup.roles.sort((a, b) => a.position - b.position)) {
    let role = guild.roles.cache.find(r => r.name === roleData.name);

    if (!role) {
      role = await guild.roles.create({
        name: roleData.name,
        color: roleData.color,
        hoist: roleData.hoist,
        mentionable: roleData.mentionable,
        permissions: BigInt(roleData.permissions),
        reason: "Security System Restore"
      }).catch(() => null);
    }

    if (role) {
      await role.setPosition(roleData.position).catch(() => {});
      roleMap.set(roleData.id, role.id);
    }
  }

  for (const channelData of backup.channels.sort((a, b) => a.position - b.position)) {
    let channel = guild.channels.cache.find(c => c.name === channelData.name);

    if (channel) continue;

    const parent = channelData.parentName
      ? guild.channels.cache.find(c => c.name === channelData.parentName)
      : null;

    const overwrites = channelData.permissionOverwrites.map(overwrite => ({
      id: roleMap.get(overwrite.id) || overwrite.id,
      type: overwrite.type,
      allow: BigInt(overwrite.allow),
      deny: BigInt(overwrite.deny)
    }));

    channel = await guild.channels.create({
      name: channelData.name,
      type: channelData.type,
      parent: parent?.id || null,
      topic: channelData.topic || null,
      nsfw: channelData.nsfw || false,
      rateLimitPerUser: channelData.rateLimitPerUser || 0,
      permissionOverwrites: overwrites,
      reason: "Security System Restore"
    }).catch(() => null);

    if (channel) {
      await channel.setPosition(channelData.position).catch(() => {});
    }
  }

  return true;
}


// =====================================================
// 15. BACKUP INDIVIDUAL DE CARGO DELETADO
// =====================================================

async function restoreDeletedRole(role) {
  const guild = role.guild;

  const newRole = await guild.roles.create({
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield,
    reason: "Security System Role Restore"
  }).catch(() => null);

  if (!newRole) return null;

  await newRole.setPosition(role.position).catch(() => {});

  addSecurityStat("rolesRestored");

  await sendLog(
    guild,
    "♻️ Cargo restaurado",
    `Cargo: **${role.name}**\nPermissões restauradas.\nPosição restaurada.`,
    "Green"
  );

  return newRole;
}


// =====================================================
// 16. BACKUP INDIVIDUAL DE CANAL DELETADO
// =====================================================

async function restoreDeletedChannel(channel) {
  const guild = channel.guild;

  const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield
  }));

  const newChannel = await guild.channels.create({
    name: channel.name,
    type: channel.type,
    parent: channel.parentId || null,
    topic: channel.topic || null,
    nsfw: channel.nsfw || false,
    rateLimitPerUser: channel.rateLimitPerUser || 0,
    permissionOverwrites,
    reason: "Security System Channel Restore"
  }).catch(() => null);

  if (!newChannel) return null;

  await newChannel.setPosition(channel.rawPosition).catch(() => {});

  addSecurityStat("channelsRestored");

  await sendLog(
    guild,
    "♻️ Canal restaurado",
    `Canal: **${channel.name}**\nPermissões e posição restauradas.`,
    "Green"
  );

  return newChannel;
}

// =====================================================
// 17. SISTEMA DE TICKETS / TRANSCRIPTS
// =====================================================

function htmlEscape(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeSimplePDF(text, filePath) {
  const safe = String(text).replace(/[()\\]/g, "\\$&").slice(0, 12000);
  const lines = safe.match(/.{1,90}/g) || ["Transcript vazio"];
  let y = 780;
  const content = lines.map(line => {
    const out = `BT /F1 10 Tf 40 ${y} Td (${line}) Tj ET`;
    y -= 14;
    return out;
  }).join("\n");

  const pdf = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000059 00000 n \n0000000118 00000 n \n0000000278 00000 n \n0000000350 00000 n \ntrailer << /Root 1 0 R /Size 6 >>\nstartxref\n${420 + content.length}\n%%EOF`;

  fs.writeFileSync(filePath, pdf);
}

async function getOrCreateTicketCategory(guild) {
  const config = getConfig();
  let category = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && c.name === config.ticketCategoryName
  );

  if (!category) {
    category = await guild.channels.create({
      name: config.ticketCategoryName,
      type: ChannelType.GuildCategory,
      reason: "Sistema de tickets"
    }).catch(() => null);
  }

  return category;
}

async function createTicketTranscript(channel, closedById) {
  const messages = [];
  let lastId;

  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!fetched || fetched.size === 0) break;
    messages.push(...fetched.values());
    lastId = fetched.last().id;
    if (messages.length >= 1000) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const baseName = `transcript-${channel.id}-${Date.now()}`;
  const txtPath = `./transcripts/${baseName}.txt`;
  const htmlPath = `./transcripts/${baseName}.html`;
  const pdfPath = `./transcripts/${baseName}.pdf`;

  const txt = messages.map(m => {
    const date = new Date(m.createdTimestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const content = m.content || "[sem texto]";
    return `[${date}] ${m.author.tag}: ${content}`;
  }).join("\n");

  fs.writeFileSync(txtPath, txt || "Transcript vazio.");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transcript</title><style>body{font-family:Arial;background:#0b0d12;color:#eee}.msg{padding:10px;border-bottom:1px solid #222}.author{color:#4da3ff;font-weight:bold}.date{color:#999;font-size:12px}</style></head><body><h1>Transcript - ${htmlEscape(channel.name)}</h1><p>Fechado por: ${closedById}</p>${messages.map(m => `<div class="msg"><div class="author">${htmlEscape(m.author.tag)}</div><div class="date">${new Date(m.createdTimestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div><div>${htmlEscape(m.content || "[sem texto]")}</div></div>`).join("")}</body></html>`;
  fs.writeFileSync(htmlPath, html);

  makeSimplePDF(txt || "Transcript vazio.", pdfPath);

  return [txtPath, htmlPath, pdfPath];
}

// =====================================================
// 17. CRIADOR DE COMANDOS ON/OFF
// =====================================================

function toggleCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName("modo")
        .setDescription("Ativar ou desativar")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" }
        )
    );
}

const toggleNames = [
  "antiraid",
  "antinuke",
  "antispam",
  "antiinvite",
  "antilink",
  "antibot",
  "antiwebhook",
  "antieveryone",
  "antichannelcreate",
  "antichanneldelete",
  "antirolecreate",
  "antiroledelete",
  "antiban",
  "antikick",
  "antialt",
  "antijoinraid",
  "antidangerousrole",
  "botlock",
  "webhooklock"
];


// =====================================================
// 18. LISTA DE COMANDOS
// =====================================================

const commands = [

  // =====================
  // IMUNIDADE
  // =====================

  new SlashCommandBuilder()
    .setName("addcargoimune")
    .setDescription("Adiciona um cargo imune")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName("cargo").setDescription("Cargo").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remcargoimune")
    .setDescription("Remove um cargo imune")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName("cargo").setDescription("Cargo").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listacargoimune")
    .setDescription("Lista cargos imunes")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("addpessoaimune")
    .setDescription("Adiciona uma pessoa imune")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rempessoaimune")
    .setDescription("Remove uma pessoa imune")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listapessoaimune")
    .setDescription("Lista pessoas imunes")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),


  // =====================
  // CONFIGURAÇÕES
  // =====================

  new SlashCommandBuilder()
    .setName("security-status")
    .setDescription("Mostra o status da segurança")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("Define o canal de logs")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName("canal").setDescription("Canal de logs").setRequired(true)
    ),


  // =====================
  // SISTEMAS ON/OFF
  // =====================

  toggleCommand("antiraid", "Ativa ou desativa o Anti-Raid"),
  toggleCommand("antinuke", "Ativa ou desativa o Anti-Nuke"),
  toggleCommand("antispam", "Ativa ou desativa o Anti-Spam"),
  toggleCommand("antiinvite", "Ativa ou desativa o Anti-Invite"),
  toggleCommand("antilink", "Ativa ou desativa o Anti-Link"),
  toggleCommand("antibot", "Ativa ou desativa o Anti-Bot"),
  toggleCommand("antiwebhook", "Ativa ou desativa o Anti-Webhook"),
  toggleCommand("antieveryone", "Ativa ou desativa o Anti-Everyone"),
  toggleCommand("antichannelcreate", "Proteção contra criação de canais"),
  toggleCommand("antichanneldelete", "Proteção contra exclusão de canais"),
  toggleCommand("antirolecreate", "Proteção contra criação de cargos"),
  toggleCommand("antiroledelete", "Proteção contra exclusão de cargos"),
  toggleCommand("antiban", "Proteção contra banimentos em massa"),
  toggleCommand("antikick", "Proteção contra expulsões em massa"),
  toggleCommand("antialt", "Ativa ou desativa o Anti-Alt"),
  toggleCommand("antijoinraid", "Ativa ou desativa o Anti-Join Raid"),
  toggleCommand("antidangerousrole", "Ativa ou desativa o Anti-Cargo Perigoso"),
  toggleCommand("botlock", "Bloqueia entrada de bots"),
  toggleCommand("webhooklock", "Bloqueia criação de webhooks"),


  // =====================
  // BOTS PERMITIDOS
  // =====================

  new SlashCommandBuilder()
    .setName("allowbot")
    .setDescription("Permite um bot específico entrar no servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName("bot").setDescription("Bot permitido").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removebot")
    .setDescription("Remove um bot da lista permitida")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName("bot").setDescription("Bot").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("listbots")
    .setDescription("Lista bots permitidos")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),



  // =====================
  // PREMIUM / SEGURANÇA DO DONO
  // =====================

  new SlashCommandBuilder()
    .setName("panic")
    .setDescription("Ativa o modo pânico")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("unpanic")
    .setDescription("Desativa o modo pânico")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("ultrasecurity")
    .setDescription("Ativa todas as proteções do bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("securitystats")
    .setDescription("Mostra estatísticas de segurança")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("backupnow")
    .setDescription("Cria backup manual com histórico")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("listbackups")
    .setDescription("Lista backups salvos no histórico")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("restorebackup")
    .setDescription("Restaura um backup do histórico")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("arquivo").setDescription("Nome do arquivo do /listbackups").setRequired(true)
    ),

  // =====================
  // TICKETS
  // =====================

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Envia o painel de abertura de tickets")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription("Mostra estatísticas dos tickets")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // =====================
  // BACKUP
  // =====================

  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Cria backup completo do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("Restaura backup completo do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),


  // =====================
  // RAID BANS
  // =====================

  new SlashCommandBuilder()
    .setName("unbanallraid")
    .setDescription("Desbane usuários banidos pelo anti-raid")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      // =====================
  // WHITELIST
  // =====================

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Gerencia whitelist")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Adicionar usuário na whitelist")
        .addUserOption(option =>
          option.setName("usuario").setDescription("Usuário").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remover usuário da whitelist")
        .addUserOption(option =>
          option.setName("usuario").setDescription("Usuário").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list").setDescription("Listar whitelist")
    ),


  // =====================
  // MODERAÇÃO
  // =====================

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bane um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("motivo").setDescription("Motivo").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("motivo").setDescription("Motivo").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Coloca usuário em timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("minutos").setDescription("Minutos").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("motivo").setDescription("Motivo").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove timeout de um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avisa um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("motivo").setDescription("Motivo").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Mostra avisos de um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    ),


  // =====================
  // UTILIDADES
  // =====================

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Limpa mensagens")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option.setName("quantidade").setDescription("Quantidade").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Bloqueia o canal atual")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Desbloqueia o canal atual")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Define slowmode no canal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(option =>
      option.setName("segundos").setDescription("Segundos").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Mostra informações do servidor"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Mostra informações de um usuário")
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Mostra o ping do bot"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Faz o bot enviar uma mensagem")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("mensagem").setDescription("Mensagem").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Envia anúncio no canal atual")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("mensagem").setDescription("Mensagem").setRequired(true)
    ),
      // =====================
  // LOCKDOWN / EMERGÊNCIA
  // =====================

  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Bloqueia todos os canais de texto")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("unlockdown")
    .setDescription("Desbloqueia todos os canais de texto")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("emergency")
    .setDescription("Ativa modo emergência")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("unemergency")
    .setDescription("Desativa modo emergência")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Mostra casos registrados")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),


  // =====================
  // CARGOS
  // =====================

  new SlashCommandBuilder()
    .setName("addcargo")
    .setDescription("Adiciona um cargo a um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addRoleOption(option =>
      option.setName("cargo").setDescription("Cargo").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removercargo")
    .setDescription("Remove um cargo de um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(option =>
      option.setName("usuario").setDescription("Usuário").setRequired(true)
    )
    .addRoleOption(option =>
      option.setName("cargo").setDescription("Cargo").setRequired(true)
    )

].map(command => command.toJSON());


// =====================================================
// 19. REGISTRAR COMANDOS
// =====================================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log(`✅ ${commands.length} comandos registrados.`);
}
// =====================================================
// 20. INTERACTION CREATE
// =====================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;
  const guild = interaction.guild;

  try {

    // ===================================
    // COMANDOS ON/OFF
    // ===================================

    if (toggleNames.includes(cmd)) {
      const modo = interaction.options.getString("modo");
      const config = getConfig();

      config[cmd] = modo === "on";
      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: `✅ ${cmd} ${modo === "on" ? "ativado" : "desativado"}`
      });
    }


    // ===================================
    // SETLOG
    // ===================================

    if (cmd === "setlog") {
      const canal = interaction.options.getChannel("canal");

      const config = getConfig();
      config.logChannel = canal.id;

      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: `✅ Canal de logs definido para ${canal}`
      });
    }


    // ===================================
    // CARGOS IMUNES
    // ===================================

    if (cmd === "addcargoimune") {
      const cargo = interaction.options.getRole("cargo");

      updateArray("immuneRoles", cargo.id, true);

      return interaction.reply({
        ephemeral: true,
        content: `✅ Cargo ${cargo} adicionado aos imunes`
      });
    }

    if (cmd === "remcargoimune") {
      const cargo = interaction.options.getRole("cargo");

      updateArray("immuneRoles", cargo.id, false);

      return interaction.reply({
        ephemeral: true,
        content: `✅ Cargo ${cargo} removido dos imunes`
      });
    }

    if (cmd === "listacargoimune") {
      const cargos = getConfig().immuneRoles || [];

      return interaction.reply({
        ephemeral: true,
        content: cargos.length
          ? cargos.map(id => `<@&${id}>`).join("\n")
          : "Nenhum cargo imune."
      });
    }


    // ===================================
    // PESSOAS IMUNES
    // ===================================

    if (cmd === "addpessoaimune") {
      const user = interaction.options.getUser("usuario");

      updateArray("immuneUsers", user.id, true);

      return interaction.reply({
        ephemeral: true,
        content: `✅ ${user.tag} adicionado aos imunes`
      });
    }

    if (cmd === "rempessoaimune") {
      const user = interaction.options.getUser("usuario");

      updateArray("immuneUsers", user.id, false);

      return interaction.reply({
        ephemeral: true,
        content: `✅ ${user.tag} removido dos imunes`
      });
    }

    if (cmd === "listapessoaimune") {
      const users = getConfig().immuneUsers || [];

      return interaction.reply({
        ephemeral: true,
        content: users.length
          ? users.map(id => `<@${id}>`).join("\n")
          : "Nenhum usuário imune."
      });
    }


    // ===================================
    // BOTS PERMITIDOS
    // ===================================

    if (cmd === "allowbot") {
      const bot = interaction.options.getUser("bot");

      updateArray("allowedBots", bot.id, true);

      return interaction.reply({
        ephemeral: true,
        content: `✅ Bot ${bot.tag} autorizado`
      });
    }

    if (cmd === "removebot") {
      const bot = interaction.options.getUser("bot");

      updateArray("allowedBots", bot.id, false);

      return interaction.reply({
        ephemeral: true,
        content: `✅ Bot ${bot.tag} removido`
      });
    }

    if (cmd === "listbots") {
      const bots = getConfig().allowedBots || [];

      return interaction.reply({
        ephemeral: true,
        content: bots.length
          ? bots.map(id => `<@${id}>`).join("\n")
          : "Nenhum bot autorizado."
      });
    }


    // ===================================
    // WHITELIST
    // ===================================

    if (cmd === "whitelist") {

      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const user = interaction.options.getUser("usuario");

        updateArray("whitelist", user.id, true);

        return interaction.reply({
          ephemeral: true,
          content: `✅ ${user.tag} adicionado à whitelist`
        });
      }

      if (sub === "remove") {
        const user = interaction.options.getUser("usuario");

        updateArray("whitelist", user.id, false);

        return interaction.reply({
          ephemeral: true,
          content: `✅ ${user.tag} removido da whitelist`
        });
      }

      if (sub === "list") {
        const list = getConfig().whitelist || [];

        return interaction.reply({
          ephemeral: true,
          content: list.length
            ? list.map(id => `<@${id}>`).join("\n")
            : "Whitelist vazia."
        });
      }
    }

    // ===================================
    // PREMIUM / SEGURANÇA DO DONO
    // ===================================

    if (cmd === "panic") {
      const config = getConfig();

      config.panic = true;
      config.antichannelcreate = true;
      config.antirolecreate = true;
      config.antibot = true;
      config.antiinvite = true;
      config.antiwebhook = true;
      config.antieveryone = true;
      config.antijoinraid = true;

      saveConfig(config);

      await sendLog(guild, "🚨 MODO PÂNICO ATIVADO", `Ativado por: <@${interaction.user.id}>`, "Red");

      return interaction.reply({ ephemeral: true, content: "🚨 Modo pânico ativado." });
    }

    if (cmd === "unpanic") {
      const config = getConfig();
      config.panic = false;
      saveConfig(config);

      await sendLog(guild, "✅ MODO PÂNICO DESATIVADO", `Desativado por: <@${interaction.user.id}>`, "Green");

      return interaction.reply({ ephemeral: true, content: "✅ Modo pânico desativado." });
    }

    if (cmd === "ultrasecurity") {
      const config = getConfig();

      Object.keys(config).forEach(key => {
        if (typeof config[key] === "boolean") config[key] = true;
      });

      config.ultrasecurity = true;
      config.emergency = true;
      config.panic = true;
      config.autoBackup = true;

      saveConfig(config);

      await sendLog(guild, "🛡️ ULTRA SECURITY ATIVADO", `Ativado por: <@${interaction.user.id}>`, "Green");

      return interaction.reply({ ephemeral: true, content: "🛡️ Ultra Security ativado. Todas as proteções foram ligadas." });
    }

    if (cmd === "securitystats") {
      const stats = getSecurityStats();

      return interaction.reply({
        ephemeral: true,
        content:
          `🛡️ **Estatísticas de Segurança**\n\n` +
          `🚨 Raids bloqueadas: ${stats.raidsBlocked || 0}\n` +
          `🔨 Usuários punidos: ${stats.usersPunished || 0}\n` +
          `♻️ Canais restaurados: ${stats.channelsRestored || 0}\n` +
          `♻️ Cargos restaurados: ${stats.rolesRestored || 0}\n` +
          `🤖 Bots bloqueados: ${stats.botsBlocked || 0}`
      });
    }

    if (cmd === "backupnow") {
      await createBackupHistory(guild);
      await sendLog(guild, "📦 Backup manual criado", `Criado por: <@${interaction.user.id}>`, "Green");
      return interaction.reply({ ephemeral: true, content: "✅ Backup criado e salvo no histórico." });
    }

    if (cmd === "listbackups") {
      const files = listBackupFiles(guild.id).slice(0, 10);
      return interaction.reply({
        ephemeral: true,
        content: files.length ? `📦 **Últimos backups:**\n\n${files.map(f => `\`${f}\``).join("\n")}` : "❌ Nenhum backup no histórico."
      });
    }

    if (cmd === "restorebackup") {
      const fileName = interaction.options.getString("arquivo");
      const ok = await restoreBackupFile(guild, fileName);
      return interaction.reply({ ephemeral: true, content: ok ? "✅ Backup restaurado." : "❌ Backup não encontrado." });
    }

    if (cmd === "ticketpanel") {
      const embed = new EmbedBuilder()
        .setColor("Blue")
        .setTitle("🎫 Central de Atendimento")
        .setDescription("Clique no botão abaixo para abrir um ticket.")
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_open")
          .setLabel("Abrir Ticket")
          .setEmoji("🎫")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ ephemeral: true, content: "✅ Painel de ticket enviado." });
    }

    if (cmd === "ticketstats") {
      const stats = getTicketStats();
      const ratings = stats.ratings || [];
      const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : "Sem avaliações";

      return interaction.reply({
        ephemeral: true,
        content:
          `🎫 **Estatísticas de Tickets**\n\n` +
          `Criados: ${stats.created || 0}\n` +
          `Fechados: ${stats.closed || 0}\n` +
          `Assumidos: ${stats.assumed || 0}\n` +
          `Avaliação média: ${avg}`
      });
    }

        // ===================================
    // BACKUP / RESTORE
    // ===================================

    if (cmd === "backup") {
      await createBackup(guild);

      await sendLog(
        guild,
        "📦 Backup criado",
        `Criado por: <@${interaction.user.id}>`,
        "Green"
      );

      return interaction.reply({
        ephemeral: true,
        content: "✅ Backup completo criado."
      });
    }

    if (cmd === "restore") {
      const ok = await restoreBackup(guild);

      return interaction.reply({
        ephemeral: true,
        content: ok
          ? "✅ Restore completo iniciado."
          : "❌ Nenhum backup encontrado."
      });
    }


    // ===================================
    // UNBAN ALL RAID
    // ===================================

    if (cmd === "unbanallraid") {
      const raidBans = readJSON(RAID_BANS_PATH).filter(
        ban => ban.guildId === guild.id
      );

      let success = 0;
      let fail = 0;

      for (const ban of raidBans) {
        try {
          await guild.members.unban(ban.userId, "Unban geral de raid");
          success++;
        } catch {
          fail++;
        }
      }

      saveJSON(
        RAID_BANS_PATH,
        readJSON(RAID_BANS_PATH).filter(ban => ban.guildId !== guild.id)
      );

      return interaction.reply({
        ephemeral: true,
        content: `✅ Unban de raid finalizado.\nSucesso: ${success}\nFalhas: ${fail}`
      });
    }


    // ===================================
    // STATUS
    // ===================================

    if (cmd === "security-status") {
      const config = getConfig();

      return interaction.reply({
        ephemeral: true,
        content:
          `🛡️ **Security System Status**\n\n` +
          `Anti-Raid: ${config.antiraid ? "✅" : "❌"}\n` +
          `Anti-Nuke: ${config.antinuke ? "✅" : "❌"}\n` +
          `Anti-Spam: ${config.antispam ? "✅" : "❌"}\n` +
          `Anti-Invite: ${config.antiinvite ? "✅" : "❌"}\n` +
          `Anti-Link: ${config.antilink ? "✅" : "❌"}\n` +
          `Anti-Bot: ${config.antibot ? "✅" : "❌"}\n` +
          `Anti-Webhook: ${config.antiwebhook ? "✅" : "❌"}\n` +
          `Anti-Everyone: ${config.antieveryone ? "✅" : "❌"}\n` +
          `Anti-Alt: ${config.antialt ? "✅" : "❌"}\n` +
          `Anti-Join Raid: ${config.antijoinraid ? "✅" : "❌"}\n` +
          `Anti-Cargo Perigoso: ${config.antidangerousrole ? "✅" : "❌"}\n\n` +
          `Whitelist: ${config.whitelist.length}\n` +
          `Cargos imunes: ${config.immuneRoles.length}\n` +
          `Pessoas imunes: ${config.immuneUsers.length}\n` +
          `Bots permitidos: ${config.allowedBots.length}`
      });
    }


    // ===================================
    // BAN
    // ===================================

    if (cmd === "ban") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("motivo") || "Sem motivo";

      await guild.members.ban(user.id, { reason }).catch(() => {});
      addCase("BAN", interaction.user.id, user.id, reason);

      await sendLog(
        guild,
        "🔨 Usuário banido",
        `Moderador: <@${interaction.user.id}>\nUsuário: <@${user.id}>\nMotivo: ${reason}`,
        "Red"
      );

      return interaction.reply({
        ephemeral: true,
        content: `🔨 <@${user.id}> foi banido.\nMotivo: ${reason}`
      });
    }


    // ===================================
    // KICK
    // ===================================

    if (cmd === "kick") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("motivo") || "Sem motivo";
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Usuário não encontrado."
        });
      }

      await member.kick(reason).catch(() => {});
      addCase("KICK", interaction.user.id, user.id, reason);

      await sendLog(
        guild,
        "👢 Usuário expulso",
        `Moderador: <@${interaction.user.id}>\nUsuário: <@${user.id}>\nMotivo: ${reason}`,
        "Orange"
      );

      return interaction.reply({
        ephemeral: true,
        content: `👢 <@${user.id}> foi expulso.\nMotivo: ${reason}`
      });
    }


    // ===================================
    // TIMEOUT
    // ===================================

    if (cmd === "timeout") {
      const user = interaction.options.getUser("usuario");
      const minutes = interaction.options.getInteger("minutos");
      const reason = interaction.options.getString("motivo") || "Sem motivo";
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Usuário não encontrado."
        });
      }

      await member.timeout(minutes * 60 * 1000, reason).catch(() => {});
      addCase("TIMEOUT", interaction.user.id, user.id, reason);

      return interaction.reply({
        ephemeral: true,
        content: `⏳ <@${user.id}> recebeu timeout por ${minutes} minuto(s).\nMotivo: ${reason}`
      });
    }


    // ===================================
    // UNTIMEOUT
    // ===================================

    if (cmd === "untimeout") {
      const user = interaction.options.getUser("usuario");
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Usuário não encontrado."
        });
      }

      await member.timeout(null).catch(() => {});

      return interaction.reply({
        ephemeral: true,
        content: `✅ Timeout removido de <@${user.id}>.`
      });
    }


    // ===================================
    // WARN / WARNINGS
    // ===================================

    if (cmd === "warn") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("motivo");

      const warns = readJSON(WARNS_PATH);
      if (!warns[user.id]) warns[user.id] = [];

      warns[user.id].push({
        moderatorId: interaction.user.id,
        reason,
        date: nowBR()
      });

      saveJSON(WARNS_PATH, warns);
      addCase("WARN", interaction.user.id, user.id, reason);

      return interaction.reply({
        ephemeral: true,
        content: `⚠️ <@${user.id}> recebeu um aviso.\nMotivo: ${reason}`
      });
    }

    if (cmd === "warnings") {
      const user = interaction.options.getUser("usuario");
      const warns = readJSON(WARNS_PATH);
      const userWarns = warns[user.id] || [];

      return interaction.reply({
        ephemeral: true,
        content: userWarns.length
          ? `⚠️ Avisos de <@${user.id}>:\n\n${userWarns
              .map((w, index) => `**${index + 1}.** ${w.reason} — ${w.date}`)
              .join("\n")}`
          : "✅ Esse usuário não possui avisos."
      });
    }


    // ===================================
    // ADDCARGO / REMOVERCARGO
    // ===================================

    if (cmd === "addcargo" || cmd === "removercargo") {
      const user = interaction.options.getUser("usuario");
      const cargo = interaction.options.getRole("cargo");
      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Usuário não encontrado."
        });
      }

      if (cmd === "addcargo") {
        await member.roles.add(cargo).catch(() => {});
      } else {
        await member.roles.remove(cargo).catch(() => {});
      }

      return interaction.reply({
        ephemeral: true,
        content: `✅ Cargo ${cargo} ${cmd === "addcargo" ? "adicionado em" : "removido de"} <@${user.id}>.`
      });
    }
        // ===================================
    // CLEAR
    // ===================================

    if (cmd === "clear") {
      const amount = interaction.options.getInteger("quantidade");

      if (amount < 1 || amount > 100) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Use um número entre 1 e 100."
        });
      }

      await interaction.channel.bulkDelete(amount, true).catch(() => {});

      return interaction.reply({
        ephemeral: true,
        content: `🧹 ${amount} mensagens foram apagadas.`
      });
    }


    // ===================================
    // LOCK / UNLOCK
    // ===================================

    if (cmd === "lock" || cmd === "unlock") {
      await interaction.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: cmd === "unlock" }
      );

      return interaction.reply({
        content: cmd === "lock" ? "🔒 Canal bloqueado." : "🔓 Canal desbloqueado."
      });
    }


    // ===================================
    // SLOWMODE
    // ===================================

    if (cmd === "slowmode") {
      const seconds = interaction.options.getInteger("segundos");

      await interaction.channel.setRateLimitPerUser(seconds).catch(() => {});

      return interaction.reply({
        ephemeral: true,
        content: `⏱️ Slowmode definido para ${seconds} segundo(s).`
      });
    }


    // ===================================
    // SERVERINFO
    // ===================================

    if (cmd === "serverinfo") {
      return interaction.reply({
        ephemeral: true,
        content:
          `🏰 **Servidor:** ${guild.name}\n` +
          `👥 Membros: ${guild.memberCount}\n` +
          `📁 Canais: ${guild.channels.cache.size}\n` +
          `🎭 Cargos: ${guild.roles.cache.size}`
      });
    }


    // ===================================
    // USERINFO
    // ===================================

    if (cmd === "userinfo") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      const member = await guild.members.fetch(user.id).catch(() => null);

      return interaction.reply({
        ephemeral: true,
        content:
          `👤 **Usuário:** ${user.tag}\n` +
          `🆔 ID: ${user.id}\n` +
          `📅 Conta criada: <t:${Math.floor(user.createdTimestamp / 1000)}:F>\n` +
          `🎭 Maior cargo: ${member?.roles.highest || "Nenhum"}`
      });
    }


    // ===================================
    // PING
    // ===================================

    if (cmd === "ping") {
      return interaction.reply({
        ephemeral: true,
        content: `🏓 Pong! Ping: ${client.ws.ping}ms`
      });
    }


    // ===================================
    // SAY
    // ===================================

    if (cmd === "say") {
      const msg = interaction.options.getString("mensagem");

      await interaction.channel.send(msg);

      return interaction.reply({
        ephemeral: true,
        content: "✅ Mensagem enviada."
      });
    }


    // ===================================
    // ANNOUNCE
    // ===================================

    if (cmd === "announce") {
      const msg = interaction.options.getString("mensagem");

      const embed = new EmbedBuilder()
        .setColor("Blue")
        .setTitle("📢 Anúncio")
        .setDescription(msg)
        .setTimestamp();

      await interaction.channel.send({ embeds: [embed] });

      return interaction.reply({
        ephemeral: true,
        content: "✅ Anúncio enviado."
      });
    }


    // ===================================
    // LOCKDOWN / UNLOCKDOWN
    // ===================================

    if (cmd === "lockdown" || cmd === "unlockdown") {
      await interaction.deferReply({ ephemeral: true });

      const lock = cmd === "lockdown";
      let success = 0;
      let fail = 0;

      const channels = guild.channels.cache.filter(
        channel => channel.type === ChannelType.GuildText
      );

      for (const channel of channels.values()) {
        try {
          await channel.permissionOverwrites.edit(
            guild.roles.everyone,
            { SendMessages: lock ? false : null },
            { reason: lock ? "Lockdown ativado" : "Lockdown removido" }
          );
          success++;
        } catch {
          fail++;
        }
      }

      return interaction.editReply({
        content:
          `${lock ? "🔒 Lockdown ativado." : "🔓 Lockdown removido."}\n` +
          `✅ Sucesso: ${success}\n` +
          `❌ Falhas: ${fail}`
      });
    }


    // ===================================
    // EMERGENCY / UNEMERGENCY
    // ===================================

    if (cmd === "emergency" || cmd === "unemergency") {
      const config = getConfig();

      if (cmd === "emergency") {
        config.emergency = true;
        config.antiraid = true;
        config.antinuke = true;
        config.antispam = true;
        config.antibot = true;
        config.antiwebhook = true;
        config.antieveryone = true;
        config.antijoinraid = true;
        config.antidangerousrole = true;
      } else {
        config.emergency = false;
      }

      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: cmd === "emergency"
          ? "🚨 Modo emergência ativado. Proteções principais ligadas."
          : "✅ Modo emergência desativado."
      });
    }


    // ===================================
    // CASES
    // ===================================

    if (cmd === "cases") {
      const cases = readJSON(CASES_PATH);

      return interaction.reply({
        ephemeral: true,
        content: cases.length
          ? cases
              .slice(-10)
              .map(c => `#${c.id} **${c.type}** | Usuário: <@${c.userId}> | Motivo: ${c.reason}`)
              .join("\n")
          : "Nenhum caso registrado."
      });
    }

  } catch (error) {
    console.error(error);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        ephemeral: true,
        content: "❌ Ocorreu um erro ao executar esse comando."
      });
    }
  }
});
// =====================================================
// 21. EVENTO: CANAL DELETADO
// =====================================================

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  const config = getConfig();
  if (!config.antinuke && !config.antichanneldelete) return;

  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete);

  if (!executor) return;
  if (executor.id === client.user.id) return;

  if (!(await canPunish(channel.guild, executor.id))) {
    return sendLog(
      channel.guild,
      "⚠️ Ação ignorada",
      `Usuário: <@${executor.id}>\nMotivo: usuário/cargo imune.\nAção: deletou canal, mas não será punido nem restaurado.`,
      "Yellow"
    );
  }

  await sendLog(
    channel.guild,
    "🗑️ Canal deletado",
    `Executor: <@${executor.id}>\nCanal: **${channel.name}**`,
    "Red"
  );

  await registerDangerAction(
    channel.guild,
    executor.id,
    "Exclusão de canais/categorias"
  );

  await restoreDeletedChannel(channel);
});


// =====================================================
// 22. EVENTO: CANAL CRIADO
// =====================================================

client.on("channelCreate", async channel => {
  if (!channel.guild) return;

  const config = getConfig();
  if (!config.antinuke && !config.antichannelcreate) return;

  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelCreate);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await sendLog(
    channel.guild,
    "📁 Canal criado suspeito",
    `Executor: <@${executor.id}>\nCanal: **${channel.name}**`,
    "Orange"
  );

  await registerDangerAction(
    channel.guild,
    executor.id,
    "Criação massiva de canais"
  );

  await addSuspicion(channel.guild, executor.id, 25, "Criação rápida/suspeita de canal");
});


// =====================================================
// 23. EVENTO: CARGO DELETADO
// =====================================================

client.on("roleDelete", async role => {
  const config = getConfig();
  if (!config.antinuke && !config.antiroledelete) return;

  const executor = await getExecutor(role.guild, AuditLogEvent.RoleDelete);

  if (!executor) return;
  if (executor.id === client.user.id) return;

  if (!(await canPunish(role.guild, executor.id))) {
    return sendLog(
      role.guild,
      "⚠️ Ação ignorada",
      `Usuário: <@${executor.id}>\nMotivo: usuário/cargo imune.\nAção: deletou cargo, mas não será punido nem restaurado.`,
      "Yellow"
    );
  }

  await sendLog(
    role.guild,
    "🗑️ Cargo deletado",
    `Executor: <@${executor.id}>\nCargo: **${role.name}**`,
    "Red"
  );

  await registerDangerAction(
    role.guild,
    executor.id,
    "Exclusão de cargos"
  );

  await restoreDeletedRole(role);
});


// =====================================================
// 24. EVENTO: CARGO CRIADO
// =====================================================

client.on("roleCreate", async role => {
  const config = getConfig();
  if (!config.antinuke && !config.antirolecreate) return;

  const executor = await getExecutor(role.guild, AuditLogEvent.RoleCreate);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await sendLog(
    role.guild,
    "🎭 Cargo criado suspeito",
    `Executor: <@${executor.id}>\nCargo: **${role.name}**`,
    "Orange"
  );

  await registerDangerAction(
    role.guild,
    executor.id,
    "Criação massiva de cargos"
  );

  await addSuspicion(role.guild, executor.id, 25, "Criação rápida/suspeita de cargo");
});
// =====================================================
// 25. EVENTO: BANIMENTO
// =====================================================

client.on("guildBanAdd", async ban => {
  const config = getConfig();

  if (!config.antiraid && !config.antiban) return;

  const executor = await getExecutor(ban.guild, AuditLogEvent.MemberBanAdd);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await sendLog(
    ban.guild,
    "🔨 Membro banido",
    `Executor: <@${executor.id}>\nMembro banido: <@${ban.user.id}>`,
    "Red"
  );

  await registerDangerAction(
    ban.guild,
    executor.id,
    "Banimentos em massa"
  );
});


// =====================================================
// 26. EVENTO: KICK
// =====================================================

client.on("guildMemberRemove", async member => {
  const config = getConfig();

  if (!config.antikick) return;

  const executor = await getExecutor(member.guild, AuditLogEvent.MemberKick);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await sendLog(
    member.guild,
    "👢 Membro expulso",
    `Executor: <@${executor.id}>\nMembro expulso: <@${member.id}>`,
    "Orange"
  );

  await registerDangerAction(
    member.guild,
    executor.id,
    "Expulsões em massa"
  );
});


// =====================================================
// 27. EVENTO: WEBHOOK
// =====================================================

client.on("webhookUpdate", async channel => {
  if (!channel.guild) return;

  const config = getConfig();

  if (!config.antiwebhook && !config.webhooklock) return;

  const executor =
    await getExecutor(channel.guild, AuditLogEvent.WebhookCreate) ||
    await getExecutor(channel.guild, AuditLogEvent.WebhookUpdate);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await sendLog(
    channel.guild,
    "🪝 Webhook suspeito",
    `Executor: <@${executor.id}>\nCanal: <#${channel.id}>`,
    "Orange"
  );

  await registerDangerAction(
    channel.guild,
    executor.id,
    "Criação/edição suspeita de webhook"
  );

  if (config.webhooklock) {
    const webhooks = await channel.fetchWebhooks().catch(() => null);

    if (webhooks) {
      for (const webhook of webhooks.values()) {
        await webhook.delete("Security System Webhook Lock").catch(() => {});
      }
    }
  }
});


// =====================================================
// 28. EVENTO: BOT / ANTI-ALT / ANTI-JOIN RAID
// =====================================================

client.on("guildMemberAdd", async member => {
  const config = getConfig();

  // ANTI-JOIN RAID
  if (config.antijoinraid) {
    const key = member.guild.id;
    const old = joinMap.get(key) || [];
    const filtered = old.filter(time => Date.now() - time < config.joinRaidTime);

    filtered.push(Date.now());
    joinMap.set(key, filtered);

    if (filtered.length >= config.joinRaidLimit) {
      config.emergency = true;
      config.antiraid = true;
      config.antinuke = true;
      config.antispam = true;
      config.antibot = true;
      config.antieveryone = true;
      saveConfig(config);

      await sendLog(
        member.guild,
        "🚨 Anti-Join Raid ativado",
        `Entraram **${filtered.length} membros** em pouco tempo.\nModo emergência ativado automaticamente.`,
        "Red"
      );
    }
  }

  // ANTI-BOT
  if (member.user.bot && (config.antibot || config.botlock)) {
    const executor = await getExecutor(member.guild, AuditLogEvent.BotAdd);

    if (!executor) return;
    if (isWhitelisted(executor.id)) return;

    if (!config.allowedBots.includes(member.id)) {
      await member.ban({
        reason: "Security System Anti-Bot"
      }).catch(() => {});

      addSecurityStat("botsBlocked");

      await sendLog(
        member.guild,
        "🤖 Bot bloqueado",
        `Bot: <@${member.id}>\nAdicionado por: <@${executor.id}>`,
        "Red"
      );

      await registerDangerAction(
        member.guild,
        executor.id,
        "Adição suspeita de bots"
      );

      await addSuspicion(member.guild, executor.id, 30, "Adição suspeita de bot");

      return;
    }
  }

  // ANTI-ALT
  if (!member.user.bot && config.antialt) {
    const accountAge = Date.now() - member.user.createdTimestamp;
    const minAge = config.altMinDays * 24 * 60 * 60 * 1000;

    if (accountAge < minAge) {
      await quarantineMember(
        member,
        `Conta criada há menos de ${config.altMinDays} dias`
      );

      await sendLog(
        member.guild,
        "🧊 Anti-Alt detectado",
        `Usuário: <@${member.id}>\nConta muito nova.\nIdade mínima: ${config.altMinDays} dias.`,
        "Yellow"
      );
    }
  }
});
// =====================================================
// 29. EVENTO: MENSAGENS
// =====================================================

client.on("messageCreate", async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const config = getConfig();

  if (isWhitelisted(message.author.id)) return;

  // ANTI EVERYONE / HERE
  if (
    config.antieveryone &&
    (
      message.content.includes("@everyone") ||
      message.content.includes("@here")
    )
  ) {
    await message.delete().catch(() => {});

    await sendLog(
      message.guild,
      "📢 Menção em massa bloqueada",
      `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
      "Orange"
    );

    await registerDangerAction(
      message.guild,
      message.author.id,
      "Uso de @everyone/@here"
    );

    return;
  }

  // ANTI INVITE
  if (
    config.antiinvite &&
    /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)/i.test(message.content)
  ) {
    await message.delete().catch(() => {});

    await sendLog(
      message.guild,
      "🔗 Convite bloqueado",
      `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
      "Yellow"
    );

    return;
  }

  // ANTI LINK
  if (
    config.antilink &&
    /(https?:\/\/|www\.)/i.test(message.content)
  ) {
    await message.delete().catch(() => {});

    await sendLog(
      message.guild,
      "🌐 Link bloqueado",
      `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
      "Yellow"
    );

    return;
  }

  // ANTI SPAM
  if (config.antispam) {
    const key = `${message.guild.id}-${message.author.id}`;
    const old = spamMap.get(key) || [];
    const filtered = old.filter(time => Date.now() - time < 7000);

    filtered.push(Date.now());
    spamMap.set(key, filtered);

    const massMention =
      message.mentions.users.size >= 5 ||
      message.mentions.roles.size >= 3;

    if (filtered.length >= 8 || massMention) {
      await message.delete().catch(() => {});

      await sendLog(
        message.guild,
        "💬 Spam detectado",
        `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
        "Red"
      );

      await punish(
        message.guild,
        message.author.id,
        "Spam ou menções em massa"
      );

      spamMap.delete(key);
    }
  }
});


// =====================================================
// 30. EVENTO: CARGO ATUALIZADO / PERMISSÃO PERIGOSA
// =====================================================

client.on("roleUpdate", async (oldRole, newRole) => {
  const config = getConfig();

  if (!config.antidangerousrole) return;
  if (!hasDangerousPermissions(newRole)) return;
  if (hasDangerousPermissions(oldRole)) return;

  const executor = await getExecutor(newRole.guild, AuditLogEvent.RoleUpdate);

  if (!executor) return;
  if (executor.id === client.user.id) return;
  if (isWhitelisted(executor.id)) return;

  await newRole.setPermissions(oldRole.permissions.bitfield).catch(() => {});

  await sendLog(
    newRole.guild,
    "⚠️ Permissão perigosa bloqueada",
    `Executor: <@${executor.id}>\nCargo: **${newRole.name}**\nPermissões perigosas foram removidas.`,
    "Red"
  );

  await registerDangerAction(
    newRole.guild,
    executor.id,
    "Tentativa de adicionar permissão perigosa em cargo"
  );
});



// =====================================================
// 31. TICKETS / BOTÕES
// =====================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.guild) return;

  const guild = interaction.guild;
  const config = getConfig();

  if (interaction.customId === "ticket_open") {
    const category = await getOrCreateTicketCategory(guild);
    const channelName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);

    const existing = guild.channels.cache.find(c => c.name === channelName && c.parentId === category?.id);
    if (existing) {
      return interaction.reply({ ephemeral: true, content: `❌ Você já tem um ticket aberto: ${existing}` });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id || null,
      topic: `Ticket de ${interaction.user.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
      ],
      reason: "Ticket aberto"
    }).catch(() => null);

    if (!channel) {
      return interaction.reply({ ephemeral: true, content: "❌ Não consegui criar o ticket. Verifique minhas permissões." });
    }

    addTicketStat("created");

    const embed = new EmbedBuilder()
      .setColor("Blue")
      .setTitle("🎫 Ticket aberto")
      .setDescription(`Olá <@${interaction.user.id}>! Explique seu problema.\n\nUm membro da equipe irá assumir seu atendimento.`)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_claim").setLabel("Assumir").setEmoji("🙋").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
    await sendLog(guild, "🎫 Ticket criado", `Usuário: <@${interaction.user.id}>\nCanal: ${channel}`, "Green");

    return interaction.reply({ ephemeral: true, content: `✅ Ticket criado: ${channel}` });
  }

  if (interaction.customId === "ticket_claim") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ ephemeral: true, content: "❌ Apenas equipe pode assumir tickets." });
    }

    addTicketStat("assumed");
    await sendLog(guild, "🙋 Ticket assumido", `Staff: <@${interaction.user.id}>\nCanal: <#${interaction.channel.id}>`, "Blue");
    return interaction.reply({ content: `🙋 Ticket assumido por <@${interaction.user.id}>.` });
  }

  if (interaction.customId === "ticket_close") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ ephemeral: true, content: "❌ Apenas equipe pode fechar tickets." });
    }

    await interaction.reply({ ephemeral: true, content: "🔒 Fechando ticket e criando transcripts..." });

    const files = await createTicketTranscript(interaction.channel, interaction.user.id);
    const attachments = files.map(file => new AttachmentBuilder(file));

    const logChannelId = config.ticketLogChannel || config.logChannel || process.env.LOG_CHANNEL_ID;
    const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;

    if (logChannel) {
      await logChannel.send({
        content: `🎫 Ticket fechado: **${interaction.channel.name}**\nFechado por: <@${interaction.user.id}>`,
        files: attachments
      }).catch(() => {});
    }

    addTicketStat("closed");

    try {
      const ownerId = interaction.channel.topic?.replace("Ticket de ", "");
      const owner = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;
      if (owner) {
        const row = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map(n =>
            new ButtonBuilder().setCustomId(`ticket_rate_${n}`).setLabel(`${n}⭐`).setStyle(ButtonStyle.Secondary)
          )
        );
        await owner.send({ content: "Como você avalia o atendimento do ticket?", components: [row] }).catch(() => {});
      }
    } catch {}

    await interaction.channel.delete("Ticket fechado").catch(() => {});
  }

  if (interaction.customId.startsWith("ticket_rate_")) {
    const rating = Number(interaction.customId.split("_").pop());
    const stats = getTicketStats();
    if (!stats.ratings) stats.ratings = [];
    stats.ratings.push(rating);
    saveJSON(TICKET_STATS_PATH, stats);
    return interaction.reply({ ephemeral: true, content: `✅ Obrigado pela avaliação: ${rating}⭐` });
  }
});


// =====================================================
// 32. LOGS PREMIUM / PROTEÇÕES EXTRAS
// =====================================================

client.on("messageDelete", async message => {
  if (!message.guild) return;
  const config = getConfig();
  if (!config.logsPremium || !config.logMessageDelete) return;

  await sendLog(
    message.guild,
    "🗑️ Mensagem apagada",
    `Autor: ${message.author ? `<@${message.author.id}>` : "Desconhecido"}\nCanal: <#${message.channel.id}>\n\nConteúdo:\n${message.content || "Sem conteúdo salvo."}`,
    "Orange"
  );
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (oldMessage.content === newMessage.content) return;
  const config = getConfig();
  if (!config.logsPremium || !config.logMessageEdit) return;

  await sendLog(
    newMessage.guild,
    "✏️ Mensagem editada",
    `Usuário: <@${newMessage.author.id}>\nCanal: <#${newMessage.channel.id}>\n\nAntes:\n${oldMessage.content || "Vazio"}\n\nDepois:\n${newMessage.content || "Vazio"}`,
    "Blue"
  );
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const config = getConfig();
  if (!config.logsPremium) return;

  if (config.logNickname && oldMember.nickname !== newMember.nickname) {
    await sendLog(newMember.guild, "📝 Nickname alterado", `Usuário: <@${newMember.id}>\nAntes: ${oldMember.nickname || oldMember.user.username}\nDepois: ${newMember.nickname || newMember.user.username}`, "Blue");
  }

  if (config.logRoles) {
    const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

    if (added.size) await sendLog(newMember.guild, "➕ Cargo adicionado", `Usuário: <@${newMember.id}>\nCargo: ${added.map(r => `<@&${r.id}>`).join(", ")}`, "Green");
    if (removed.size) await sendLog(newMember.guild, "➖ Cargo removido", `Usuário: <@${newMember.id}>\nCargo: ${removed.map(r => `<@&${r.id}>`).join(", ")}`, "Orange");
  }
});

client.on("guildMemberAdd", async member => {
  const config = getConfig();
  if (!config.logsPremium || !config.logJoinLeave) return;
  await sendLog(member.guild, "📥 Membro entrou", `Usuário: <@${member.id}>`, "Green");
});

client.on("guildMemberRemove", async member => {
  const config = getConfig();
  if (!config.logsPremium || !config.logJoinLeave) return;
  await sendLog(member.guild, "📤 Membro saiu", `Usuário: <@${member.id}>`, "Orange");
});

client.on("emojiCreate", async emoji => {
  const config = getConfig();
  if (!config.logsPremium || !config.logEmoji) return;
  await sendLog(emoji.guild, "😀 Emoji criado", `Emoji: ${emoji.name}`, "Green");
});

client.on("emojiDelete", async emoji => {
  const config = getConfig();
  if (!config.logsPremium || !config.logEmoji) return;
  await sendLog(emoji.guild, "🗑️ Emoji deletado", `Emoji: ${emoji.name}`, "Red");
});

client.on("channelCreate", async channel => {
  if (!channel.guild) return;
  const config = getConfig();
  if (!config.panic) return;

  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelCreate);
  if (!executor || executor.id === client.user.id || isWhitelisted(executor.id)) return;

  await channel.delete("Modo pânico: criação de canal bloqueada").catch(() => {});
  await addSuspicion(channel.guild, executor.id, 30, "Criou canal durante modo pânico");
});

client.on("roleCreate", async role => {
  const config = getConfig();
  if (!config.panic) return;

  const executor = await getExecutor(role.guild, AuditLogEvent.RoleCreate);
  if (!executor || executor.id === client.user.id || isWhitelisted(executor.id)) return;

  await role.delete("Modo pânico: criação de cargo bloqueada").catch(() => {});
  await addSuspicion(role.guild, executor.id, 30, "Criou cargo durante modo pânico");
});

// =====================================================
// 31. BOT ONLINE
// =====================================================

client.once("clientReady", async () => {
  console.log(`✅ Security System online como ${client.user.tag}`);

  try {
    await registerCommands();

    setInterval(async () => {
      const config = getConfig();
      if (!config.autoBackup) return;

      for (const guild of client.guilds.cache.values()) {
        await createBackupHistory(guild).catch(() => {});
      }
    }, 15 * 60 * 1000);
  } catch (error) {
    console.error("❌ Erro ao registrar comandos:", error);
  }
});


// =====================================================
// 32. ERROS E LOGIN
// =====================================================

process.on("unhandledRejection", error => {
  console.error("Erro não tratado:", error);
});

process.on("uncaughtException", error => {
  console.error("Exceção não tratada:", error);
});

client.login(process.env.BOT_TOKEN);