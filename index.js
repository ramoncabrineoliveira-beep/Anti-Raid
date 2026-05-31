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
  PermissionsBitField
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

if (!fs.existsSync("./data")) fs.mkdirSync("./data");
if (!fs.existsSync("./backups")) fs.mkdirSync("./backups");
if (!fs.existsSync("./transcripts")) fs.mkdirSync("./transcripts");

const CONFIG_PATH = "./data/config.json";
const CASES_PATH = "./data/cases.json";
const WARNS_PATH = "./data/warns.json";

function createFile(path, data) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  }
}

createFile(CONFIG_PATH, {
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
  botlock: false,
  webhooklock: false,
  lockdown: false,
  emergency: false,
  whitelist: [],
  blacklist: [],
  allowedBots: [],
  logChannel: process.env.LOG_CHANNEL_ID || null
});

createFile(CASES_PATH, []);
createFile(WARNS_PATH, {});

function readJSON(path) {
  return JSON.parse(fs.readFileSync(path));
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function getConfig() {
  return readJSON(CONFIG_PATH);
}

function saveConfig(config) {
  saveJSON(CONFIG_PATH, config);
}

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

function addWhitelist(userId) {
  const config = getConfig();

  if (!config.whitelist.includes(userId)) {
    config.whitelist.push(userId);
    saveConfig(config);
  }
}

function removeWhitelist(userId) {
  const config = getConfig();

  config.whitelist = config.whitelist.filter(id => id !== userId);
  saveConfig(config);
}

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
async function canPunish(guild, userId) {
  const config = getConfig();

  if (userId === process.env.OWNER_ID) return false;
  if (userId === guild.ownerId) return false;
  if (config.whitelist?.includes(userId)) return false;
  if (config.immuneUsers?.includes(userId)) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  const bot = guild.members.me;

  if (!member || !bot) return false;

  const hasImmuneRole = member.roles.cache.some(role =>
    config.immuneRoles?.includes(role.id)
  );

  if (hasImmuneRole) return false;

  if (member.roles.highest.position >= bot.roles.highest.position) return false;

  return true;
}

async function punish(guild, userId, reason) {
  if (!(await canPunish(guild, userId))) {
    await sendLog(
      guild,
      "⚠️ Punição ignorada",
      `Usuário: <@${userId}>\nMotivo: protegido, whitelist ou cargo maior que o bot.\nAção: ${reason}`,
      "Yellow"
    );
    return;
  }

  await guild.members.ban(userId, {
    reason: `Security System: ${reason}`
  }).catch(() => {});

  await sendLog(
    guild,
    "🚨 Usuário banido pelo Anti-Raid",
    `Usuário: <@${userId}>\nMotivo: **${reason}**\nHorário: **${nowBR()}**`,
    "Red"
  );
}

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

const actionMap = new Map();
const spamMap = new Map();

const ACTION_LIMIT = 3;
const ACTION_TIME = 10000;

async function registerDangerAction(guild, userId, reason) {
  if (isWhitelisted(userId)) return;

  const key = `${guild.id}-${userId}`;
  const old = actionMap.get(key) || [];
  const filtered = old.filter(t => Date.now() - t < ACTION_TIME);

  filtered.push(Date.now());
  actionMap.set(key, filtered);

  if (filtered.length >= ACTION_LIMIT) {
    await punish(guild, userId, reason);
    actionMap.delete(key);
  }
}

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
        permissions: role.permissions.bitfield.toString()
      })),
    channels: guild.channels.cache.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentName: channel.parent?.name || null,
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

