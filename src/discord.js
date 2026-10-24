import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

const COLORS = { pending: 0x3498db, approved: 0x2ecc71, declined: 0xe74c3c };
const BUTTON_ID = /^jr:(approve|decline):(\d{1,10})$/;

const truncate = (text, max) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function validHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Extract the fields we care about from a Jellyseerr webhook payload.
 * Returns null if the payload has no usable request ID (nothing to approve).
 */
export function parseRequestPayload(payload) {
  const requestId = String(payload.request?.request_id ?? '');
  if (!/^\d{1,10}$/.test(requestId)) return null;
  return {
    requestId,
    title: payload.subject || 'New media request',
    description: payload.message || '',
    mediaType: payload.media?.media_type || '',
    tmdbId: String(payload.media?.tmdbId ?? ''),
    requestedBy: payload.request?.requestedBy_username || 'Unknown',
    image: validHttpUrl(payload.image),
  };
}

const MEDIA_LABELS = { movie: 'Movie', tv: 'TV Show' };

/** Build the Discord message (embed + buttons) for a pending request. */
export function buildRequestMessage(data, { publicUrl = '' } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(truncate(data.title, 256))
    .setColor(COLORS.pending)
    .addFields(
      { name: 'Type', value: MEDIA_LABELS[data.mediaType] ?? (data.mediaType || 'Unknown'), inline: true },
      { name: 'Requested by', value: truncate(data.requestedBy, 256), inline: true },
      { name: 'Request ID', value: data.requestId, inline: true },
    )
    .setTimestamp();

  if (data.description) embed.setDescription(truncate(data.description, 1000));
  if (data.image) embed.setThumbnail(data.image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`jr:approve:${data.requestId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`jr:decline:${data.requestId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger),
  );

  if (publicUrl && data.tmdbId && MEDIA_LABELS[data.mediaType] && /^\d+$/.test(data.tmdbId)) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open in Jellyseerr')
        .setStyle(ButtonStyle.Link)
        .setURL(`${publicUrl}/${data.mediaType}/${data.tmdbId}`),
    );
  }

  return { embeds: [embed], components: [row] };
}

/**
 * Who may press the buttons?
 *  - If ALLOWED_ROLE_IDS / ALLOWED_USER_IDS are set: only those users/roles.
 *  - Otherwise: only members with the "Manage Server" permission.
 */
export function isAllowed(interaction, { allowedRoleIds, allowedUserIds }) {
  if (allowedUserIds.includes(interaction.user.id)) return true;

  const roles = interaction.member?.roles;
  const memberRoleIds = Array.isArray(roles) ? roles : roles?.cache ? [...roles.cache.keys()] : [];
  if (memberRoleIds.some((id) => allowedRoleIds.includes(id))) return true;

  if (allowedRoleIds.length === 0 && allowedUserIds.length === 0) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  }
  return false;
}

/** Returns the handler for Discord button interactions. */
export function createInteractionHandler({ config, jellyseerr, logger }) {
  const inFlight = new Set(); // guards against double-clicks / two admins clicking at once

  return async function handleInteraction(interaction) {
    if (!interaction.isButton()) return;

    const match = BUTTON_ID.exec(interaction.customId);
    if (!match) return;
    const [, action, requestId] = match;

    // Only act on buttons in the configured channel.
    if (interaction.channelId !== config.channelId) return;

    if (!isAllowed(interaction, config)) {
      logger.warn(`${interaction.user.tag} (${interaction.user.id}) tried to ${action} request ${requestId} without permission`);
      await interaction.reply({
        content: "You don't have permission to manage requests.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (inFlight.has(requestId)) {
      await interaction.reply({ content: 'That request is already being processed.', flags: MessageFlags.Ephemeral });
      return;
    }
    inFlight.add(requestId);

    try {
      await interaction.deferUpdate();
      await jellyseerr.setRequestStatus(action, requestId);

      const approved = action === 'approve';
      logger.info(`${interaction.user.tag} ${approved ? 'approved' : 'declined'} request ${requestId}`);

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(approved ? COLORS.approved : COLORS.declined)
        .setFooter({ text: `${approved ? 'Approved' : 'Declined'} by ${interaction.user.displayName ?? interaction.user.username}` });

      // Drop Approve/Decline but keep any link button.
      const links = (interaction.message.components[0]?.components ?? []).filter((c) => c.style === ButtonStyle.Link);
      const components = links.length
        ? [new ActionRowBuilder().addComponents(links.map((c) => ButtonBuilder.from(c)))]
        : [];

      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      logger.error(`Failed to ${action} request ${requestId}:`, err.message);
      await interaction
        .followUp({ content: `Could not ${action} request ${requestId}: ${err.message}`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    } finally {
      inFlight.delete(requestId);
    }
  };
}
