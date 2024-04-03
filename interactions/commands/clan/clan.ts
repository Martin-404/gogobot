import { SlashCommandBuilder, type Interaction } from "discord.js";
import {
  ClanJoinSetting,
  ClanMemberRole,
  type Command,
} from "../../../common/types";
import { createGuildWizardStep1 } from "./createClanWizard";
import { showClanInfoCommand } from "./clanInfo";
import { clanInvite } from "./clanInvite";
import { z } from "zod";
import { clanSettingsCommand } from "./clanSettings";
import { clanKick } from "./clanKick";
import { clanLeaveCommand } from "./clanLeave";
import { clanPromote } from "./clanPromote";
import { clanDemote } from "./clanDemote";
import { clanMembersCommand, showClanMembers } from "./clanMembers";

export const clan = {
  data: new SlashCommandBuilder()
    .setName("clan")
    .setDescription("Clan management")
    .addSubcommand((subCommand) =>
      subCommand
        .setName("info")
        .setDescription("Get clan information")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user whose clan you want to see"),
        ),
    )
    .addSubcommand((subCommand) =>
      subCommand.setName("create").setDescription("Create a new clan"),
    )
    .addSubcommand((subCommand) =>
      subCommand
        .setName("invite")
        .setDescription("Invite a user to your clan")
        .addUserOption((option) =>
          option
            .setRequired(true)
            .setName("user")
            .setDescription("User to invite"),
        ),
    )
    .addSubcommand((subCommand) =>
      subCommand.setName("settings").setDescription("Change clan settings"),
    )
    .addSubcommand((subCommand) =>
      subCommand
        .setName("kick")
        .setDescription("Kick a user from your clan")
        .addUserOption((option) =>
          option
            .setRequired(true)
            .setName("user")
            .setDescription("User to kick"),
        ),
    )
    .addSubcommand((subCommand) =>
      subCommand
        .setName("promote")
        .setDescription("Promote a member in your clan")
        .addUserOption((option) =>
          option
            .setRequired(true)
            .setName("user")
            .setDescription("User to promote"),
        ),
    )
    .addSubcommand((subCommand) =>
      subCommand
        .setName("demote")
        .setDescription("Demote a member in your clan")
        .addUserOption((option) =>
          option
            .setRequired(true)
            .setName("user")
            .setDescription("User to demote"),
        ),
    )
    .addSubcommand((subCommand) =>
      subCommand.setName("leave").setDescription("Leave your clan"),
    )
    .addSubcommand((subCommand) =>
      subCommand.setName("members").setDescription("Show your clan's members"),
    ),
  async execute(interaction: Interaction) {
    if (!interaction.isRepliable() || !interaction.isChatInputCommand()) {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      return await interaction.reply("Clans are only available in servers.");
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "create":
        return await interaction.reply(
          await createGuildWizardStep1({
            userId: interaction.user.id,
            guildId,
          }),
        );
      case "info":
        return await interaction.reply(
          await showClanInfoCommand({
            authorId: interaction.user.id,
            guildId,
            mentionedId: interaction.options.getUser("user")?.id,
          }),
        );
      case "invite":
        return await interaction.reply(
          await clanInvite({
            userId: interaction.user.id,
            guildId,
            inviteeId: z
              .string()
              .parse(interaction.options.getUser("user")?.id),
          }),
        );
      case "settings":
        return void (await clanSettingsCommand({
          userId: interaction.user.id,
          guildId,
          interaction,
        }));
      case "kick":
        return await interaction.reply(
          await clanKick({
            authorId: interaction.user.id,
            mentionedId: z
              .string()
              .parse(interaction.options.getUser("user")?.id),
            guildId,
          }),
        );
      case "leave":
        return await interaction.reply(
          await clanLeaveCommand({
            userId: interaction.user.id,
            guildId,
          }),
        );
      case "promote":
        return await interaction.reply(
          await clanPromote({
            authorId: interaction.user.id,
            mentionedId: z
              .string()
              .parse(interaction.options.getUser("user")?.id),
            guildId,
          }),
        );
      case "demote":
        return await interaction.reply(
          await clanDemote({
            authorId: interaction.user.id,
            mentionedId: z
              .string()
              .parse(interaction.options.getUser("user")?.id),
            guildId,
          }),
        );
      case "members":
        return await interaction.reply(
          await clanMembersCommand({
            authorId: interaction.user.id,
            guildId,
          }),
        );
      default:
        return await interaction.reply({
          ephemeral: true,
          content: "Unknown sub command",
        });
    }
  },
} satisfies Command;

export const clanRoles: Record<ClanMemberRole, string> = {
  [ClanMemberRole.Leader]: "leader",
  [ClanMemberRole.Officer]: "officer",
  [ClanMemberRole.Senior]: "senior",
  [ClanMemberRole.Member]: "member",
};

export const joinSettings: Record<ClanJoinSetting, string> = {
  [ClanJoinSetting.Open]: "Open",
  [ClanJoinSetting.Approval]: "Invite only",
  [ClanJoinSetting.Closed]: "Closed",
};