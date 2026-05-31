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
  ChannelType
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

["./data", "./backups", "./transcripts"].forEach(folder => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

const CONFIG_PATH = "./data/config.json";
const CASES_PATH = "./data/cases.json";
const WARNS_PATH = "./data/warns.json";
const RAID_BANS_PATH = "./data/raidbans.json";


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

  await sendLog(
    guild,
    "♻️ Canal restaurado",
    `Canal: **${channel.name}**\nPermissões e posição restauradas.`,
    "Green"
  );

  return newChannel;
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
// 31. BOT ONLINE
// =====================================================

client.once("clientReady", async () => {
  console.log(`✅ Security System online como ${client.user.tag}`);

  try {
    await registerCommands();
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