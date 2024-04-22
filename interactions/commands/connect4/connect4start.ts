import { GameState, SlotState } from "!/common/logic/c4/c4types";
import { createEmptyBoard } from "!/common/logic/c4/createEmptyBoard";
import { createWallet } from "!/common/logic/economy/createWallet";
import { notYourInteraction } from "!/common/logic/responses/notYourInteraction";
import {
  type AnyInteraction,
  Colors,
  type InteractionContext,
  InteractionType,
} from "!/common/types";
import { addCurrency } from "!/common/utils/addCurrency";
import { formatNumber } from "!/common/utils/formatNumber";
import { safeParseNumber } from "!/common/utils/parseNumber";
import { prisma } from "!/prisma";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionReplyOptions,
} from "discord.js";
import { sprintf } from "sprintf-js";
import { z } from "zod";
import { connect4clockTimes } from "./connect4config";
import { connect4display } from "./connect4display";

type Options = {
  mentionedIsBot: boolean;
  guildId: string;
  channelId: string;
  authorId: string;
  mentionedId: string;
  clockTime: string;
  challengerColor: string;
  wager?: string;
};

const playerColor = z.enum(["red", "yellow"]);

const connect4invitationContext = z.object({
  invitationId: z.string(),
});

export async function connect4start({
  mentionedIsBot,
  guildId,
  channelId,
  authorId,
  mentionedId,
  wager,
  challengerColor,
  clockTime,
}: Options): Promise<InteractionReplyOptions> {
  if (mentionedIsBot) {
    return {
      ephemeral: true,
      content: "You can't challenge bots.",
    };
  }

  if (authorId === mentionedId) {
    return {
      ephemeral: true,
      content: "You can't challenge yourself.",
    };
  }

  const authorCurrentGame = await prisma.connect4Game.findFirst({
    where: {
      guildId,
      challenger: authorId,
      endedAt: null,
    },
  });

  if (authorCurrentGame) {
    return {
      ephemeral: true,
      content: sprintf(
        "You're already in a game with <@%s> in <#%s>. You can forfeit with `/connect4 end`",
        authorCurrentGame.opponent,
        authorCurrentGame.channelId,
      ),
    };
  }

  const mentionedCurrentGame = await prisma.connect4Game.findFirst({
    where: {
      guildId,
      challenger: mentionedId,
      endedAt: null,
    },
  });

  if (mentionedCurrentGame) {
    return {
      ephemeral: true,
      content: sprintf(
        "<@%s> is already in a game with someone else in <#%s>",
        mentionedId,
        mentionedCurrentGame.channelId,
      ),
    };
  }

  const wallet = await createWallet(authorId, guildId);

  const parsedWager =
    wager != null
      ? z
          .preprocess(
            safeParseNumber,
            z
              .number()
              .int()
              .transform((v) => (v === 0 ? wallet.balance : v)),
          )
          .safeParse(wager)
      : null;

  if (parsedWager && !parsedWager.success) {
    return {
      ephemeral: true,
      content: "Invalid wager.",
    };
  }

  if (parsedWager && parsedWager.data > wallet.balance) {
    return {
      ephemeral: true,
      content: sprintf(
        "You don't have enough money in your wallet. Your balance is %s.",
        addCurrency()(formatNumber(wallet.balance)),
      ),
    };
  }

  if (parsedWager && parsedWager.data < 1_000) {
    return {
      ephemeral: true,
      content: "Minimum wager is 1k",
    };
  }

  const parsedChallengerColor = playerColor.safeParse(challengerColor);

  if (!parsedChallengerColor.success) {
    return {
      ephemeral: true,
      content: "Invalid color.",
    };
  }

  const parsedClockTime = z.coerce
    .number()
    .safeParse(
      connect4clockTimes.find((time) => time.value === clockTime)?.value,
    );

  if (!parsedClockTime.success) {
    return {
      ephemeral: true,
      content: "Invalid clock time.",
    };
  }

  const [_, invitation] = await prisma.$transaction([
    prisma.connect4GameInvitation.updateMany({
      where: {
        guildId,
        challenger: authorId,
      },
      data: {
        voided: true,
      },
    }),
    prisma.connect4GameInvitation.create({
      data: {
        guildId,
        channelId,
        challenger: authorId,
        opponent: mentionedId,
        challengerColor:
          parsedChallengerColor.data === "red"
            ? SlotState.Red
            : SlotState.Yellow,
        wagerAmount: parsedWager?.data,
        moveTime: parsedClockTime.data,
      },
      select: {
        id: true,
      },
    }),
    prisma.wallet.update({
      where: {
        userDiscordId_guildId: {
          userDiscordId: authorId,
          guildId,
        },
      },
      data: {
        balance: {
          decrement: parsedWager?.data ?? 0,
        },
      },
    }),
  ]);

  const invitationContext: z.infer<typeof connect4invitationContext> = {
    invitationId: invitation.id,
  };

  const [acceptInteraction, declineInteraction] = await prisma.$transaction([
    prisma.interaction.create({
      data: {
        guildId,
        channelId,
        type: InteractionType.Connect4AcceptInvitation,
        userDiscordId: authorId,
        payload: JSON.stringify(invitationContext),
      },
    }),
    prisma.interaction.create({
      data: {
        guildId,
        channelId,
        type: InteractionType.Connect4DeclineInvitation,
        userDiscordId: authorId,
        payload: JSON.stringify(invitationContext),
      },
    }),
  ]);

  const embed = new EmbedBuilder()
    .setColor(Colors.Info)
    .setTitle("Connect 4")
    .setDescription(
      [
        sprintf(
          "<@%s> has challenged <@%s> to a game of Connect 4.",
          authorId,
          mentionedId,
        ),
        sprintf(
          "- :red_circle: <@%s> (moves first)",
          parsedChallengerColor.data === "red" ? authorId : mentionedId,
        ),
        sprintf(
          "- :yellow_circle: <@%s>",
          parsedChallengerColor.data === "yellow" ? authorId : mentionedId,
        ),
      ].join("\n"),
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptInteraction.id)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(declineInteraction.id)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger),
  );

  embed.addFields({
    name: "Move time",
    value: z
      .string()
      .parse(connect4clockTimes.find((time) => time.value === clockTime)?.name),
    inline: true,
  });

  if (parsedWager) {
    embed.addFields({
      name: "Wager",
      value: addCurrency()(formatNumber(parsedWager.data)),
      inline: true,
    });
  }

  return {
    content: sprintf("<@%s>", mentionedId),
    embeds: [embed],
    components: [row],
  };
}

