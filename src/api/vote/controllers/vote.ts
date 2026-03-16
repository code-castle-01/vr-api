import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type CastVoteBody = {
  agendaItemId?: number | string;
  mechanism?: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
  voteOptionId?: number | string;
};

type VoteService = {
  getBallot: (userId: number) => Promise<unknown>;
  getResultsOverview: () => Promise<unknown>;
  castVote: (input: {
    agendaItemId: number;
    mechanism: 'electronic' | 'in_person' | 'proxy' | 'correspondence';
    userId: number;
    voteOptionId: number;
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

    const { agendaItemId, voteOptionId, mechanism = 'electronic' } =
      (ctx.request.body ?? {}) as CastVoteBody;

    const parsedAgendaItemId = Number(agendaItemId);
    const parsedVoteOptionId = Number(voteOptionId);

    if (!Number.isInteger(parsedAgendaItemId) || !Number.isInteger(parsedVoteOptionId)) {
      return ctx.badRequest('Debes enviar agendaItemId y voteOptionId validos.');
    }

    const voteService = strapi.service('api::vote.vote') as unknown as VoteService;
    const result = await voteService.castVote({
      agendaItemId: parsedAgendaItemId,
      mechanism,
      userId: Number(userId),
      voteOptionId: parsedVoteOptionId,
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
