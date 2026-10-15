const { gmd } = require("../black_hat");
const axios = require("axios");
const { sendButtons } = require("gifted-btns");
const { getContextInfo } = require("../black_hat/contextInfo");
const { getLidMapping } = require("../black_hat/connection/groupCache");
const {
    initTempMailDB,
    setUserEmail,
    getUserEmail,
    getUserEmailWithExpiry,
    deleteUserEmail,
    EXPIRY_MINUTES,
} = require("../black_hat/database/tempmail");

initTempMailDB();

function getUserName(jid) {
    return jid.split("@")[0];
}

function normalizeUserJid(jid) {
    if (!jid) return "";

    if (jid.endsWith("@lid")) {
        const mapped = getLidMapping(jid);
        if (mapped) return mapped;
    }

    let normalized = jid.split(":")[0].split("/")[0];
    if (!normalized.includes("@")) {
        normalized += "@s.whatsapp.net";
    }

    if (normalized.endsWith("@lid")) {
        const mapped = getLidMapping(normalized);
        if (mapped) return mapped;
    }

    return normalized;
}

function extractCode(text) {
    const codePatterns = [
        /\b(\d{4,8})\b/,
        /code[:\s]+(\d{4,8})/i,
        /verification[:\s]+(\d{4,8})/i,
        /otp[:\s]+(\d{4,8})/i,
        /pin[:\s]+(\d{4,8})/i,
    ];

    for (const pattern of codePatterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }
    return null;
}

gmd(
    {
        pattern: "tempmail",
        aliases: ["tempmailgen", "generatemail", "newmail", "getmail"],
        react: "📧",
        category: "tempmail",
        description: "Generate a new temporary email address",
    },
    async (from, Gifted, conText) => {
        const {
            sender,
            mek,
            reply,
            react,
            botFooter,
            botName,
            GiftedTechApi,
            GiftedApiKey,
        } = conText;

        const userJid = normalizeUserJid(sender);

        const existingData = await getUserEmailWithExpiry(userJid);
        if (existingData) {
            await react("⚠️");

            await Gifted.sendMessage(
                from,
                {
                    text: `⚠️ *ACTIVE EMAIL EXISTS*

Hey @${getUserName(sender)}, you already have an active temp email:

📬 *Email:* ${existingData.email}
⏰ *Expires in:* ${existingData.timeRemaining}

Use *.delmail* first to delete it, then generate a new one.

📥 Use *.tempinbox* to check messages
📖 Use *.readmail <number>* to read emails`,
                    contextInfo: await getContextInfo([sender]),
                },
                { quoted: mek },
            );

            await sendButtons(Gifted, from, {
                text: `📋 Copy your email`,
                footer: botFooter,
                buttons: [
                    {
                        name: "cta_copy",
                        buttonParamsJson: JSON.stringify({
                            display_text: "📋 Copy Email",
                            copy_code: existingData.email,
                        }),
                    },
                ],
            });
            return;
        }

        await react("⏳");

        try {
            const res = await axios.get(
                `${GiftedTechApi}/api/tempgen/v2/generate?apikey=gifted&mode=random`,
                {
                    params: { apikey: GiftedApiKey },
                    timeout: 30000,
                },
            );

            if (!res.data?.success || !res.data?.result?.email) {
                await react("❌");
                return reply("Failed to generate temp email. Try again later.");
            }

            const email = res.data.result.email;
            await setUserEmail(userJid, email);

            await Gifted.sendMessage(
                from,
                {
                    text: `📧 *TEMP MAIL GENERATED*

Hey @${getUserName(sender)}, your temporary email:

📬 *Email:* ${email}

⏰ *Expires in:* ${EXPIRY_MINUTES} minutes
📥 Use *.tempinbox* to check messages
📖 Use *.readmail <number>* to read specific email
🗑️ Use *.delmail* to delete and create new

_Copy the email below and use it for verification_`,
                    contextInfo: await getContextInfo([sender]),
                },
                { quoted: mek },
            );

            await sendButtons(Gifted, from, {
                text: `📋 Copy your email`,
                footer: botFooter,
                buttons: [
                    {
                        name: "cta_copy",
                        buttonParamsJson: JSON.stringify({
                            display_text: "📋 Copy Email",
                            copy_code: email,
                        }),
                    },
                ],
            });

            await react("✅");
        } catch (e) {
            console.error("Tempmail generate error:", e);
            await react("❌");
            return reply("Failed to generate temp email: " + e.message);
        }
    },
);