export async function connect4accept(
  interactionContext: InteractionContext,
  interaction: AnyInteraction,
) {
  if (!interaction.isButton()) {
    return;
  }

  const guildId = interaction.guildId;

  if (!guildId) {
    return await interaction.reply({
      ephemeral: true,
      content: "This command is only available in servers.",
    });
  }

  const context = connect4invitationContext.safeParse(
    JSON.parse(interactionContext.payload ?? "{}"),
  );

  if (!context.success) {
    return await interaction.reply({
      ephemeral: true,
      content: "Invalid context.",
    });
  }

  const invitation = await prisma.connect4GameInvitation.findFirst({
    where: {
      id: context.data.invitationId,
      guildId,
    },
  });

  if (invitation?.challenger === interaction.user.id) {
    return await interaction.reply({
      ephemeral: true,
      content:
        "You can't accept your own invitation. If you want to remove the invitation click the decline button.",
    });
  }

  if (invitation?.opponent !== interaction.user.id) {
    return await interaction.reply(
      notYourInteraction(interactionContext, interaction),
    );
  }

  const board = createEmptyBoard(SlotState.Red);

  const [_, game] = await prisma.$transaction([
    prisma.connect4GameInvitation.update({
      where: {
        id: context.data.invitationId,
      },
      data: {
        voided: true,
      },
    }),
    prisma.connect4Game.create({
      data: {
        guildId,
        channelId: invitation.channelId,
        challenger: invitation.challenger,
        opponent: invitation.opponent,
        challengerColor: invitation.challengerColor,
        wagerAmount: invitation.wagerAmount,
        moveTime: invitation.moveTime,
        board: JSON.stringify(board),
        gameState: z.nativeEnum(GameState).parse(board.gameState),
        lastMoveAt: new Date(),
      },
    }),
  ]);

  await Promise.all([
    interaction.reply(await connect4display(game.id)),
    interaction.message
      .edit({
        components: [],
        content: "",
        embeds: [
          new EmbedBuilder()
            .setTitle("Challenge accepted")
            .setColor(Colors.Success)
            .setDescription(
              sprintf(
                "<@%s> accepted the challenge by <@%s>",
                interaction.user.id,
                invitation.challenger,
              ),
            ),
        ],
      })
      .catch((e) => {
        console.error("Failed to edit message", e);
      }),
  ]);
}
