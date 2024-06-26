import { ClanMemberRole, Colors } from "!/bot/types";
import { prisma } from "!/core/db/prisma";
import { sprintf } from "sprintf-js";
import { z } from "zod";
import { removeClanRole } from "./clanRole";
import { clanSendNotificationOrMessage } from "./clanSendNotificationOrMessage";

type Options = {
  authorId: string;
  mentionedId: string;
  guildId: string;
};

export async function clanKick({ authorId, mentionedId, guildId }: Options) {
  const clan = await prisma.clan.findFirst({
    where: {
      discordGuildId: guildId,
      members: {
        some: {
          discordUserId: authorId,
        },
      },
    },
    select: {
      name: true,
      id: true,
      members: {
        where: {
          discordUserId: {
            in: [authorId, mentionedId],
          },
        },
        select: {
          role: true,
          discordUserId: true,
        },
      },
    },
  });

  if (!clan) {
    return {
      content: "You are not in a clan",
      ephemeral: true,
    };
  }

  const kickingMember = clan.members.find((v) => v.discordUserId === authorId);

  if (!kickingMember) {
    return {
      content: "You are not in the clan",
      ephemeral: true,
    };
  }

  const memberToKick = clan.members.find(
    (v) => v.discordUserId === mentionedId,
  );

  if (!memberToKick) {
    return {
      content: sprintf("User <@%s> is not in the clan", mentionedId),
      ephemeral: true,
    };
  }

  if (
    ![
      ClanMemberRole.Leader,
      ClanMemberRole.CoLeader,
      ClanMemberRole.Officer,
    ].includes(z.nativeEnum(ClanMemberRole).parse(kickingMember.role))
  ) {
    return {
      content: "You are not a leader, co-leader or officer of the clan.",
      ephemeral: true,
    };
  }

  if (memberToKick.discordUserId === authorId) {
    return {
      content: "You cannot kick yourself.",
      ephemeral: true,
    };
  }

  if (memberToKick.role === ClanMemberRole.Leader) {
    return {
      content: "You cannot kick the leader.",
      ephemeral: true,
    };
  }

  const myRoleIndex = Object.values(ClanMemberRole).indexOf(
    z.nativeEnum(ClanMemberRole).parse(kickingMember.role),
  );

  const memberToKickRoleIndex = Object.values(ClanMemberRole).indexOf(
    z.nativeEnum(ClanMemberRole).parse(memberToKick.role),
  );

  if (myRoleIndex >= memberToKickRoleIndex) {
    return {
      content: "You cannot kick a member with the same or higher rank.",
      ephemeral: true,
    };
  }

  await prisma.$transaction([
    prisma.clanMember.delete({
      where: {
        clanId_discordUserId: {
          clanId: clan.id,
          discordUserId: mentionedId,
        },
      },
    }),
    prisma.clanInvitation.deleteMany({
      where: {
        userDiscordId: mentionedId,
        clanId: clan.id,
      },
    }),
    prisma.clanBanishment.create({
      data: {
        clanId: clan.id,
        userDiscordId: mentionedId,
        banishedByDiscordId: authorId,
      },
    }),
  ]);

  await Promise.all([
    prisma.clanlessUser
      .create({
        data: {
          guildId,
          userDiscordId: mentionedId,
        },
      })
      .catch(() => {}),
    removeClanRole(clan.id, mentionedId),
  ]);

  const message = sprintf(
    "<@%s> has been kicked out of **%s** by <@%s>",
    mentionedId,
    clan.name,
    kickingMember.discordUserId,
  );

  return await clanSendNotificationOrMessage(clan.id, message, Colors.Error);
}
