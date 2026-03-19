import { factories } from '@strapi/strapi';
import type { Context } from 'koa';
import { isAdminRole } from '../../../utils/resident-session';

type AssemblyEntity = {
  date?: string | null;
  id: number;
  status?: 'scheduled' | 'in_progress' | 'finished' | null;
  title?: string | null;
};

type AssemblyService = {
  generateExhaustiveReport: (assembly: AssemblyEntity) => Promise<{
    buffer: Buffer;
    filename: string;
  }>;
};

const requireAdminUser = async (strapi: any, ctx: Context) => {
  const userId = ctx.state.user?.id;

  if (!userId) {
    ctx.unauthorized('Debes iniciar sesion para descargar el informe de la asamblea.');
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
    ctx.forbidden('Solo un administrador puede descargar este informe.');
    return null;
  }

  return user;
};

export default factories.createCoreController('api::assembly.assembly', ({ strapi }) => ({
  async adminExhaustiveReport(ctx: Context) {
    const authenticatedUser = await requireAdminUser(strapi, ctx);

    if (!authenticatedUser) {
      return;
    }

    const assemblyId = Number(ctx.params.id);

    if (!Number.isInteger(assemblyId) || assemblyId <= 0) {
      return ctx.badRequest('Debes indicar una asamblea valida.');
    }

    const assembly = (await strapi.entityService.findOne('api::assembly.assembly', assemblyId, {
      fields: ['id', 'title', 'date', 'status'],
    })) as AssemblyEntity | null;

    if (!assembly) {
      return ctx.notFound('No se encontro la asamblea solicitada.');
    }

    if (assembly.status !== 'finished') {
      ctx.status = 409;
      ctx.body = {
        error: {
          message: 'El informe exhaustivo solo se puede generar cuando la asamblea esta finalizada.',
        },
      };
      return;
    }

    const assemblyService = strapi.service('api::assembly.assembly') as unknown as AssemblyService;
    const report = await assemblyService.generateExhaustiveReport(assembly);

    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', `attachment; filename="${report.filename}"`);
    ctx.set('Cache-Control', 'no-store');
    ctx.body = report.buffer;
  },
}));
