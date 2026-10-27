import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import deployCommands from './utils/deployCommands.js';
import { TokenStore } from './quest/tokenStore.js';
import * as dbModule from './utils/db.js';

// Trackers & Role Store Imports
import { cacheGuildInvites, handleInviteJoin, handleInviteLeave } from './handlers/inviteTracker.js';
import { handleBoostUpdate } from './handlers/boostTracker.js';
import { syncRolesFromDB } from './quest/roleStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const col = {
    reset:  '\x1b[0m', bright: '\x1b[1m', cyan: '\x1b[96m',
    blue:   '\x1b[34m', white: '\x1b[97m', purple: '\x1b[35m',
    green:  '\x1b[92m', dim:   '\x1b[90m',
};

function banner() {
    const lines = [
        '',
        `${col.cyan}${col.bright}   ██████╗  ██████╗██╗   ██╗ ██╗${col.reset}`,
        `${col.cyan}${col.bright}  ██╔═══██╗██╔════╝██║   ██║███║${col.reset}`,
        `${col.blue}${col.bright}  ██║   ██║██║     ██║   ██║╚██║${col.reset}`,
        `${col.blue}${col.bright}  ██║▄▄ ██║██║     ╚██╗ ██╔╝ ██║${col.reset}`,
        `${col.white}${col.bright}  ╚██████╔╝╚██████╗ ╚████╔╝  ██║${col.reset}`,
        `${col.white}${col.bright}   ╚══▀▀═╝  ╚═════╝  ╚═════╝   ╚═╝${col.reset}`,
        '',
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        `  ${col.green}●${col.reset} ${col.white}Quest Completer V1 - 5 Slots${col.reset}  ${col.dim}|${col.reset}   ${col.white}dsc.gg/synoraxdev${col.reset}`,
        `${col.dim}  ─────────────────────────────────────────────────${col.reset}`,
        '',
    ];
    for (const line of lines) process.stdout.write(line + '\n');
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('DISCORD_TOKEN is not set.'); process.exit(1); }

// Safe MongoDB Connection
const connectDB = dbModule.connectDB || dbModule.default;
if (typeof connectDB === 'function') {
    try {
        await connectDB();
        console.log(`${col.green}● MongoDB Connected${col.reset}`);
    } catch (e) {
        console.warn(`${col.purple}● MongoDB Failed: ${e.message}${col.reset} — Bot chalega bina DB ke`);
    }
}

banner();
await deployCommands(TOKEN, process.env.DISCORD_CLIENT_ID);

// Sync roles from DB on startup to avoid 'Not set' error
try {
    await syncRolesFromDB();
    console.log(`${col.green}● Roles synced from MongoDB successfully${col.reset}`);
} catch (err) {
    console.warn(`${col.purple}● Role sync warning:${col.reset}`, err.message);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember],
});

const activePrefix    = process.env.PREFIX || process.env.BOT_PREFIX || ';';
client.commands       = new Collection();
client.prefixCommands = new Collection();
client.tokenStore     = new TokenStore();
client.config         = { prefix: activePrefix };
client.prefix         = activePrefix;

client.getPrefix = function(guildId) {
    return activePrefix;
};

// ── Dynamic Command Loader ──────────────────────────────────────────────────
const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const mod = await import(pathToFileURL(join(__dirname, 'commands', file)).href);

    const registerCmd = (cmd) => {
        if (!cmd) return;
        const cmdName = cmd.name || cmd.prefix || cmd.data?.name;
        // Safely check if cmdName is a valid string before calling toLowerCase()
        if (cmdName && typeof cmdName === 'string') {
            client.prefixCommands.set(cmdName.toLowerCase(), cmd);
            if (cmd.data && typeof cmd.data.name === 'string') {
                client.commands.set(cmd.data.name, cmd);
            }
        }
    };

    if (mod.default) registerCmd(mod.default);

    if (mod.name && mod.execute) {
        registerCmd(mod);
    }

    for (const [key, cmd] of Object.entries(mod)) {
        if (['default', 'makeTokenStore', 'handleLinkModal', 'handleLinkPromptButton', 'runAutoquestForUser', 'buildPremiumLinkPanel', 'handleButton', 'handleModal'].includes(key)) continue;
        registerCmd(cmd);
    }
}

// ── Dynamic Event Loader ────────────────────────────────────────────────────
try {
    const eventFiles = readdirSync(join(__dirname, 'events')).filter(f => f.endsWith('.js'));
    for (const file of eventFiles) {
        const mod   = await import(pathToFileURL(join(__dirname, 'events', file)).href);
        const event = mod.default;
        if (event?.name && event?.execute) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
        }
    }
} catch (err) {
    console.error('❌ Error loading events:', err);
}

// ── Client Ready Event ─────────────────────────────────────────────────────
client.once('clientReady', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    await cacheGuildInvites(client);
    console.log(`⚡ Guild invites cached successfully.`);
});

// ── Invite & Boost Event Listeners ─────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
    await handleInviteJoin(member);
});

client.on('guildMemberRemove', async (member) => {
    await handleInviteLeave(member);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await handleBoostUpdate(oldMember, newMember);
});

client.login(TOKEN);
