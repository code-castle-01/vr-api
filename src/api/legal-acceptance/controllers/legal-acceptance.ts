import { factories } from '@strapi/strapi';
import type { Context } from 'koa';

type LegalAcceptanceService = {
  listAdminAcceptances: (
    adminUserId: number,
    filters: {
      dateFrom?: unknown;
      dateTo?: unknown;
      unit?: unknown;
      version?: unknown;
    }
  ) => Promise<unknown>;
};

export default factories.createCoreController(
  'api::legal-acceptance.legal-acceptance' as any,
  ({ strapi }) => ({
    async adminList(ctx: Context) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.unauthorized(
          'Debes iniciar sesion para consultar las aceptaciones legales.'
        );
      }

      const legalAcceptanceService = strapi.service(
        'api::legal-acceptance.legal-acceptance'
      ) as unknown as LegalAcceptanceService;

      ctx.body = await legalAcceptanceService.listAdminAcceptances(Number(userId), {
        dateFrom: ctx.query?.dateFrom,
        dateTo: ctx.query?.dateTo,
        unit: ctx.query?.unit,
        version: ctx.query?.version,
      });
    },
  })
);
