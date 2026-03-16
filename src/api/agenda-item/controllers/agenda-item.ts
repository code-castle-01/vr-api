import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type AgendaItemService = {
  getResults: (agendaItemId: number) => Promise<unknown>;
};

export default factories.createCoreController('api::agenda-item.agenda-item', ({ strapi }) => ({
  async results(ctx: Context) {
    const agendaItemId = Number(ctx.params.id);

    if (!Number.isInteger(agendaItemId)) {
      return ctx.badRequest('El identificador del punto del orden del dia no es valido.');
    }

    const agendaItemService = strapi.service('api::agenda-item.agenda-item') as unknown as AgendaItemService;
    const result = await agendaItemService.getResults(agendaItemId);

    ctx.body = result;
  },
}));