async function restoreBackup(guild) {
  const path = `./backups/${guild.id}.json`;
  if (!fs.existsSync(path)) return false;

  const backup = readJSON(path);

  for (const role of backup.roles.sort((a, b) => a.position - b.position)) {
    const exists = guild.roles.cache.find(r => r.name === role.name);
    if (exists) continue;

    await guild.roles.create({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: BigInt(role.permissions),
      reason: "Security System Restore"
    }).catch(() => {});
  }

  for (const channel of backup.channels.sort((a, b) => a.position - b.position)) {
    const exists = guild.channels.cache.find(c => c.name === channel.name);
    if (exists) continue;

    const parent = channel.parentName
      ? guild.channels.cache.find(c => c.name === channel.parentName)
      : null;

    await guild.channels.create({
      name: channel.name,
      type: channel.type,
      parent: parent?.id || null,
      topic: channel.topic || null,
      nsfw: channel.nsfw || false,
      rateLimitPerUser: channel.rateLimitPerUser || 0,
      reason: "Security System Restore"
    }).catch(() => {});
  }

  return true;
}function createToggleCommand(name, description) {
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

const commands = [

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
    .setName("security-status")
    .setDescription("Mostra o status da segurança")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  createToggleCommand("antiraid", "Ativa ou desativa o Anti-Raid"),
  createToggleCommand("antinuke", "Ativa ou desativa o Anti-Nuke"),
  createToggleCommand("antispam", "Ativa ou desativa o Anti-Spam"),
  createToggleCommand("antiinvite", "Ativa ou desativa o Anti-Invite"),
  createToggleCommand("antilink", "Ativa ou desativa o Anti-Link"),
  createToggleCommand("antibot", "Ativa ou desativa o Anti-Bot"),
  createToggleCommand("antiwebhook", "Ativa ou desativa o Anti-Webhook"),
  createToggleCommand("antieveryone", "Ativa ou desativa o Anti-Everyone"),
  createToggleCommand("antichannelcreate", "Proteção contra criação de canais"),
  createToggleCommand("antichanneldelete", "Proteção contra exclusão de canais"),
  createToggleCommand("antirolecreate", "Proteção contra criação de cargos"),
  createToggleCommand("antiroledelete", "Proteção contra exclusão de cargos"),
  createToggleCommand("antiban", "Proteção contra banimentos em massa"),
  createToggleCommand("antikick", "Proteção contra expulsões em massa"),
  createToggleCommand("botlock", "Bloqueia entrada de bots"),
  createToggleCommand("webhooklock", "Bloqueia criação de webhooks"),

  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Cria backup do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("Restaura backup do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
    
  new SlashCommandBuilder()
  .setName("addcargo")
  .setDescription("Adiciona um cargo a um usuário")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption(option =>
    option.setName("usuario")
      .setDescription("Usuário")
      .setRequired(true)
  )
  .addRoleOption(option =>
    option.setName("cargo")
      .setDescription("Cargo")
      .setRequired(true)
  ),

new SlashCommandBuilder()
  .setName("removercargo")
  .setDescription("Remove um cargo de um usuário")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption(option =>
    option.setName("usuario")
      .setDescription("Usuário")
      .setRequired(true)
  )
  .addRoleOption(option =>
    option.setName("cargo")
      .setDescription("Cargo")
      .setRequired(true)
  ),


].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

  await rest.put(

    Routes.applicationCommands(
  process.env.CLIENT_ID
),
    { body: commands }
  );

  console.log(`✅ ${commands.length} comandos registrados.`);
  
}
client.on("interactionCreate", async interaction => {
if (!interaction.isChatInputCommand()) return;

const cmd = interaction.commandName;

if (cmd === "addcargoimune") {
  try {
    const cargo = interaction.options.getRole("cargo");
    const config = getConfig();

    if (!config.immuneRoles) config.immuneRoles = [];

    if (!config.immuneRoles.includes(cargo.id)) {
      config.immuneRoles.push(cargo.id);
      saveConfig(config);
    }

    return interaction.reply({
      content: `✅ Cargo ${cargo} adicionado à lista de imunes.`,
      ephemeral: true
    });
  } catch (err) {
    console.error("Erro no addcargoimune:", err);

    if (!interaction.replied) {
      return interaction.reply({
        content: "❌ Erro ao adicionar cargo imune. Veja o terminal.",
        ephemeral: true
      });
    }
  }
}if (cmd === "remcargoimune") {
  const cargo = interaction.options.getRole("cargo");
  const config = getConfig();

  config.immuneRoles = (config.immuneRoles || []).filter(id => id !== cargo.id);
  saveConfig(config);

  return interaction.reply({
    content: `✅ Cargo ${cargo} removido da lista de imunes.`,
    ephemeral: true
  });
}

if (cmd === "listacargoimune") {
  const config = getConfig();
  const cargos = config.immuneRoles || [];

  return interaction.reply({
    content: cargos.length
      ? `🛡️ Cargos imunes:\n${cargos.map(id => `<@&${id}>`).join("\n")}`
      : "❌ Nenhum cargo imune cadastrado.",
    ephemeral: true
  });
}

  try {
    if (
      [
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
        "botlock",
        "webhooklock"
      ].includes(cmd)
    ) {
      const modo = interaction.options.getString("modo");
      const config = getConfig();

      config[cmd] = modo === "on";
      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: `✅ **/${cmd}** foi ${modo === "on" ? "ativado" : "desativado"}.`
      });
    }

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
          `Whitelist: ${config.whitelist.length} usuário(s)`
      });
    }

    if (cmd === "backup") {
      await createBackup(interaction.guild);

      await sendLog(
        interaction.guild,
        "📦 Backup criado",
        `Criado por: <@${interaction.user.id}>`,
        "Green"
      );

      return interaction.reply({
        ephemeral: true,
        content: "✅ Backup criado com sucesso."
      });
    }

    if (cmd === "restore") {
      const ok = await restoreBackup(interaction.guild);

      return interaction.reply({
        ephemeral: true,
        content: ok
          ? "✅ Restore iniciado com sucesso."
          : "❌ Nenhum backup encontrado."
      });
    }

    if (cmd === "whitelist") {
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const user = interaction.options.getUser("usuario");
        addWhitelist(user.id);

        return interaction.reply({
          ephemeral: true,
          content: `✅ <@${user.id}> adicionado na whitelist.`
        });
      }

      if (sub === "remove") {
        const user = interaction.options.getUser("usuario");
        removeWhitelist(user.id);

        return interaction.reply({
          ephemeral: true,
          content: `✅ <@${user.id}> removido da whitelist.`
        });
      }

      if (sub === "list") {
        const config = getConfig();

        return interaction.reply({
          ephemeral: true,
          content:
            config.whitelist.length === 0
              ? "Whitelist vazia."
              : config.whitelist.map(id => `<@${id}>`).join("\n")
        });
      }
    }

    if (cmd === "ban") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("motivo") || "Sem motivo";

      await interaction.guild.members.ban(user.id, { reason }).catch(() => {});

      addCase("BAN", interaction.user.id, user.id, reason);

      await sendLog(
        interaction.guild,
        "🔨 Usuário banido",
        `Moderador: <@${interaction.user.id}>\nUsuário: <@${user.id}>\nMotivo: ${reason}`,
        "Red"
      );

      return interaction.reply({
        ephemeral: true,
        content: `🔨 <@${user.id}> foi banido.\nMotivo: ${reason}`
      });
    }

    if (cmd === "kick") {
      const user = interaction.options.getUser("usuario");
      const reason = interaction.options.getString("motivo") || "Sem motivo";
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({
          ephemeral: true,
          content: "❌ Usuário não encontrado."
        });
      }

      await member.kick(reason).catch(() => {});

      addCase("KICK", interaction.user.id, user.id, reason);

      await sendLog(
        interaction.guild,
        "👢 Usuário expulso",
        `Moderador: <@${interaction.user.id}>\nUsuário: <@${user.id}>\nMotivo: ${reason}`,
        "Orange"
      );

      return interaction.reply({
        ephemeral: true,
        content: `👢 <@${user.id}> foi expulso.\nMotivo: ${reason}`
      });
    }

    if (cmd === "timeout") {
      const user = interaction.options.getUser("usuario");
      const minutes = interaction.options.getInteger("minutos");
      const reason = interaction.options.getString("motivo") || "Sem motivo";
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

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

    if (cmd === "untimeout") {
      const user = interaction.options.getUser("usuario");
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

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

      if (userWarns.length === 0) {
        return interaction.reply({
          ephemeral: true,
          content: "✅ Esse usuário não possui avisos."
        });
      }

      return interaction.reply({
        ephemeral: true,
        content:
          `⚠️ Avisos de <@${user.id}>:\n\n` +
          userWarns
            .map((w, i) => `**${i + 1}.** ${w.reason} — ${w.date}`)
            .join("\n")
      });
    }

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

    if (cmd === "lock") {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false }
      );

      return interaction.reply({
        content: "🔒 Canal bloqueado."
      });
    }

    if (cmd === "unlock") {
      await interaction.channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: true }
      );

      return interaction.reply({
        content: "🔓 Canal desbloqueado."
      });
    }

    if (cmd === "slowmode") {
      const seconds = interaction.options.getInteger("segundos");

      await interaction.channel.setRateLimitPerUser(seconds).catch(() => {});

      return interaction.reply({
        ephemeral: true,
        content: `⏱️ Slowmode definido para ${seconds} segundo(s).`
      });
    }

    if (cmd === "serverinfo") {
      return interaction.reply({
        ephemeral: true,
        content:
          `🏰 **Servidor:** ${interaction.guild.name}\n` +
          `👥 Membros: ${interaction.guild.memberCount}\n` +
          `📁 Canais: ${interaction.guild.channels.cache.size}\n` +
          `🎭 Cargos: ${interaction.guild.roles.cache.size}`
      });
    }

    if (cmd === "userinfo") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      return interaction.reply({
        ephemeral: true,
        content:
          `👤 **Usuário:** ${user.tag}\n` +
          `🆔 ID: ${user.id}\n` +
          `📅 Conta criada: <t:${Math.floor(user.createdTimestamp / 1000)}:F>\n` +
          `🎭 Maior cargo: ${member?.roles.highest || "Nenhum"}`
      });
    }

    if (cmd === "ping") {
      return interaction.reply({
        ephemeral: true,
        content: `🏓 Pong! Ping: ${client.ws.ping}ms`
      });
    }

    if (cmd === "say") {
      const msg = interaction.options.getString("mensagem");

      await interaction.channel.send(msg);

      return interaction.reply({
        ephemeral: true,
        content: "✅ Mensagem enviada."
      });
    }

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