gmd(
    {
        pattern: "tempinbox",
        aliases: ["checkinbox", "inbox", "myinbox", "checktempmail"],
        react: "📥",
        category: "tempmail",
        description: "Check inbox of your generated temp email",
    },
    async (from, Gifted, conText) => {
        const {
            sender,
            mek,
            reply,
            react,
            botFooter,
            botName,
            GiftedTechApi,
            GiftedApiKey,
        } = conText;

        const userJid = normalizeUserJid(sender);

        const emailData = await getUserEmailWithExpiry(userJid);
        if (!emailData) {
            await react("❌");
            return reply(
                `❌ Hey @${getUserName(sender)}, you don't have an active temp email.\n\nUse *.tempmail* to generate one first.`,
            );
        }

        const email = emailData.email;
        await react("⏳");

        try {
            const res = await axios.get(`${GiftedTechApi}/api/tempmail/inbox`, {
                params: { apikey: GiftedApiKey, email: email },
                timeout: 30000,
            });

            if (!res.data?.success) {
                if (res.data?.message?.includes("No Emails")) {
                    await react("📭");

                    await Gifted.sendMessage(
                        from,
                        {
                            text: `📭 *EMPTY INBOX*

Hey @${getUserName(sender)}, no emails received yet.

📬 *Your Email:* ${email}
⏰ *Expires in:* ${emailData.timeRemaining}

_Wait a few seconds after sending an email and try again._`,
                            contextInfo: await getContextInfo([sender]),
                        },
                        { quoted: mek },
                    );

                    await sendButtons(Gifted, from, {
                        text: `📋 Copy your email`,
                        footer: botFooter,
                        buttons: [
                            {
                                name: "cta_copy",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "📋 Copy Email",
                                    copy_code: email,
                                }),
                            },
                        ],
                    });
                    return;
                }
                await react("❌");
                return reply(
                    "Failed to fetch inbox. Your email may have expired. Generate a new one with *.tempmail*",
                );
            }

            const emails = res.data.result;
            if (!emails || emails.length === 0) {
                await react("📭");

                await Gifted.sendMessage(
                    from,
                    {
                        text: `📭 *EMPTY INBOX*

Hey @${getUserName(sender)}, no emails received yet.

📬 *Your Email:* ${email}
⏰ *Expires in:* ${emailData.timeRemaining}

_Wait a few seconds afte                                   fileName: media.fileName
                                    } : {})
                                });
                            }

                            setTimeout(() => {
                                fs.unlink(media.path).catch(err => 
                                    logger.error('Media cleanup failed:', err)
                                );
                            }, 30000);
                        }
                    }
                } catch (error) {
                    logger.error('Failed to process in-chat ANTIDELETE:', error);
                }
            })());
        }

        if (antiDelete === 'indm') {
            promises.push((async () => {
                try {
                    const ownerContext = `*👤 Sent By:* ${finalSenderDisplay}\n*👤 Deleted By:* ${finalDeleterDisplay}\n${chatInfo}`;

                    if (deletedMsg.message?.conversation || deletedMsg.message?.extendedTextMessage?.text) {
                        const text = deletedMsg.message.conversation || 
                                    deletedMsg.message.extendedTextMessage.text;
                        
                        await Gifted.sendMessage(botOwnerJid, { 
                            text: `*𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚂𝚈𝚂𝚃𝙴𝙼*\n\n*🕑 Time:* ${currentTime}\n*📆 Date:* ${currentDate}\n\n${ownerContext}\n\n*Deleted Msg:*\n${text}\n\n> *${botFooter}*`,
                            mentions: allMentions,
                            contextInfo: getContextInfo(allMentions),
                            ...context
                        });
                    } else {
                        const media = await processMediaMessage(deletedMsg);
                        if (media) {
                            const dmAlert = media.caption ?
                                `*𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚂𝚈𝚂𝚃𝙴𝙼*\n\n*🕑 Time:* ${currentTime}\n*📆 Date:* ${currentDate}\n\n${ownerContext}\n\n*Caption:*\n${media.caption}\n\n> *${botFooter}*` :
                                `*𝙰𝙽𝚃𝙸𝙳𝙴𝙻𝙴𝚃𝙴 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚂𝚈𝚂𝚃𝙴𝙼*\n\n*🕑 Time:* ${currentTime}\n*📆 Date:* ${currentDate}\n\n${ownerContext}\n\n> *${botFooter}*`;

                            if (media.type === 'sticker' || media.type === 'audio') {
                                await Gifted.sendMessage(botOwnerJid, {
                                    [media.type]: { url: media.path },
                                    mentions: allMentions,
                                    contextInfo: getContextInfo(allMentions),
                                    ...context,
                                    ...(media.type === 'audio' ? {
                                        ptt: media.ptt,
                                        mimetype: media.mimetype
                                    } : {})
                                });
                                await Gifted.sendMessage(botOwnerJid, {
                                    text: dmAlert,
                                    mentions: allMentions,
                                    contextInfo: getContextInfo(allMentions),
                                    ...context
                                });
                            } else {
                                await Gifted.sendMessage(botOwnerJid, {
                                    [media.type]: { url: media.path },
                                    caption: dmAlert,
                                    mentions: allMentions,
                                    contextInfo: getContextInfo(allMentions),
                                    ...context,
                                    ...(media.type === 'document' ? {
                                        mimetype: media.mimetype,
                                        fileName: media.fileName
                                    } : {})
                                });
                            }

                            setTimeout(() => {
                                fs.unlink(media.path).catch(err => 
                                    logger.error('Media cleanup failed:', err)
                                );
                            }, 30000);
                        }
                    }
                } catch (error) {
                    logger.error('Failed to forward ANTIDELETE to owner:', error);
                    await Gifted.sendMessage(botOwnerJid, {
                        text: `⚠️ Failed to forward deleted message from ${finalDeleterDisplay}\n\nError: ${error.message}`,
                        mentions: allMentions,
                        contextInfo: getContextInfo(allMentions),
                        ...context
                    });
                }
            })());
        }

        await Promise.all(promises);
    } catch (error) {
        logger.error('Anti-delete handling failed:', error);
    }
};

const GiftedAntiViewOnce = async (Gifted, message) => {
    try {
        if (!message?.message) return;
        if (message.key.fromMe) return;
        
        const msgContent = message.message;
        let viewOnceContent = null;
        let mediaType = null;
        
        if (msgContent.imageMessage?.viewOnce || msgContent.videoMessage?.viewOnce || msgContent.audioMessage?.viewOnce) {
            mediaType = Object.keys(msgContent).find(
                (key) => key.endsWith("Message") && ["image", "video", "audio"].some((t) => key.includes(t))
            );
            if (mediaType) {
                viewOnceContent = { [mediaType]: msgContent[mediaType] };
            }
        } else if (msgContent.viewOnceMessage) {
            viewOnceContent = msgContent.viewOnceMessage.message;
            mediaType = viewOnceContent ? Object.keys(viewOnceContent).find(
                (key) => key.endsWith("Message") && ["image", "video", "audio"].some((t) => key.includes(t))
            ) : null;
        } else if (msgContent.viewOnceMessageV2) {
            viewOnceContent = msgContent.viewOnceMessageV2.message;
            mediaType = viewOnceContent ? Object.keys(viewOnceContent).find(
                (key) => key.endsWith("Message") && ["image", "video", "audio"].some((t) => key.includes(t))
            ) : null;
        } else if (msgContent.viewOnceMessageV2Extension) {
            viewOnceContent = msgContent.viewOnceMessageV2Extension.message;
            mediaType = viewOnceContent ? Object.keys(viewOnceContent).find(
                (key) => key.endsWith("Message") && ["image", "video", "audio"].some((t) => key.includes(t))
            ) : null;
        }
        
        if (!viewOnceContent || !mediaType || !viewOnceContent[mediaType]) return;
        
        const settings = await getAllSettings();
        const antiViewOnce = settings.ANTIVIEWONCE || "indm";
        if (antiViewOnce === "off") return;
        
        const botJid = Gifted.user?.id?.split(":")[0] + "@s.whatsapp.net";
        const targetJid = antiViewOnce === "indm" ? botJid : message.key.remoteJid;
        const senderNum = (message.key.participant || message.key.remoteJid).split("@")[0].split(":")[0];
        const botName = settings.BOT_NAME || "𝐁𝐋𝐀𝐂𝐊 𝐇𝐀𝐓-𝐌𝐃";
        
        const mediaMessage = {
            ...viewOnceContent[mediaType],
            viewOnce: false,
        };
        
        const path = require("path");
        const fs = require("fs").promises;
        const tempDir = path.join(__dirname, "temp");
        
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (e) {}
        
        const tempFileName = `vo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        let tempFilePath = null;
        
        try {
            tempFilePath = await Gifted.downloadAndSaveMediaMessage(mediaMessage, path.join(tempDir, tempFileName));
            
            const originalCaption = mediaMessage.caption || "";
            const caption = `👁️ *VIEW ONCE REVEALED*\n\n📤 *From:* @${senderNum}\n${originalCaption ? `📝 *Caption:* ${originalCaption}\n` : ""}\n> _Revealed by ${botName}_`;
            const mime = mediaMessage.mimetype || "";
            
            let sendContent;
            if (mediaType.includes("image")) {
                sendContent = { image: { url: tempFilePath }, caption, mimetype: mime, mentions: [`${senderNum}@s.whatsapp.net`] };
            } else if (mediaType.includes("video")) {
                sendContent = { video: { url: tempFilePath }, caption, mimetype: mime, mentions: [`${senderNum}@s.whatsapp.net`] };
            } else if (mediaType.includes("audio")) {
                sendContent = { audio: { url: tempFilePath }, ptt: true, mimetype: mime || "audio/mp4" };
            }
            
            if (sendContent) {
                await Gifted.sendMessage(targetJid, sendContent);
            }
        } catch (e) {
            console.error("Anti-ViewOnce download/send error:", e.message);
        } finally {
            if (tempFilePath) {
                try { await require("fs").promises.unlink(tempFilePath); } catch (e) {}
            }
        }
    } catch (error) {
        console.error("Anti-ViewOnce handler error:", error.message);
    }
};

const _extractEditContent = (msgObj) => {
    if (!msgObj || typeof msgObj !== 'object') return '';
    const type = Object.keys(msgObj)[0];
    if (!type) return '';
    const m = msgObj[type];
    if (type === 'conversation') return msgObj.conversation || '';
    if (type === 'extendedTextMessage') return m?.text || '';
    if (type === 'imageMessage') return `[Image]${m?.caption ? ' ' + m.caption : ''}`;
    if (type === 'videoMessage') return `[Video]${m?.caption ? ' ' + m.caption : ''}`;
    if (type === 'audioMessage') return '[Audio/Voice]';
    if (type === 'documentMessage') return `[Document] ${m?.fileName || m?.caption || ''}`.trim();
    if (type === 'stickerMessage') return '[Sticker]';
    if (type === 'editedMessage') {
        const inner = m?.message;
        return inner ? _extractEditContent(inner) : '';
    }
    return m?.text || m?.caption || `[${type}]`;
};

const _extractRawCaption = (msgObj) => {
    if (!msgObj || typeof msgObj !== 'object') return '';
    const type = Object.keys(msgObj)[0];
    if (!type) return '';
    const m = msgObj[type];
    if (type === 'conversation') return msgObj.conversation || '';
    if (type === 'extendedTextMessage') return m?.text || '';
    if (type === 'editedMessage') {
        const inner = m?.message;
        return inner ? _extractRawCaption(inner) : '';
    }
    return m?.caption || m?.text || '';
};

const _resolveLid = async (Gifted, lid) => {
    if (!lid?.endsWith('@lid')) return lid;
    const { getLidMapping } = require('./connection/groupCache');
    const cached = getLidMapping(lid);
    if (cached) return cached;
    try { const r = await Gifted.getJidFromLid(lid); if (r) return r; } catch (e) {}
    return lid;
};

const GiftedAntiEdit = async (Gifted, updateData, findOriginal) => {
    try {
        const settings = await getAllSettings();
        const antiEdit = settings.ANTI_EDIT || 'indm';
        if (antiEdit === 'false' || antiEdit === 'off') return;

        const { key, update } = updateData;
        if (!key || !update?.message) return;
        if (key.fromMe) return;
        if (key.remoteJid === 'status@broadcast') return;

        const rawChatJid = key.remoteJid;
        const msgId = key.id;

        const { getGroupMetadata } = require('./connection/groupCache');

        const resolvedChatJid = await _resolveLid(Gifted, rawChatJid);
        const isGroup = resolvedChatJid?.endsWith('@g.us') || rawChatJid?.endsWith('@g.us');

        const editedMsg = update.message;
        const newContent = _extractEditContent(editedMsg);
        if (!newContent) return;

        const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'documentMessage'];

        let originalContent = 'N/A';
        let originalPushName = null;
        let originalMediaObj = null;
        let origMsgType = null;
        let origMsgData = null;
        let cachedSender = null;

        if (findOriginal) {
            const orig = findOriginal(rawChatJid, msgId);
            if (orig?.message) {
                origMsgType = Object.keys(orig.message)[0];
                origMsgData = orig.message[origMsgType];
                originalContent = _extractEditContent(orig.message) || 'N/A';
                if (MEDIA_TYPES.includes(origMsgType)) originalMediaObj = orig;
            }
            if (orig?.originalPushName) originalPushName = orig.originalPushName;
            if (orig?.originalSender && !orig.originalSender.endsWith('@lid')) {
                cachedSender = orig.originalSender;
            }
        }

        let sender = cachedSender
            || (key.participantPn && !key.participantPn.endsWith('@lid') ? key.participantPn : null)
            || key.participant
            || (isGroup ? null : resolvedChatJid);
        sender = await _resolveLid(Gifted, sender);
        const senderNum = sender && !sender.endsWith('@lid')
            ? sender.split('@')[0]
            : resolvedChatJid?.split('@')[0] || 'Unknown';

        const botFooter = settings.FOOTER || '';
        const timeZone = settings.TIME_ZONE || 'Africa/Nairobi';

        let chatLabel = isGroup ? resolvedChatJid : 'DM';
        if (isGroup) {
            try { const meta = await getGroupMetadata(Gifted, resolvedChatJid); chatLabel = meta?.subject || resolvedChatJid; } catch (e) {}
        }

        const currentTime = formatTime(Date.now(), timeZone);
        const currentDate = formatDate(Date.now(), timeZone);
        const mentions = sender && !sender.endsWith('@lid') ? [sender] : [];

        const origCaption = originalMediaObj ? (_extractRawCaption(originalMediaObj.message) || '(no caption)') : originalContent;
        const newCaption = _extractRawCaption(update.message) || newContent;

        const alertText = `*✏️ ANTI-EDIT MESSAGE SYSTEM*\n\n` +
            `*👤 Edited By:* @${senderNum}\n` +
            `*🕑 Time:* ${currentTime}\n` +
            `*📆 Date:* ${currentDate}\n` +
            `*💬 Chat:* ${chatLabel}\n\n` +
            `*📄 Original ${originalMediaObj ? 'Caption' : 'Message'}:* ${origCaption}\n` +
            `*📝 Edited To:* ${newCaption}\n\n` +
            `> *${botFooter}*`;

        const sendAlert = async (targetJid) => {
            if (!targetJid) return;
            if (originalMediaObj) {
                try {
                    const { downloadMediaMessage } = require('gifted-baileys');
                    const buffer = await downloadMediaMessage(originalMediaObj, 'buffer', {});
                    if (origMsgType === 'imageMessage') {
                        await Gifted.sendMessage(targetJid, { image: buffer, caption: alertText, mentions });
                    } else if (origMsgType === 'videoMessage') {
                        await Gifted.sendMessage(targetJid, { video: buffer, caption: alertText, mentions });
                    } else if (origMsgType === 'documentMessage') {
                        await Gifted.sendMessage(targetJid, {
                            document: buffer,
                            fileName: origMsgData?.fileName || 'document',
                            mimetype: origMsgData?.mimetype || 'application/octet-stream',
                            caption: alertText,
                            mentions,
                        });
                    } else {
                        await Gifted.sendMessage(targetJid, { text: alertText, mentions });
                    }
                    return;
                } catch (mediaErr) {
                    console.error('[ANTI-EDIT] media forward failed:', mediaErr.message);
                }
            }
            await Gifted.sendMessage(targetJid, { text: alertText, mentions });
        };

        const sendJid = resolvedChatJid && !resolvedChatJid.endsWith('@lid') ? resolvedChatJid : rawChatJid;
        const dmTarget = Gifted.user?.id ? `${Gifted.user.id.split(':')[0]}@s.whatsapp.net` : null;

        if (antiEdit === 'indm' || antiEdit === 'on') {
            if (dmTarget) { try { await sendAlert(dmTarget); } catch (e) {} }
        }
        if ((antiEdit === 'inchat' || antiEdit === 'on') && sendJid) {
            try { await sendAlert(sendJid); } catch (e) {}
        }
    } catch (err) {
        console.error('Anti-edit error:', err.message);
    }
};

async function antiStickerHandler(mek, Gifted) {
  try {
    const from = mek.key.remoteJid;

    if (!from.endsWith("@g.us")) return;

const raw = await getGroupSetting(from, "antisticker");

const antiSticker =
    raw === true ||
    raw === "true" ||
    raw === 1;

if (antiSticker !== true) return;

    const msg =
      mek.message?.stickerMessage ||
      mek.message?.ephemeralMessage?.message?.stickerMessage ||
      mek.message?.viewOnceMessageV2?.message?.stickerMessage;

    if (!msg) return;

    const sender = mek.key.participant || mek.key.remoteJid;

    await Gifted.sendMessage(from, {
      delete: mek.key,
    });

    await Gifted.sendMessage(from, {
      text: `🚫 @${sender.split("@")[0]} Stickers are not allowed here!`,
      mentions: [sender],
    });
  } catch (err) {
    console.error("AntiSticker Handler Error:", err);
  }
}


module.exports = { logger, emojis, GiftedAutoReact, GiftedTechApi, GiftedApiKey, GiftedAntiLink, GiftedAntibad, GiftedAntiGroupMention, GiftedAutoBio, GiftedChatBot, GiftedAntiDelete, GiftedAnticall, GiftedPresence, GiftedAntiViewOnce, GiftedAntiEdit, antiStickerHandler };
