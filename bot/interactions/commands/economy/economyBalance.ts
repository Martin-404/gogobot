import {
  EmbedBuilder,
  type Interaction,
  SlashCommandBuilder,
} from "discord.js";
import { sprintf } from "sprintf-js";
import { createBank } from "../../../logic/economy/createBank";
import { createWallet } from "../../../logic/economy/createWallet";
import { Colors, type Command } from "../../../types";
import { addCurrency } from "../../../utils/addCurrency";
import { formatNumber } from "../../../utils/formatNumber";
import { makePossessive } from "../../../utils/makePossessive";

export const balance = {
  data: new SlashCommandBuilder()
    .setName("bal")
    .setDescription("View the balance of your accounts")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to view the balance of"),
    ),
  async execute(interaction: Interaction) {
    if (!interaction.isRepliable()) {
      return;
    }

    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await interaction.reply(
        "This command can only be used in a server.",
      );
    }

    if (!interaction.isCommand()) {
      return await interaction.reply(
        "This interaction can only be used as a command.",
      );
    }

    const selectedUser = interaction.options.get("user")?.user;
    const userId = selectedUser?.id ?? interaction.user.id;

    const [wallet, bank] = await Promise.all([
      createWallet(userId, guildId),
      createBank(userId, guildId),
    ]);

    const makeDollars = addCurrency();
    const walletBalance = makeDollars(formatNumber(wallet.balance));
    const bankBalance = makeDollars(formatNumber(bank.balance));

    if (selectedUser && interaction.user.id !== selectedUser.id) {
      const embed = new EmbedBuilder()
        .setColor(Colors.Info)
        .setTitle(
          sprintf("%s balance", makePossessive(selectedUser.displayName)),
        )
        .addFields([
          {
            name: "Wallet",
            value: walletBalance,
            inline: true,
          },
          {
            name: "Bank",
            value: bankBalance,
            inline: true,
          },
        ]);

      if (selectedUser.bot) {
        embed.setDescription(
          sprintf("Looks like %s is a robot :robot:", selectedUser.displayName),
        );
      }

      return await interaction.reply({
        embeds: [embed],
      });
    }

    const parts = [
      {
        name: sprintf("**Wallet**: %s", walletBalance),
        predicate: true,
      },
      {
        name: sprintf("**Bank**: %s", bankBalance),
        predicate: true,
      },
      {
        name:
          wallet.immuneUntil && wallet.immuneUntil.getTime() > Date.now()
            ? sprintf(
                "**Immunity expires** <t:%d:R>",
                Math.floor(wallet.immuneUntil.getTime() / 1000),
              )
            : "",
        predicate:
          wallet.immuneUntil && wallet.immuneUntil.getTime() > Date.now(),
      },
    ];

    return await interaction.reply(
      parts
        .filter((part) => part.predicate)
        .map((part) => part.name)
        .join("\n"),
    );
  },
} satisfies Command;
