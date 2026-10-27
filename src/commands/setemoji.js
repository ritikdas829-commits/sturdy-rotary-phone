/**
 * setemoji.js — Command Handler with Async MongoDB Support
 * Location: src/commands/setemoji.js
 */

import { getEmojis, saveEmoji } from '../quest/emoji.js';

export const name = 'setemoji';
export const description = 'Manage and update custom UI emojis';

export async function execute(message, args) {
    const key = args[0]?.toLowerCase();
    const newEmoji = args[1];
    const guildId = message.guild?.id || 'global';

    // Fetch emojis asynchronously from MongoDB/Cache
    const emojis = await getEmojis(guildId);

    // If no key provided, display all available keys & current values
    if (!key) {
        let text = '### 🎨 Current Quest UI Emojis:\n';
        for (const [k, v] of Object.entries(emojis)) {
            text += `- **${k}**:${v}\n`;
        }
        text += '\n*Usage: `?setemoji <key> <emoji>`*';
        return message.reply(text);
    }

    // Check if key exists in default/custom emojis
    if (!emojis[key]) {
        return message.reply(`❌ Invalid emoji key! Available keys:\n\`${Object.keys(emojis).join(', ')}\``);
    }

    // Check if new emoji parameter was provided
    if (!newEmoji) {
        return message.reply(`❌ Please provide a new emoji! Example: \`?setemoji ${key} <:emoji_name:123456789>\``);
    }

    // Save to MongoDB & Update Cache
    const success = await saveEmoji(key, newEmoji, guildId);

    if (success) {
        return message.reply(`✅ Successfully updated emoji **${key}** to ${newEmoji}`);
    } else {
        return message.reply(`❌ Failed to update emoji in database.`);
    }
}

// 👈 Yeh default export add karne se index.js ka loader ise successfully register kar lega
export default {
    name,
    description,
    execute
};
