import {
  type Interaction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { Colors, type Command } from "~/common/types";
import { prisma } from "~/prisma";
import { WorkType, coolDowns, workCommandUses } from "./lib/workConfig";
import { guardEconomyChannel } from "~/common/logic/guildConfig/guardEconomyChannel";
import { sprintf } from "sprintf-js";
import { stackOdds } from "./lib/stackOdds";
import { randomNumber } from "~/common/utils/randomNumber";
import { getRandomizedScenario } from "./lib/getRandomizedScenario";
import { createWallet } from "~/common/logic/economy/createWallet";
import { addCurrency } from "~/common/utils/addCurrency";
import { formatNumber } from "~/common/utils/formatNumber";

const maxStreak = 7;

enum Scenario {
  Shark = "SHARK",
  BigFish = "BIG_FISH",
  SmallFish = "SMALL_FISH",
  Shoe = "SHOE",
  Nothing = "NOTHING",
}

const odds: Record<Scenario, number> = {
  [Scenario.Shark]: 10,
  [Scenario.BigFish]: 30,
  [Scenario.SmallFish]: 55,
  [Scenario.Shoe]: 8,
  [Scenario.Nothing]: 3,
};

const computedOdds = stackOdds(odds);

const rewards: Record<
  Scenario,
  {
    message: string;
    generateReward: () => Promise<number>;
  }
> = {
  [Scenario.Shark]: {
    message: "You caught a shark! 🦈",
    generateReward: async () => 15_000,
  },
  [Scenario.BigFish]: {
    message: "You caught a big fish! 🐟",
    generateReward: async () => randomNumber(3_000, 5_000),
  },
  [Scenario.SmallFish]: {
    message: "You caught a small fish! 🐠",
    generateReward: async () => randomNumber(1_000, 2_000),
  },
  [Scenario.Shoe]: {
    message: "You caught a shoe! 👞",
    generateReward: async () => randomNumber(0, 200),
  },
  [Scenario.Nothing]: {
    message: "You caught nothing... 🎣",
    generateReward: async () => 0,
  },
};

export const fish = {
  data: new SlashCommandBuilder().setName("fish").setDescription("Go fishing!"),
  async execute(interaction: Interaction) {
    if (!interaction.isRepliable() || !interaction.isChatInputCommand()) {
      return;
    }

    const guildId = interaction.guild?.id;

    if (!guildId) {
      return await interaction.reply(
        "This command can only be used in a server.",
      );
    }

    const guard = await guardEconomyChannel(
      guildId,
      interaction.channelId,
      interaction.user.id,
    );

    if (guard) {
      return await interaction.reply({
        ephemeral: true,
        ...guard,
      });
    }

    const coolDown = coolDowns.FISH;

    const lastUses = await prisma.work.findMany({
      where: {
        type: WorkType.Fish,
        createdAt: {
          gte: new Date(Date.now() - coolDown),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: workCommandUses.FISH,
    });

    if (lastUses.length >= workCommandUses.FISH) {
      const lastUse = lastUses.at(-1);

      if (!lastUse) {
        return await interaction.reply({
          content: "Hmm, something went wrong. Please try again later.",
        });
      }

      return await interaction.reply({
        content: sprintf(
          "You've fished too much today. Try your luck <t:%s:R>",
          Math.floor((lastUse.createdAt.getTime() + coolDown) / 1000),
        ),
      });
    }

    const randomizedScenario = getRandomizedScenario(computedOdds);

    const { generateReward, message } = rewards[randomizedScenario];
    const reward = await generateReward();
    const wallet = await createWallet(interaction.user.id, guildId);

    const userClan = await prisma.clan.findFirst({
      where: {
        members: {
          some: {
            discordUserId: interaction.user.id,
          },
        },
        discordGuildId: guildId,
      },
      select: {
        level: true,
      },
    });

    const clanBonusMultiplier = userClan?.level ? userClan.level / 10 : 0;

    const clanBonus = Math.round(reward * clanBonusMultiplier);
    const totalReward = reward + clanBonus;

    await prisma.$transaction([
      prisma.work.create({
        data: {
          userDiscordId: interaction.user.id,
          guildDiscordId: guildId,
          type: WorkType.Fish,
        },
      }),
      prisma.wallet.update({
        where: {
          id: wallet.id,
        },
        data: {
          balance: {
            increment: reward,
          },
        },
      }),
    ]);

    const makeDollars = addCurrency();

    const embed = new EmbedBuilder()
      .setColor(Colors.Success)
      .setTitle(sprintf("+%s", makeDollars(formatNumber(totalReward))))
      .setDescription(
        sprintf(
          "%s%s",
          message,
          clanBonusMultiplier > 0
            ? sprintf(
                " Clan bonus: **+%s** (%s)",
                makeDollars(formatNumber(clanBonus)),
                `${((clanBonusMultiplier + 1) * 100 - 100).toFixed(0)}%`,
              )
            : "",
        ),
      );

    if (lastUses.length === workCommandUses.FISH - 1) {
      const nextFish = sprintf(
        "Next fish <t:%d:R>",
        Math.floor((Date.now() + coolDown) / 1000),
      );
      embed.setDescription(
        [embed.data.description, nextFish]
          .filter((v): v is string => v != null)
          .join("\n"),
      );
    } else {
      const count = workCommandUses.FISH - lastUses.length - 1;
      const word = count === 1 ? "use" : "uses";
      embed.setFooter({
        text: sprintf("%d %s left", count, word),
      });
    }

    return await interaction.reply({
      embeds: [embed],
    });
  },
} satisfies Command;