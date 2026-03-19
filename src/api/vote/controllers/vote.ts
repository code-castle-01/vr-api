import { factories } from '@strapi/strapi';
import type { Context } from 'koa';
import {
  getResidentAccessModeFromContext,
  isAdminRole,
} from '../../../utils/resident-session';
import {
  repairAssemblyVoteWeights,
  repairStoredVoteWeights,
} from '../../../utils/vote-weight';

type CastVoteBody = {
  agendaItemId?: number | string;
  mechanism?: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
  voteOptionId?: number | string;
  voteOptionIds?: Array<number | string>;
};

type VoteService = {
  getBallot: (userId: number, accessMode: 'owner' | 'proxy') => Promise<unknown>;
  getResultsOverview: () => Promise<unknown>;
  castVote: (input: {
    accessMode: 'owner' | 'proxy';
    agendaItemId: number;
    mechanism: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
    userId: number;
    voteOptionIds: number[];
  }) => Promise<unknown>;
};

const requireAdminUser = async (strapi: any, ctx: Context) => {
  const userId = ctx.state.user?.id;

  if (!userId) {
    ctx.unauthorized('Debes iniciar sesion para realizar esta accion.');
    return null;
  }

  const user = await strapi.entityService.findOne(
    'plugin::users-permissions.user',
    Number(userId),
    {
      fields: ['id'],
      populate: {
        role: {
          fields: ['id', 'name', 'type'],
        },
      },
    }
  );

  if (!user || !isAdminRole(user.role)) {
    ctx.forbidden('Solo un administrador puede realizar esta accion.');
    return null;
  }

  return user;
};

export default factories.createCoreController('api::vote.vote', ({ strapi }) => ({
  async ballot(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar tus encuestas.');
    }

    const voteService = strapi.service('api::vote.vote') as unknown as VoteService;
    const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';

    ctx.body = await voteService.getBallot(Number(userId), accessMode);
  },

  async cast(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para emitir un voto.');
    }

    const { agendaItemId, voteOptionId, voteOptionIds, mechanism = 'electronic' } =
      (ctx.request.body ?? {}) as CastVoteBody;

    const parsedAgendaItemId = Number(agendaItemId);
    const parsedVoteOptionIds = Array.isArray(voteOptionIds)
      ? voteOptionIds.map((item) => Number(item))
      : [Number(voteOptionId)];

    if (
      !Number.isInteger(parsedAgendaItemId) ||
      !parsedVoteOptionIds.length ||
      parsedVoteOptionIds.some((item) => !Number.isInteger(item))
    ) {
      return ctx.badRequest('Debes enviar agendaItemId y al menos una opcion de voto valida.');
    }

    const voteService = strapi.service('api::vote.vote') as unknown as VoteService;
    const accessMode = (await getResidentAccessModeFromContext(strapi, ctx)) ?? 'owner';
    const result = await voteService.castVote({
      accessMode,
      agendaItemId: parsedAgendaItemId,
      mechanism,
      userId: Number(userId),
      voteOptionIds: [...new Set(parsedVoteOptionIds)],
    });

    ctx.body = result;
  },

  async resultsOverview(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar los resultados.');
    }

    const voteService = strapi.service('api::vote.vote') as unknown as VoteService;
    ctx.body = await voteService.getResultsOverview();
  },

  async adminRepairWeights(ctx: Context) {
    const authenticatedUser = await requireAdminUser(strapi, ctx);

    if (!authenticatedUser) {
      return;
    }

    const assemblyIdRaw = ctx.request.body?.assemblyId;
    const parsedAssemblyId =
      assemblyIdRaw === undefined || assemblyIdRaw === null || assemblyIdRaw === ''
        ? null
        : Number(assemblyIdRaw);

    if (parsedAssemblyId !== null && !Number.isInteger(parsedAssemblyId)) {
      return ctx.badRequest('assemblyId debe ser un entero valido cuando se envie.');
    }

    ctx.body =
      parsedAssemblyId !== null
        ? await repairAssemblyVoteWeights(strapi as any, parsedAssemblyId)
        : await repairStoredVoteWeights(strapi as any);
  },
}));