if (cmd === "lockdown") {
  await interaction.deferReply({ ephemeral: true });

  const channels = interaction.guild.channels.cache.filter(
    c => c.type === ChannelType.GuildText
  );

  let success = 0;
  let fail = 0;

  for (const channel of channels.values()) {
    try {
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false },
        { reason: "Lockdown ativado" }
      );
      success++;
    } catch {
      fail++;
    }
  }

  return interaction.editReply({
    content: `🔒 Lockdown ativado.\n✅ Canais bloqueados: ${success}\n❌ Falhas: ${fail}`
  });
}
if (cmd === "unlockdown") {
  await interaction.deferReply({ ephemeral: true });

  const channels = interaction.guild.channels.cache.filter(
    c => c.type === ChannelType.GuildText
  );

  let success = 0;
  let fail = 0;

  for (const channel of channels.values()) {
    try {
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null },
        { reason: "Lockdown removido" }
      );
      success++;
    } catch {
      fail++;
    }
  }
  return interaction.editReply({
    content: `🔓 Lockdown removido.\n✅ Canais desbloqueados: ${success}\n❌ Falhas: ${fail}`
  });
if (cmd === "addcargoimune") {
  const cargo = interaction.options.getRole("cargo");
  const config = getConfig();

  if (!config.immuneRoles) config.immuneRoles = [];

  if (!config.immuneRoles.includes(cargo.id)) {
    config.immuneRoles.push(cargo.id);
    saveConfig(config);
  }

  return interaction.reply({
    content: `✅ Cargo ${cargo} adicionado à lista de imunes.`,
    ephemeral: true
  });
}

  if (cmd === "listarcargosimunes") {
  const config = getConfig();
  const cargos = config.immuneRoles || [];

  return interaction.reply({
    content: cargos.length
      ? cargos.map(id => `<@&${id}>`).join("\n")
      : "Nenhum cargo imune cadastrado.",
    ephemeral: true
  });
}
if (cmd === "removercargoimune") {
  const cargo = interaction.options.getRole("cargo");
  const config = getConfig();

  config.immuneRoles = (config.immuneRoles || []).filter(id => id !== cargo.id);
  saveConfig(config);

  return interaction.reply({
    content: `✅ Cargo ${cargo} removido da lista de imunes.`,
    ephemeral: true
  });
}
}

    if (cmd === "emergency") {
      const config = getConfig();

      config.emergency = true;
      config.antiraid = true;
      config.antinuke = true;
      config.antispam = true;
      config.antibot = true;
      config.antiwebhook = true;
      config.antieveryone = true;

      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: "🚨 Modo emergência ativado. Proteções principais ligadas."
      });
    }

    if (cmd === "unemergency") {
      const config = getConfig();

      config.emergency = false;
      saveConfig(config);

      return interaction.reply({
        ephemeral: true,
        content: "✅ Modo emergência desativado."
      });
    }

    if (cmd === "cases") {
      const cases = readJSON(CASES_PATH);

      if (cases.length === 0) {
        return interaction.reply({
          ephemeral: true,
          content: "Nenhum caso registrado."
        });
      }

      return interaction.reply({
        ephemeral: true,
        content: cases
          .slice(-10)
          .map(c =>
            `#${c.id} **${c.type}** | Usuário: <@${c.userId}> | Motivo: ${c.reason}`
          )
          .join("\n")
      });
    }
  } catch (error) {
    console.error(error);

    if (!interaction.replied) {
      return interaction.reply({
        ephemeral: true,
        content: "❌ Ocorreu um erro ao executar esse comando."
      });
    }
  }
});
client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  const config = getConfig();
  if (!config.antinuke && !config.antichanneldelete) return;

  const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete);
  if (!executor) return;
  if (executor.id === client.user.id) return;

  if (!(await canPunish(channel.guild, executor.id))) {
  await sendLog(
    channel.guild,
    "⚠️ Ação ignorada",
    `Usuário: <@${executor.id}>\nMotivo: usuário/cargo imune.\nAção: deletou canal, mas não será punido nem restaurado.`,
    "Yellow"
  );
  return;
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

  if (channel.type === ChannelType.GuildCategory) {
    await channel.guild.channels.create({
      name: channel.name,
      type: ChannelType.GuildCategory,
      position: channel.rawPosition,
      reason: "Security System Backup"
    }).catch(() => {});
    return;
  }

  await channel.guild.channels.create({
    name: channel.name,
    type: channel.type,
    parent: channel.parentId || null,
    topic: channel.topic || null,
    nsfw: channel.nsfw || false,
    rateLimitPerUser: channel.rateLimitPerUser || 0,
    position: channel.rawPosition,
    reason: "Security System Backup"
  }).catch(() => {});
});

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

