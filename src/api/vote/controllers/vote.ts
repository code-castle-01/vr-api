import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type CastVoteBody = {
  agendaItemId?: number | string;
  mechanism?: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
  voteOptionId?: number | string;
  voteOptionIds?: Array<number | string>;
};

type VoteService = {
  getBallot: (userId: number) => Promise<unknown>;
  getResultsOverview: () => Promise<unknown>;
  castVote: (input: {
    agendaItemId: number;
    mechanism: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
    userId: number;
    voteOptionIds: number[];
  }) => Promise<unknown>;
};

export default factories.createCoreController('api::vote.vote', ({ strapi }) => ({
  async ballot(ctx: Context) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('Debes iniciar sesion para consultar tus encuestas.');
    }

    const voteService = strapi.service('api::vote.vote') as unknown as VoteService;
    ctx.body = await voteService.getBallot(Number(userId));
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
    const result = await voteService.castVote({
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
}));