client.on("roleDelete", async role => {
  const config = getConfig();
  if (!config.antinuke && !config.antiroledelete) return;

  const executor = await getExecutor(role.guild, AuditLogEvent.RoleDelete);
  if (!executor) return;
  if (executor.id === client.user.id) return;

  if (!(await canPunish(role.guild, executor.id))) {
  await sendLog(
    role.guild,
    "⚠️ Ação ignorada",
    `Usuário: <@${executor.id}>\nMotivo: usuário/cargo imune.\nAção: deletou cargo, mas não será punido nem restaurado.`,
    "Yellow"
  );
  return;
}})

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

 const newRole = await role.guild.roles.create({
  name: role.name,
  colors: { primaryColor: role.color },
  hoist: role.hoist,
  mentionable: role.mentionable,
  permissions: role.permissions.bitfield,
  reason: "Security System Backup"
}).catch(err => {
  console.log("Erro ao restaurar cargo:", err);
  return null;
});

if (newRole) {
  await newRole.setPosition(role.position).catch(err => {
    console.log("Erro ao mover cargo:", err);
  });
}

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

client.on("guildMemberAdd", async member => {
  const config = getConfig();

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
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const config = getConfig();
  if (isWhitelisted(message.author.id)) return;

  const content = message.content.toLowerCase();

  if (config.antieveryone) {
    if (
      message.content.includes("@everyone") ||
      message.content.includes("@here")
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
  }

  if (config.antiinvite) {
    const inviteRegex =
      /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)/i;

    if (inviteRegex.test(message.content)) {
      await message.delete().catch(() => {});

      await sendLog(
        message.guild,
        "🔗 Convite bloqueado",
        `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
        "Yellow"
      );

      return;
    }
  }

  if (config.antilink) {
    const linkRegex = /(https?:\/\/|www\.)/i;

    if (linkRegex.test(message.content)) {
      await message.delete().catch(() => {});

      await sendLog(
        message.guild,
        "🌐 Link bloqueado",
        `Usuário: <@${message.author.id}>\nCanal: <#${message.channel.id}>`,
        "Yellow"
      );

      return;
    }
  }

  if (config.antispam) {
    const key = `${message.guild.id}-${message.author.id}`;
    const old = spamMap.get(key) || [];
    const filtered = old.filter(t => Date.now() - t < 7000);

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
client.once("clientReady", async () => {
  console.log(`✅ Security System online como ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("❌ Erro ao registrar comandos:", error);
  }
});

process.on("unhandledRejection", error => {
  console.error("Erro não tratado:", error);
});

process.on("uncaughtException", error => {
  console.error("Exceção não tratada:", error);
});

client.login(process.env.BOT_TOKEN);